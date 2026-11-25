// SkillFlow validator: load a flow file, check it against the grammar, and follow data along every path.
// Browser-safe except `load`, `findSkillDir`, `skillVersion`, `installedVersion`, and the file checks inside `check`.
import {lstatSync, readdirSync, readFileSync, realpathSync, statSync} from "node:fs";
import {dirname, isAbsolute, join, resolve, sep} from "node:path";
import {getLocation, InvalidKdlError, parse} from "./_vendor/bgotink-kdl/index.js";
import {T_COMMENT_SINGLE, tokenize} from "./_vendor/bgotink-kdl/parser/tokenize.js";

export const EXECUTORS = ["llm", "code", "human"];
// kinds a name in `tools` may carry as a type annotation; a tool without one is a CLI or a tool of the agent itself
export const TOOL_KINDS = ["agent", "mcp"];
// interpreters that run a script of the skill: the step's prose names the script, and `tools` names external tools only
const INTERPRETERS = new Set(["python", "python3", "node", "bash", "sh", "zsh"]);
export const FLOW = new Set(["phase", "step", "decide", "gate", "end"]);
const LEVELS = new Set(["phase", "step", "decide", "gate"]);
// parent ("" = top level) -> children it may hold; nodes missing here take no children
export const CHILDREN = {
  "": ["skillflow", "context", "phase", "step", "decide", "gate", "end"],
  context: ["input", "output", "invariant"],
  phase: ["phase", "step", "decide", "gate", "end"],
  step: ["tools", "input", "output", "on-fail"],
  decide: ["tools", "input", "output", "when"],
  gate: ["tools", "input", "output", "when"],
  when: ["phase", "step", "decide", "gate", "end", "output"],
  "on-fail": ["step", "decide", "gate", "end", "output"],
};
export const PROPS = {skillflow: ["skill-version", "skillflow-version", "skill"], step: ["by", "file", "skill", "ref"], decide: ["by", "ref"],
  phase: ["ref"], gate: ["ref"], when: ["ref"], invariant: ["ref", "by"], input: ["ref"], output: ["ref"]};
const REF_CHARS = 40; // grammar.md: a longer ref breaks when the label's tail is reworded
// nodes whose input and output name one data item each; in context they declare the flow's own data
const ACTIONS = new Set(["step", "decide", "gate", "when", "on-fail"]);
// node -> [most positional arguments, index of its prose string or null]
const ARGS = {skillflow: [1, null], context: [1, 0], phase: [2, 1], step: [2, 1], decide: [3, 2], gate: [3, 2],
  when: [2, 1], "on-fail": [1, 0], end: [1, 0], input: [2, 1], output: [2, 1], invariant: [1, 0]};
const SAME_ENDS = 3; // authoring.md: a failure that several steps handle the same way is one invariant
const PROSE_CHARS = 200, PROSE_ITEMS = 5; // authoring.md: the intent in a sentence or two, or one list of five items
const FLOW_SHARE = 50, FLOW_SMALL = 4000; // a flow under FLOW_SMALL characters is short whatever the skill's size; percent of SKILL.md's size above which the flow is no longer a short view of the skill
export const READ_LIMIT = 5_000_000; // bytes: the cap of the bulk file scans (map, rules, ref labels, the editor's copy of the skill); a larger file is skipped there
// JavaScript \w and \b are ASCII; W is the Unicode word class for names in any language
export const W = "\\p{L}\\p{N}_";
export const FAILURE = new RegExp(`(?<![${W}])(fail|die|error)\\s*\\(|(?<![${W}])raise [${W}]|sys\\.exit\\(\\s*[^0)\\s]|(?<![${W}])exit [1-9]|file=sys\\.stderr|console\\.error|(?<![${W}])throw [${W}]|process\\.exit\\(\\s*[^0)\\s]|process\\.exitCode\\s*=\\s*[1-9]`, "u");
const STOPS = new RegExp(`(?<![${W}])(end|stop)(s|ed|ped)?[^${W}]*$`, "iu"); // an on-fail item that ends the flow: "…, then end.", "…; the run ends."
const CONTINUES = new RegExp(`(?<![${W}])continu`, "iu");
const SCRIPT = new RegExp(`(?<![${W}/.-])(?:scripts/)?((?:[${W}-]+/)*[${W}-]+\\.(?:py|sh|js|mjs|ts))(?![${W}])`, "gu");
// a script file that an invariant names, at any path: scripts/lib/check.py, tools/check.rb, .git/hooks/pre-commit.sh
// shortcut: a product name with such an ending, such as Node.js, counts as a script; upgrade when a flow writes one in a by=code invariant
const SCRIPT_FILE = new RegExp(`[${W}-]+\\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1)(?![${W}])`, "u");
const LIST_ROW = /^\s*([-*+]|\p{Nd}+[.)])\s/u; // the list marks the page shows, see assets/viewer-lib/text.js
// KDL v2 newlines, so line numbers match the parser's
export const KDL_LINES = /\r\n|[\n\r\v\f\x85\u2028\u2029]/;
// `// ?` marks an unclear place; `// ❓` from older flow files still counts
const UNCLEAR = /^\s*\/\/\s*(?:\?|❓)\s*(.*)/u;
const V2_HINT = 'KDL v2 writes keywords as #true/#false/#null, raw strings as #"..."#, and multi-line strings between """ lines.';
// the two ways to name the target skill folder when it is not next to the flow file or one folder up
export const SKILL_HINT = 'pass --skill <dir>, or write skill="<path>" on the first line: the path from the flow file to the folder with SKILL.md';

export class InputError extends Error {}

// a file-system error in words a person acts on; other codes stay as Node gives them
const REASONS = {ENOENT: "no such file or folder", EISDIR: "a folder, not a file", EACCES: "permission denied", EPERM: "permission denied", ENOTDIR: "a part of the path is a file, not a folder"};
export const reason = (error) => REASONS[error.code] ?? error.code ?? error.message;

export class Report {
  // draft: a completeness gap is a `todo` line, not an error; `gaps` counts the errors that are gaps
  constructor(path, draft = false) { this.path = path; this.draft = draft; this.errors = []; this.todos = []; this.warnings = []; this.gaps = 0; }
  error(line, message, hint = "") { this.errors.push([line, message, hint]); }
  /** Something a finished flow needs and a draft may leave out. */
  gap(line, message, hint = "") {
    if (this.draft) this.todos.push([line, message, hint]);
    else { this.gaps += 1; this.error(line, message, hint); }
  }
  warn(line, message, hint = "") { this.warnings.push([line, message, hint]); }
  *lines() {
    const at = ([line]) => (line ? parseInt(String(line).split(":")[0], 10) || 0 : 0);
    for (const [kind, items] of [["error", this.errors], ["todo", this.todos], ["warning", this.warnings]])
      for (const [line, message, hint] of items.toSorted((x, y) => at(x) - at(y)))
        yield `${this.path}:${line || "?"}: ${kind}: ${message}` + (hint ? ` (hint: ${hint})` : "");
  }
}

export const parseFlow = (text) => parse(text, {storeLocations: true});

/** {text, doc} of a flow file; throws InputError when it cannot be read and InvalidKdlError when it does not parse. */
export function load(flowPath) {
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(readFileSync(flowPath));
  } catch (error) {
    // a skill folder passed where the flow file goes: name the flow file inside it when there is one
    const inside = error.code === "EISDIR" && isFile(join(flowPath, "flow.kdl")) ? `; pass the flow file: ${join(flowPath, "flow.kdl")}` : error.code === "EISDIR" ? "; pass the flow file, not its folder" : "";
    throw new InputError(`${flowPath}: cannot read: ${reason(error)}${inside}`);
  }
  return {text, doc: parseFlow(text)};
}

export const kids = (node) => node.children?.nodes ?? [];
export const lineOf = (node) => getLocation(node)?.start.line ?? null;
export function argsProps(node) {
  const args = [], props = new Map();
  for (const entry of node.entries) {
    if (entry.name) props.set(entry.name.getName(), entry.getValue());
    else args.push(entry.getValue());
  }
  return [args, props];
}
// arguments only: a `ref=` value is never a data name
/** The data name of an `input` or `output` line inside a node: its first value; an `output` may add a description. */
const values = (node) => node.entries.filter((entry) => !entry.name).slice(0, 1).map((entry) => String(entry.getValue()));
export const squash = (text) => text.split(/\s+/u).filter(Boolean).join(" ");
const isName = (value) => typeof value === "string" && value !== "" && !/\s/u.test(value);
function* descendants(node) { for (const kid of kids(node)) { yield kid; yield* descendants(kid); } }

/** List rows of a prose string, or its sentences when it has no list. */
function proseItems(text) {
  const rows = text.split(/\r\n|\r|\n/).filter((row) => LIST_ROW.test(row));
  return rows.length ? rows : squash(text).split(/(?<=[.;])\s+/u).filter(Boolean);
}

/** [line number, note] for each `// ?` line outside multi-line strings. */
export function unclearLines(text) {
  // shortcut: tracks multi-line strings by counting triple quotes per line; a triple quote inside a one-line string would confuse it
  const found = [];
  let inside = false;
  text.split(KDL_LINES).forEach((line, index) => {
    const match = !inside && UNCLEAR.exec(line);
    if (match) found.push([index + 1, match[1].trim()]);
    if (line.split('"""').length % 2 === 0) inside = !inside;
  });
  return found;
}

/** Lines of the `// ?` comments in the space `text` around a node, which starts on line `first`. */
const markLines = (text, first) => [...tokenize(text ?? "", {})].filter((token) => token.type === T_COMMENT_SINGLE && UNCLEAR.test(token.text)).map((token) => first + token.start.line - 1);
// the first line of a space that ends on `line`
const startOf = (text, line) => line - (text ?? "").split(KDL_LINES).length + 1;

const realOrResolved = (path) => { try { return realpathSync(path); } catch { return resolve(path); } };
// stat that never throws: a symlink loop (ELOOP) or a locked folder counts as no file
export const statOrNull = (path) => { try { return statSync(path); } catch { return null; } };
export const isFile = (path) => statOrNull(path)?.isFile() ?? false;
// text of a file, or null when it cannot be read: a locked file is skipped like a missing one
const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } };
// length and cut in characters, not UTF-16 units
export const chars = (text) => [...text].length;
export const cut = (text, most) => [...text].slice(0, most).join("");

/** A quoted property of the `skillflow` first line, or null. */
export function headerProp(doc, key) {
  const first = doc.nodes[0]?.getName() === "skillflow" ? doc.nodes[0] : null;
  const value = first ? argsProps(first)[1].get(key) : null;
  return typeof value === "string" ? value : null;
}

// `skill=` is relative to the flow file
const skillAt = (flowPath, path) => resolve(dirname(realOrResolved(flowPath)), path);

/** The folder that `skill=` on the first line names, else the flow file's folder or its parent, whichever holds SKILL.md. */
export function findSkillDir(flowPath) {
  let named = null;
  try { named = headerProp(load(flowPath).doc, "skill"); } catch { /* a flow that cannot be read or parsed fails in check */ }
  if (named !== null) return isFile(join(skillAt(flowPath, named), "SKILL.md")) ? skillAt(flowPath, named) : null;
  const folder = dirname(realOrResolved(flowPath));
  return [folder, dirname(folder)].find((candidate) => isFile(join(candidate, "SKILL.md"))) ?? null;
}

/** metadata.version of the SkillFlow skill that runs this script, or null. */
export const installedVersion = () => skillVersion(join(import.meta.dirname, "..", "SKILL.md"));

/** -1, 0, or 1 for two dotted versions, each part compared as an integer; null when a part is not an integer. */
function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : NaN)));
  if ([...x, ...y].some(Number.isNaN)) return null;
  for (let index = 0; index < Math.max(x.length, y.length); index++) if ((x[index] ?? 0) !== (y[index] ?? 0)) return Math.sign((x[index] ?? 0) - (y[index] ?? 0));
  return 0;
}

/** metadata.version from a SKILL.md frontmatter, or null when it has none. */
export function skillVersion(skillMd) {
  const text = readText(skillMd);
  const front = text !== null && /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const found = front && /^metadata:[ \t]*\n(?:[ \t]+.*\n)*?[ \t]+version:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m.exec(front[1].replace(/\r\n/g, "\n") + "\n");
  return found ? found[1] : null;
}

// Relative POSIX paths of every file and symlink under root, hidden and __pycache__ parts skipped.
export function skillFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return; } // a folder that cannot be listed is skipped
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) out.push(rel);
      else if (entry.isDirectory()) walk(join(dir, entry.name), rel + "/");
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/** The form two refs are compared in: case, spaces, and hyphens do not count. */
export const refKey = (ref) => ref.toLowerCase().split(/[\s-]+/u).filter(Boolean).join(" ");

// what may stand before a ref at a defining place, after quote markers and before emphasis marks
const DEFINES = [
  /^#{1,6}[ \t]+(?:\p{Nd}+\p{Ll}?[.)][ \t]+)?$/u, // heading, numbered or not
  /^\|[ \t]*$/u, // first cell of a table row
  /^(?:[-*+]|\p{Nd}+\p{Ll}?[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/u, // list item, numbered or with a checkbox
];

/** Whether the text before a match on its line makes the match a defining place. */
function defines(before) {
  const lead = before.replace(/^[ \t]*(?:>[ \t]*)*/u, ""), marks = /[`*_]*$/u.exec(lead)[0], rest = lead.slice(0, lead.length - marks.length);
  return DEFINES.some((pattern) => pattern.test(rest)) || (rest === "" && /\*\*|__/u.test(marks));
}

/** {ref: ["file:line", …]} for each ref: its defining places in every Markdown file of the skill, whatever its folder, outside fenced code. */
export function findAnchors(skillDir, refs) {
  const patterns = refs.map((ref) => {
    const body = ref.trim().split(/[\s-]+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
    return [ref, new RegExp(`(?<![${W}-])${body}(?![${W}-])`, "giu")];
  });
  const found = Object.fromEntries(refs.map((ref) => [ref, []]));
  for (const relative of skillFiles(skillDir)) {
    // a label counts by the file it is in, not the folder: assets/ and scripts/ hold Markdown a skill relies on too
    if (!relative.endsWith(".md")) continue;
    const full = join(skillDir, relative), size = statOrNull(full);
    if (lstatSync(full).isSymbolicLink() || !size?.isFile() || size.size > READ_LIMIT) continue;
    let fence = null, prose = false;
    (readText(full) ?? "").split(/\r\n|\r|\n/u).forEach((line, index) => {
      const opening = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/u.exec(line);
      // a fence tagged markdown holds Markdown, such as a state-file template: its labels count
      if (fence === null && opening) { fence = opening[1]; prose = /^(markdown|md)$/iu.test(opening[2]); return; }
      if (fence !== null) {
        if (line.trim().startsWith(fence) && [...line.trim()].every((c) => c === fence[0])) { fence = null; return; }
        if (!prose) return;
      }
      for (const [ref, pattern] of patterns)
        for (const match of line.matchAll(pattern))
          if (defines(line.slice(0, match.index))) { found[ref].push(`${relative}:${index + 1}`); break; }
    });
  }
  return found;
}

export function syntaxErrors(report, error) {
  for (const detail of error.flat()) {
    const message = detail.message.replace(/ at \d+:\d+$/, "");
    const unclosed = /inside string|end of input/.test(message);
    // a stray brace: most often a `{` moved to the line after its node, such as after a closing """
    // the parser calls a "…" string "single quotes": it may not span lines; a """ string must
    const quotes = /single quotes/.test(message) ? 'a "…" string ends on its line: close the quote there, or write prose over several lines between """ lines'
      : /three quotes/.test(message) ? 'a """ string spans lines: put the opening """ at the end of the node line and the closing """ on its own line' : null;
    const brace = /token "\{"/.test(message) ? "a `{` opens the block of the node before it and stays on that node's line: write ` {` right after its last value or closing \"\"\""
      : /token "\}"/.test(message) ? "this `}` closes no open block; find the `{` it belongs to, or remove it" : null;
    report.error(detail.start ? `${detail.start.line}:${detail.start.column}` : null, message,
      quotes ?? (unclosed ? 'a quoted string or a { } block is not closed; write prose over several lines between """ lines' : brace ?? V2_HINT));
  }
}

/** Validate one flow file. Returns {report, stats}; stats is null when the file does not parse. */
export function check(flowPath, skillDir, draft = false) {
  const report = new Report(flowPath, draft);
  let text, doc;
  try {
    ({text, doc} = load(flowPath));
  } catch (error) {
    if (!(error instanceof InvalidKdlError)) throw error;
    syntaxErrors(report, error);
    return {report, stats: null};
  }

  const names = new Map(), tools = new Map(), written = new Map(), described = new Set(), used = new Set(), missingSkill = [], refs = new Map();
  const spellings = new Map(), casePairs = new Set(); // lower-case tool name -> [first spelling, its line]; spelling pairs already warned
  // a script that an invariant names has its shared failure handling there, so a step that runs it needs no on-fail of its own
  const shared = new Set(doc.nodes.filter((node) => node.getName() === "context").flatMap(kids).filter((kid) => kid.getName() === "invariant")
    .flatMap((kid) => [...String(argsProps(kid)[0][0] ?? "").matchAll(SCRIPT)].map((match) => "scripts/" + match[1])));
  const sameEnds = new Map(); // end reason -> [[on-fail line, the scripts its step runs]] of each on-fail that holds only that end
  const proseSizes = []; // [line, characters] of each node's prose, so the size warning can name the longest
  const stats = {phase: 0, step: 0, decide: 0, end: 0, by: {}, invariants: {code: 0, human: 0, llm: 0, unstated: 0}};
  const humanRules = []; // lines of the by=human invariants: each needs a gate or a by=human node somewhere in the flow
  const count = (by) => { stats.by[by] = (stats.by[by] ?? 0) + 1; };

  function needName(node, args, line) {
    const name = node.getName();
    if (!args.length) report.error(line, `\`${name}\` needs a name`, "names are bare words without spaces, e.g. `step draft-notes`");
    else if (!isName(args[0])) {
      const hint = ["decide", "gate"].includes(name) ? `put a name before the question: ${name} approved "Is it approved?"` : "use a bare word such as `collect-changes`";
      report.error(line, `name ${JSON.stringify(args[0])} of \`${name}\` contains spaces or is not text`, hint);
    } else if (names.has(args[0])) report.error(line, `name \`${args[0]}\` is already used on line ${names.get(args[0])}`, "phase, step, decide, and gate names are unique in the file");
    else names.set(args[0], line);
  }

  function checkFile(value, by, line) {
    const target = String(value);
    if (by !== "code") report.error(line, "`file=` is only for code steps", "name reference files in the step's prose");
    else if (isAbsolute(target) || target.split("/").includes("..")) report.error(line, `\`file=${target}\` must be a path inside the skill folder`, 'e.g. file="scripts/collect.sh"');
    else if (skillDir === null) {
      if (!missingSkill.length) report.gap(line, "cannot check `file=` paths without the target skill folder", SKILL_HINT);
      missingSkill.push(line);
      report.noSkill = true; // the `next:` line names --skill and skill=, not --draft
    } else if (!isFile(join(skillDir, target))) report.gap(line, `file \`${target}\` does not exist in ${skillDir}`, "fix the path or the skill");
    else if (!realpathSync(join(skillDir, target)).startsWith(realpathSync(skillDir) + sep)) report.error(line, `\`file=${target}\` leads outside the skill folder`, "point at a file inside the skill");
  }

  function walk(node, parent, level, failing = false) {
    const line = lineOf(node), name = node.getName(), [args, props] = argsProps(node), children = kids(node);
    const local = ACTIONS.has(parent) && (name === "input" || name === "output");
    if (name === "use-when") {
      report.error(line, "`use-when` is no longer part of SkillFlow", "delete the line: the target skill's description says when the skill runs");
      return;
    }
    if (!CHILDREN[parent].includes(name)) {
      // where the node fits, so a reader moves it instead of deleting it; a node indented under another without { } lands here too
      const homes = Object.keys(CHILDREN).filter((key) => CHILDREN[key].includes(name)).map((key) => key || "the top level");
      report.error(line, `\`${name}\` is not allowed ${parent ? `inside \`${parent}\`` : "at the top level"}`, "allowed here: " + CHILDREN[parent].toSorted().join(", ")
        + (homes.length ? `; \`${name}\` belongs in ${homes.join(", ")}: put it in the { } block of such a node` : ""));
      return;
    }
    if (children.length && !Object.hasOwn(CHILDREN, name)) {
      report.error(line, `\`${name}\` takes no children`, "remove its { … } block");
      return;
    }
    // the parser keeps type annotations apart from values; SkillFlow has them only as the kind of a tool
    if (node.getTag() !== null) report.error(line, `type annotation \`(${node.getTag()})\` is not part of SkillFlow`, "remove the ( ) before the name");
    for (const entry of node.entries) {
      const tag = entry.getTag(), tool = name === "tools" && !entry.name;
      if (tag === null || (tool && TOOL_KINDS.includes(tag))) continue;
      if (tool) report.error(line, `\`(${tag})\` is not a tool kind`, "tool kinds: (agent) for a subagent, (mcp) for a tool of an MCP server; any other tool takes none");
      else report.error(line, `type annotation \`(${tag})\` is not part of SkillFlow`, "remove the ( ) before the value; only a name in `tools` takes one: (agent) or (mcp)");
    }
    for (const prop of props.keys()) {
      if (name === "gate" && prop === "by") report.error(line, "`gate` has no `by=`", "a gate is always by=human; use decide for other executors");
      else if (!(PROPS[name] ?? []).includes(prop)) report.error(line, `unknown property \`${prop}\` on \`${name}\``, "properties: skill-version, skillflow-version, skill on skillflow; by, file, skill on step; by on decide and invariant; ref on phase, step, decide, gate, when, invariant, input, output");
    }
    if (props.has("ref") && (PROPS[name] ?? []).includes("ref")) {
      const ref = props.get("ref");
      if (typeof ref !== "string" || !ref.trim() || /[\r\n]/u.test(ref)) report.error(line, "`ref` must be a quoted label on one line", 'ref="S3"');
      else if (refs.has(refKey(ref))) report.error(line, `ref "${ref}" is already used on line ${refs.get(refKey(ref))[1]}`, "a label of the skill links one element of the flow");
      else {
        refs.set(refKey(ref), [ref, line]);
        if (chars(ref) > REF_CHARS) report.warn(line, `ref "${cut(ref, REF_CHARS)}…" is long (${chars(ref)} characters)`, "use the leading part of the label, such as the ID before ' — '");
      }
    }
    if (name === "step" && props.has("skill") && !isName(props.get("skill"))) report.error(line, `\`skill=${props.get("skill")}\` is not a skill name`, "skill=other-skill");
    const [most, proseAt] = local ? [2, null] : ARGS[name] ?? [null, null];
    if (most !== null && args.length > most) report.error(line, `\`${name}\` has ${args.length - most} extra argument(s)`, local ? `write one \`${name} <name> "description"\` per data name` : "put all prose into one quoted string");
    if (local && args.length === 2 && typeof args[1] !== "string") report.error(line, `the description of an \`${name}\` must be a quoted string`, `${name} draft "what it is"`);
    if (proseAt !== null && args.length > proseAt && typeof args[proseAt] !== "string") report.error(line, `prose of \`${name}\` must be a quoted string`, `${name} … "text"`);
    else if (proseAt !== null && args.length > proseAt && !["input", "output"].includes(name)) {
      const text = args[proseAt];
      proseSizes.push([line, chars(text)]);
      const items = text.split(/\r\n|\r|\n/).filter((row) => LIST_ROW.test(row));
      if (items.length > PROSE_ITEMS || (!items.length && chars(squash(text)) > PROSE_CHARS))
        report.warn(line, items.length ? `prose of \`${name}\` is long (${items.length} items)` : `prose of \`${name}\` is long (${chars(text)} characters)`,
          `keep intent in ${PROSE_CHARS} characters or a list of ${PROSE_ITEMS} items; details stay in the skill`);
    }
    if (LEVELS.has(name)) {
      // top-level phases organize the flow and drive Route without eating into the 3-level logic depth
      if (!(name === "phase" && parent === "")) level += 1;
      stats[name === "gate" ? "decide" : name] += 1;
      if (level > 3 && !failing) report.warn(line, `\`${name}\` is nested ${level} levels deep`, "keep nesting within 3 levels inside top-level phases; a branch that continues can be left out of a one-`when` decide, with its nodes after the `decide` (grammar rule 3)");
      needName(node, args, line);
    }
    if (name === "step" || name === "decide") {
      const by = props.get("by") ?? null;
      if (EXECUTORS.includes(by)) count(by);
      else if (by === null) report.gap(line, `\`${name}\` needs an executor`, "add by=llm, by=code, or by=human");
      else report.error(line, `\`${name}\` has by=${by}`, "use by=llm, by=code, or by=human");
      if (props.has("file")) checkFile(props.get("file"), by, line);
    }
    if (name === "gate") count("human");
    // optional: who keeps the rule; an invariant without `by` does not say
    if (name === "invariant") {
      const by = props.get("by");
      if (props.has("by") && !EXECUTORS.includes(by)) report.error(line, `\`invariant\` has by=${by}`, "use by=code, by=human, or by=llm: who keeps the rule");
      // an invalid by is an error above and is in no count
      if (EXECUTORS.includes(by)) stats.invariants[by] += 1;
      else if (!props.has("by")) stats.invariants.unstated += 1;
      // by=code rests on a script; a sentence that names none gives the reader nothing to open
      if (by === "code" && !SCRIPT_FILE.test(String(args[0] ?? "")))
        report.warn(line, "`invariant` has by=code, but its sentence names no script", "name the script that fails or blocks on the broken rule, such as scripts/check.py; a rule that no script keeps is by=llm or by=human");
      if (by === "human") humanRules.push(line);
    }
    if (name === "decide" || name === "gate") {
      if (args.length < 2 || typeof args[1] !== "string" || !args[1].trim())
        report.gap(line, `\`${name}\` needs a question after its name`, name === "decide" ? 'decide approved "Is the draft approved?" by=human' : 'gate approved "Is the draft approved?"');
      const whens = children.filter((kid) => kid.getName() === "when"), outcomes = whens.map((kid) => argsProps(kid)[0].slice(0, 1));
      // a bare `when` adds no fact: a one-`when` decide implies the other outcome (rule 3), so say why it does nothing or drop it
      for (const when of whens) {
        const [whenArgs] = argsProps(when);
        if (whenArgs.length === 1 && isName(whenArgs[0]) && !kids(when).length)
          report.gap(lineOf(when), `\`when ${whenArgs[0]}\` has no prose and no block`, name === "decide" && whens.length === 2
            ? "delete it: with one `when` left, the other outcome is implied and continues after the decide"
            : `add prose saying why this outcome does nothing: when ${whenArgs[0]} "…"`);
      }
      if (!outcomes.length && name === "decide") report.gap(line, "`decide` has no `when`", "add one `when <outcome>` per answer");
      // a decide is a fork of the path: with no node and no `end` in any `when`, every answer continues the same way
      if (name === "decide" && whens.length && !whens.some((when) => kids(when).some((kid) => FLOW.has(kid.getName()))))
        report.warn(line, "`decide` forks no path: no `when` holds a node or an `end`", props.get("by") === "human"
          ? 'the answer is a value: write `input <name> "…"` on the node that asks, with the values in its description'
          : "say the choice in the prose of a step, with an `output <name>` when a later node needs it");
      const seen = new Set();
      for (const outcome of outcomes) {
        if (outcome.length && seen.has(outcome[0])) report.error(line, `outcome \`${outcome[0]}\` appears twice`, "give each `when` its own outcome word");
        outcome.forEach((value) => seen.add(value));
      }
    }
    if (name === "when" && (!args.length || !isName(args[0]))) report.error(line, "`when` needs an outcome word", "when yes, when no, when skipped");
    if (name === "step" && children.filter((kid) => kid.getName() === "on-fail").length > 1) report.error(line, "`step` has more than one `on-fail`", "merge them into one");
    if (name === "on-fail" && !args.length && !children.some((kid) => FLOW.has(kid.getName()))) report.gap(line, "`on-fail` is empty", 'say what happens: prose, steps, or end "reason"');
    if (name === "on-fail") {
      // failure items: the on-fail's own prose and the prose of its child steps
      const texts = args.length ? [String(args[0])] : [];
      for (const kid of children) { const kidArgs = argsProps(kid)[0]; if (kid.getName() === "step" && kidArgs.length > 1) texts.push(String(kidArgs[1])); }
      if (children.some((kid) => kid.getName() === "end") && texts.some((text) => CONTINUES.test(text)))
        report.warn(line, "`on-fail` holds an `end`, but its prose says the flow continues", "put the end in a `decide` on the condition that separates stopping items from continuing ones");
      const items = texts.flatMap(proseItems);
      if (items.length && items.every((item) => STOPS.test(item)) && ![...descendants(node)].some((kid) => kid.getName() === "end"))
        report.warn(line, "every item of `on-fail` stops the flow, but it holds no `end`", 'add end "reason" inside the on-fail');
    }
    if (name === "step") {
      // a script named in prose counts too: `scripts/x.sh` or a bare `x.sh` under scripts/
      const named = new Set([...(args.length > 1 ? String(args[1]) : "").matchAll(SCRIPT)].map((match) => "scripts/" + match[1]));
      if (props.has("file")) named.add(String(props.get("file")));
      const onFail = children.find((kid) => kid.getName() === "on-fail"), stops = onFail ? kids(onFail).filter((kid) => FLOW.has(kid.getName())) : [];
      // an on-fail that only ends the flow: deleting it loses no node, so equal reasons can become one invariant
      if (stops.length === 1 && stops[0].getName() === "end") {
        const why = squash(String(argsProps(stops[0])[0][0] ?? "")).toLowerCase().replace(/[.!\s]+$/u, "");
        if (why) sameEnds.set(why, [...(sameEnds.get(why) ?? []), [lineOf(onFail), [...named]]]);
      }
      for (const script of onFail || skillDir === null ? [] : [...named].filter((script) => !shared.has(script)).sort()) {
        const path = join(skillDir, script), size = statOrNull(path);
        if (!script.split("/").includes("..") && size?.isFile() && size.size <= READ_LIMIT && FAILURE.test(readText(path) ?? "")) {
          report.warn(line, `\`${script}\` has failure messages, but the step has no \`on-fail\``, "give each failure the skill handles an on-fail item with its next node or end; a failure that several steps share is one invariant that names the script");
          break;
        }
      }
    }
    if (name === "end") stats.end += 1;
    if (local) {
      const item = args.length ? String(args[0]) : "";
      if (!isName(args[0])) report.error(line, `\`${name}\` needs one data name`, `${name} draft`);
      // a node names the data it makes: `output` for what the skill produces, `input` for what it asks the user for here; what it reads is in its prose
      else {
        if (!written.has(item)) written.set(item, [line, name]);
        if (args.length === 2) described.add(item);
      }
    } else if (name === "input" && (!args.length || !isName(args[0]))) report.error(line, "`input` needs a name", 'input tag "the git tag to describe"');
    else if (name === "input" && args.length === 1) report.gap(line, "a flow `input` needs a quoted description", 'input tag "the git tag to describe"'); // a bare `input x` would make x available on every path
    if ((parent === "context" || local) && (name === "input" || name === "output")) {
      // a description is quoted, so `output summary` cannot pass as prose or `input a b` as two names
      const at = parent === "context" && name === "output" && args.length === 1 ? 0 : 1, entry = node.entries.filter((e) => !e.name)[at];
      if (entry && typeof entry.getValue() === "string" && !/^#*"/.test(entry.value.representation ?? '"'))
        report.error(line, `the description of ${local ? "an" : "a flow"} \`${name}\` must be a quoted string`, `${name} <name> "description"`);
    }
    if (name === "invariant" && !String(args[0] ?? "").trim()) report.gap(line, `\`${name}\` takes one quoted sentence`, `${name} "…"`);
    if (name === "output" && !local) {
      if (args.length === 2 && isName(args[0])) used.add(args[0]); // a named result counts as read: it leaves the flow
      else if (args.length !== 1 || typeof args[0] !== "string") report.error(line, "`output` takes a sentence, or a name and a sentence", 'output notes "the release notes"');
    }
    if (name === "tools") {
      if (!args.length) report.error(line, "`tools` lists nothing", "tools <name> …");
      for (const item of args) if (!isName(item)) report.error(line, `\`${item}\` in \`tools\` is not a bare word`, "tool names have no spaces");
      for (const entry of node.entries) {
        if (entry.name) continue;
        const item = String(entry.getValue()), kind = entry.getTag() ?? "";
        // one tool has one kind: the page shows a tool once, with one glyph
        if (tools.has(item) && tools.get(item) !== kind) report.error(line, `tool \`${item}\` has another kind here than at its first use`, "write the same (agent) or (mcp) before every use of one tool, or none at every use");
        else tools.set(item, kind);
        if (!kind && INTERPRETERS.has(item.toLowerCase()))
          report.warn(line, `\`${item}\` in \`tools\` is an interpreter, not a tool`, "name the script of the skill in the step's prose, or write a fixed command as step by=code file=\"scripts/x.py\"; tools names external tools");
        const key = item.toLowerCase(), [first, firstLine] = spellings.get(key) ?? [item, line];
        if (!spellings.has(key)) spellings.set(key, [item, line]);
        else if (first !== item && !casePairs.has(first + "\0" + item)) {
          casePairs.add(first + "\0" + item);
          report.warn(line, `tools \`${first}\` (line ${firstLine}) and \`${item}\` differ only in letter case`, "write one spelling at every use of the tool");
        }
      }
    }
    // a recovery is a side path: what an on-fail holds stays on its step's level, so its decide adds no depth warning
    for (const kid of children) walk(kid, name, name === "on-fail" ? level - 1 : level, failing || name === "on-fail");
  }

  const nodes = doc.nodes;
  stats.versions = {skill: headerProp(doc, "skill-version"), skillflow: headerProp(doc, "skillflow-version"), installed: installedVersion()};
  const head = checkHeader(report, nodes, skillDir, flowPath, stats.versions.installed);
  const inputs = new Set(), results = [], origins = new Map(); // origins: data name -> the line that names it first
  nodes.forEach((node, index) => {
    if (node.getName() === "skillflow" && index > 0) {
      report.error(lineOf(node), "`skillflow` appears twice", "keep only the first line");
      return;
    }
    if (node.getName() === "context") {
      if (index !== (head ? 1 : 0) || nodes.slice(0, index).some((other) => other.getName() === "context"))
        report.error(lineOf(node), "`context` must come once, right after `skillflow 1.0`", "move it to the top");
      const seen = new Set();
      for (const kid of kids(node).filter((kid) => kid.getName() === "input" && argsProps(kid)[0].length)) {
        const inputName = String(argsProps(kid)[0][0]);
        if (seen.has(inputName)) report.error(lineOf(kid), `input \`${inputName}\` appears twice`, "give each input its own name");
        seen.add(inputName);
        inputs.add(inputName);
        if (!origins.has(inputName)) origins.set(inputName, lineOf(kid));
      }
      for (const kid of kids(node).filter((kid) => kid.getName() === "output" && argsProps(kid)[0].length === 2 && isName(argsProps(kid)[0][0])))
        results.push([String(argsProps(kid)[0][0]), lineOf(kid)]);
    }
    walk(node, "", 0);
  });
  if (!stats.by.human) for (const line of humanRules)
    report.warn(line, "`invariant` has by=human, but the flow has no gate and no by=human node", "add the gate or the by=human step where a person checks the rule; a rule that only the instructions keep is by=llm");
  checkSize(report, text, skillDir, proseSizes);
  for (const uses of sameEnds.values()) {
    if (uses.length < SAME_ENDS) continue;
    const scripts = [...new Set(uses.flatMap(([, named]) => named))].sort();
    report.warn(uses[0][0], `${uses.length} \`on-fail\` blocks (lines ${uses.map(([at]) => at).join(", ")}) end the flow with the same reason`,
      `write one \`invariant\` that says where this failure goes${scripts.length ? `, naming ${scripts.join(", ")}` : ""}, and delete these on-fail blocks; an on-fail holds only a failure that is its step's own`);
  }
  // the node that delivers a named flow output may write it although the name exists (a flow input it updates)
  const resultNames = new Set(results.map(([item]) => item));
  for (const [item, [line]] of written) if (!origins.has(item)) origins.set(item, line);
  const atEnd = follow(nodes, new Set(inputs), report, {results: resultNames, origins});
  const closing = nodes.at(-1)?.getName() === "end" ? nodes.at(-1) : null; // a top-level `end` after the last node
  // strict pass: a continuing on-fail keeps only the data it restores; what it finds beyond the first pass is a warning
  const strict = new Report(flowPath), strictEnd = trace(nodes, {have: new Set(inputs), lost: new Map()}, {report: strict, results: resultNames, origins: new Map()});
  // a named flow output leaves the flow at its end: every path that reaches the end must have produced it; `end` stops a path early
  // a flow input of the same name is the old state, not the result: a node must produce the result
  const updated = new Set(results.map(([item]) => item).filter((item) => inputs.has(item)));
  const fresh = [...inputs].filter((item) => !updated.has(item));
  const freshEnd = updated.size ? follow(nodes, new Set(fresh), new Report(flowPath), {results: resultNames}) : atEnd;
  const freshStrict = updated.size ? trace(nodes, {have: new Set(fresh), lost: new Map()}, {report: new Report(flowPath), results: resultNames, origins: new Map()}) : strictEnd;
  let closingWarned = false;
  for (const [item, line] of results) {
    const end = updated.has(item) ? freshEnd : atEnd, endStrict = updated.has(item) ? freshStrict : strictEnd;
    if (end === null) {
      if (closing) closingWarned = true;
      report.warn(line, `flow output \`${item}\` cannot leave the flow: every path stops at an \`end\``, closing
        ? `drop the closing top-level \`end\` on line ${lineOf(closing)}: the flow ends after its last node anyway`
        : "let one path reach the end of the flow, or drop the name from the output");
    }
    else if (!end.has(item)) report.gap(line, `flow output \`${item}\` is not produced on every path that reaches the end of the flow`, `add \`output ${item}\` to a node on every such path, or drop the name from the output`);
    else if (!endStrict.have.has(item)) report.warn(line, `flow output \`${item}\` ${onlyWhen(endStrict.lost.get(item))}`, restoreHint(item));
  }
  if (closing && !closingWarned)
    report.warn(lineOf(closing), "closing top-level `end` is unnecessary", "drop it: the flow ends after its last node anyway; keep `end` for early exits");
  // data is born once: the first `output` of a name says what it is; a flow input or a named flow output has its description in context
  const declared = new Set([...inputs, ...results.map(([item]) => item)]);
  for (const [item, [line, kind]] of written) if (!described.has(item) && !declared.has(item)) report.warn(line, `${kind} \`${item}\` has no description`, `say what it is where it first appears: ${kind} ${item} "…"`);
  // a ref is checked against the skill only when the skill folder is known
  const anchors = skillDir === null ? null : findAnchors(skillDir, [...refs.values()].map(([ref]) => ref));
  if (!anchors && refs.size) report.warn([...refs.values()][0][1], "cannot check `ref=` labels without the target skill folder", SKILL_HINT);
  for (const [ref, line] of refs.values()) if (anchors && !anchors[ref].length)
    report.warn(line, `ref "${ref}" has no defining place in the skill`, "write the label as the skill writes it at a heading, a first table cell, a list item, or a bold label; or remove the ref");
  stats.refs = refs.size;
  stats.refsFound = anchors && Object.values(anchors).filter((places) => places.length).length;
  const counted = new Set(unclearLines(text).map(([line]) => line));
  stats.unclear = counted.size;
  // the parser keeps the space around nodes and entries apart from their strings, so a `//` inside a string never reaches it
  // shortcut: a mark after a line continuation right before `{`, or after a slashdashed last node of the file, gets no warning; upgrade when a flow file writes one
  for (const node of doc.nodes.flatMap((top) => [top, ...descendants(top)])) {
    const at = getLocation(node);
    const lines = [...markLines(node.leading, startOf(node.leading, at.start.line)), ...markLines(node.trailing, at.end.line),
      ...node.entries.flatMap((entry) => markLines(entry.leading, startOf(entry.leading, getLocation(entry).start.line)))];
    for (const line of lines) if (!counted.has(line))
      report.warn(line, "a `// ?` mark after a node on the same line is not counted as an unclear place", "move it to its own line directly above the node: // ? <what is unclear> (<file>:<line>)");
  }
  stats.tools = [...tools.keys()].sort();
  return {report, stats, anchors};
}

/**
 * The first line: `skillflow 1.0`, its `skill-version` against the skill's version, its `skillflow-version` against
 * the `installed` SkillFlow, and the folder that `skill=` names. Returns the `skillflow` node or null.
 */
function checkHeader(report, nodes, skillDir, flowPath, installed) {
  const head = nodes[0]?.getName() === "skillflow" ? nodes[0] : null;
  const first = head && head.entries.filter((entry) => !entry.name);
  if (!head) report.error(1, "the file must start with `skillflow 1.0`", "first line: skillflow 1.0");
  else if (first[0]?.value.representation !== "1.0") {
    report.error(lineOf(head), `format version must be 1.0, got ${first.map((entry) => entry.value.representation).join(" ") || "nothing"}`, "first line: skillflow 1.0");
  } else {
    const props = argsProps(head)[1], line = lineOf(head), stamp = props.get("skill-version"), checked = props.get("skillflow-version"), named = props.get("skill");
    for (const [key, value, example] of [["skill-version", stamp, "0.2"], ["skillflow-version", checked, installed ?? "2026.11.16.1"], ["skill", named, "../my-skill"]])
      if (value != null && typeof value !== "string") report.error(line, `\`${key}\` must be a quoted string`, `skillflow 1.0 ${key}="${example}"`);
    const current = skillDir === null ? null : skillVersion(join(skillDir, "SKILL.md"));
    if (typeof stamp === "string" && skillDir === null) report.warn(line, `cannot compare skill-version ${stamp} with the skill without the target skill folder`, SKILL_HINT);
    else if (typeof stamp === "string" && current !== null && current !== stamp) report.warn(line, `the flow was synced with skill version ${stamp}, but SKILL.md says ${current}`, "run check mode, then sync and update skill-version");
    // a draft has not passed reverse or sync yet, which write the stamp
    else if (stamp == null && current !== null && !report.draft) report.warn(line, `the flow has no skill-version, but SKILL.md says ${current}`, "run check mode, then sync, which writes skill-version");
    if (typeof checked === "string" && installed !== null && compareVersions(checked, installed) === 1)
      report.warn(line, `the flow was checked with SkillFlow ${checked}, newer than the installed SkillFlow ${installed}`, `update SkillFlow to ${checked} or later: an older one may not know the rules this flow follows`);
    // --skill overrides skill=: a folder found another way makes a wrong skill= no error
    if (typeof named === "string" && skillDir === null && !isFile(join(skillAt(flowPath, named), "SKILL.md")))
      report.error(line, `skill="${named}" names no folder with SKILL.md: ${skillAt(flowPath, named)}`, "write the path from the flow file to the target skill folder, or pass --skill <dir>");
  }
  return head;
}

/** Warn when the flow is too long to be a short view of its skill; `proseSizes` are [line, characters] of each node's prose. */
function checkSize(report, text, skillDir, proseSizes) {
  // a flow as long as its skill is a second copy of it, not a view a person reviews in minutes
  // `// ?` lines are the open questions reverse must keep, so they do not count
  const sized = text.split(KDL_LINES).filter((line) => !UNCLEAR.test(line)).join("\n");
  const skillMd = skillDir === null ? null : resolve(skillDir, "SKILL.md"), main = skillMd && chars(sized) > FLOW_SMALL ? readText(skillMd) : null;
  if (main !== null) {
    // the skill text is SKILL.md and every Markdown file of the skill it names: a router SKILL.md keeps its process in references
    const named = new Set((main.match(/[\w./-]+\.md\b/g) ?? []).map((name) => resolve(skillDir, name)));
    const parts = [...named].filter((file) => file !== skillMd && file.startsWith(resolve(skillDir) + sep) && isFile(file));
    const size = parts.reduce((sum, file) => sum + chars(readText(file) ?? ""), chars(main));
    const share = Math.round(100 * chars(sized) / Math.max(1, size));
    // the numbers and the longest prose, so a reader cuts the right nodes once instead of measuring by hand
    const limit = Math.max(FLOW_SMALL, Math.floor(size * FLOW_SHARE / 100));
    const longest = proseSizes.toSorted(([, x], [, y]) => y - x).slice(0, 3).map(([at, length]) => `line ${at} (${length})`).join(", ");
    if (share > FLOW_SHARE) report.warn(1, `the flow without its \`// ?\` lines has ${chars(sized)} characters; the limit is ${limit}: ${FLOW_SHARE}% of the ${size} characters of SKILL.md${parts.length ? ` and the ${parts.length === 1 ? "Markdown file" : `${parts.length} Markdown files`} it names` : ""}, but at least ${FLOW_SMALL}; cut about ${chars(sized) - limit}`,
      `keep each node's prose to its intent; details, lists, and rules about the result stay in the skill${longest ? `; longest prose: ${longest}` : ""}`);
  }
}

/** Data that a `when` or an `on-fail` outputs itself, with no node of its own. */
const ownOutputs = (node) => new Set(kids(node).filter((kid) => kid.getName() === "output").flatMap(values));
const onlyWhen = (step) => (step === undefined ? "exists only when an earlier step succeeds" : `exists only when step \`${step}\` succeeds`) + ": its `on-fail` continues without it";
const restoreHint = (item) => `add \`output ${item}\` to that on-fail when the recovery gives it, or let the on-fail reach \`end\``;

/** The state where several paths meet: data that all of them have, and the drops recorded on any of them. */
function merge(states) {
  const have = states.map((state) => state.have).reduce((all, one) => all.intersection(one));
  const lost = states[0].lost && new Map(states.flatMap((state) => [...state.lost]).filter(([item]) => !have.has(item)));
  return {have, lost};
}

/**
 * Check data along every path of a block; return the data available after it, or null when the block always ends.
 * `results` are the flow's named outputs: a node may write one although the name exists.
 * `origins` maps a data name to the line that names it first, so a warning can point at both lines.
 */
export const follow = (nodes, available, report, {results = new Set(), origins = new Map()} = {}) =>
  trace(nodes, {have: available, lost: null}, {report, results, origins})?.have ?? null;

/** The hint's lead when another line names the data first: the warning cannot tell which of the two lines is wrong. */
const firstAt = (origins, item, line) => (origins.has(item) && origins.get(item) !== line ? `line ${origins.get(item)} names it first, and it may be the mistake: fix that line, or ` : "");

/**
 * follow() with path state {have, lost} and the run's {report, results}; returns the state after the block, or null when the block always ends.
 * An on-fail that continues counts as recovered: the step's data stays available after it (grammar rule 5).
 * In the strict pass `lost` is a Map: a step keeps only the data that its continuing on-fail also has, and `lost`
 * maps each dropped name to that step, along the paths that carry the drop. check() runs this pass for warnings.
 */
function trace(nodes, at, run) {
  const {report, results, origins} = run;
  const flow = nodes.filter((node) => FLOW.has(node.getName()));
  for (const [index, node] of flow.entries()) {
    const name = node.getName();
    let after;
    if (name === "end") after = null;
    else if (name === "phase") after = trace(kids(node), at, run);
    else {
      const written = new Set();
      for (const kid of kids(node)) {
        if (kid.getName() === "output") for (const item of values(kid)) {
          // an update is not written: the name exists already, and the node's prose says what changes
          if (at.have.has(item) && at.lost === null && !results.has(item)) report.warn(lineOf(kid), `output \`${item}\` exists already: an update is not written`, `${firstAt(origins, item, lineOf(kid))}drop this line and say the change in the node's prose`);
          written.add(item);
        }
        // the skill asks the user for an input here: it is new data, so a name that every path already has is a read, and reads are prose
        if (kid.getName() === "input") for (const item of values(kid)) {
          if (at.have.has(item) && at.lost === null) report.warn(lineOf(kid), `input \`${item}\` exists already: reading is prose`, `${firstAt(origins, item, lineOf(kid))}drop this line and say in the node's prose what it reads; a node \`input\` names what the skill asks the user for here`);
          written.add(item);
        }
      }
      // data produced again replaces an earlier drop
      after = {have: at.have.union(written), lost: at.lost && new Map([...at.lost].filter(([item]) => !written.has(item)))};
      for (const kid of kids(node)) if (kid.getName() === "on-fail") {
        // the handler starts without the step's data; its own outputs are what the recovery restores
        const handled = trace(kids(kid), {have: at.have.union(ownOutputs(kid)), lost: at.lost}, run);
        if (after.lost && handled !== null) for (const item of after.have.difference(handled.have)) {
          after.have.delete(item);
          after.lost.set(item, String(argsProps(node)[0][0]));
        }
      }
      if (name === "decide" || name === "gate") {
        const whens = kids(node).filter((kid) => kid.getName() === "when");
        // a `when` may write data itself: the choice it stands for
        const branches = whens.map((when) => trace(kids(when), {have: after.have.union(ownOutputs(when)), lost: after.lost}, run));
        // implied outcomes that continue: a gate's `approved` unless a `when approved` overrides it, and the other outcome of a one-`when` decide
        if (name === "gate" ? !whens.some((when) => argsProps(when)[0][0] === "approved") : whens.length === 1) branches.push({have: new Set(after.have), lost: after.lost});
        const live = branches.filter((branch) => branch !== null);
        after = live.length ? merge(live) : branches.length ? null : after;
      }
    }
    if (after === null) {
      if (index + 1 < flow.length) report.error(lineOf(flow[index + 1]), `\`${flow[index + 1].getName()}\` never runs: every path before it ends`, "move it into a branch that continues, or remove the `end`");
      return null;
    }
    at = after;
  }
  return at;
}

export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `OK` or `FAIL`, the flow, and the counts, so a reader of the first line knows whether warnings remain. */
export function status(report, flow) {
  const counts = [[report.errors, "error"], [report.todos, "todo item"], [report.warnings, "warning"]]
    .filter(([items]) => items.length).map(([items, word]) => plural(items.length, word)).join(", ");
  return (report.errors.length ? "FAIL " : "OK ") + (report.draft ? "(draft) " : "") + flow + (counts ? ` · ${counts}` : "");
}

/** The todo items of a draft as [{line, message}] in line order, for the page; null for a flow with none. */
export const draftGaps = (report) => (report.todos.length
  ? report.todos.toSorted(([x], [y]) => (x ?? 0) - (y ?? 0)).map(([line, message, hint]) => ({line, message: hint ? `${message}: ${hint}` : message})) : null);

// found/total when the skill folder is known; nothing when the flow has no refs
const refsPart = ({refs, refsFound}) => (refs ? ` · refs ${refsFound === null ? "" : refsFound + "/"}${refs}` : "");

export function summary(stats) {
  // `unstated` invariants have no `by`; with the llm ones they are the rules that only the instructions keep
  const rules = Object.values(stats.invariants).some(Boolean) ? Object.entries(stats.invariants).map(([key, value]) => `${key} ${value}`).join(" · ") : "-";
  const by = Object.entries(stats.by).sort(([x], [y]) => (x < y ? -1 : 1)).map(([key, value]) => `${key} ${value}`).join(", ") || "-";
  return `  phases ${stats.phase} · steps ${stats.step} · decisions ${stats.decide} · ends ${stats.end} · executors: ${by} · ❓ ${stats.unclear}${refsPart(stats)}\n  tools: ` + (stats.tools.join(", ") || "-") + `\n  invariants: ${rules}`
    + `\n  versions: skill-version ${stats.versions.skill ?? "-"} · skillflow-version ${stats.versions.skillflow ?? "-"} · installed SkillFlow ${stats.versions.installed ?? "-"}`;
}
