// Deterministic, self-contained interactive HTML page for a SkillFlow file.
// The page inlines a JSON model of the flow with the static viewer in ../assets/ (viewer/*.js, viewer.css,
// help.html). Flow text reaches the page only as JSON data, which the viewer shows as text.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {argsProps, FLOW, follow, headerProp, installedVersion, kids, lineOf, parseFlow, Report, TOOL_KINDS, unclearLines} from "./validate.mjs";

// the SkillFlow version that builds a page, so a reader can tell which viewer and rules made it
const SKILLFLOW_VERSION = installedVersion();

const ASSETS = join(import.meta.dirname, "..", "assets");
const DRAWN = new Set([...FLOW, "when", "context"]);
const IMPLIED = [["approved", "the flow continues"], ["revise", "the person asks for changes: the work before is redone and the gate asks again"]];
// flow-file node -> list key on a model node
const KEY = {tools: "tools", input: "inputs", output: "outputs"};
const ROLE_ORDER = ["output", "input", "uses"];

/** True when every path through this block reaches `end`; the validator's path rules decide, so the page and the check agree. */
const ends = (nodes) => follow(nodes, new Set(), new Report("")) === null;

/** Attach each `// ?` line to the first node after it, shown on the nearest node the page draws. */
function unclearMarks(doc, text) {
  const starts = [];
  const visit = (node, drawn) => {
    drawn = DRAWN.has(node.getName()) ? node : drawn;
    if (lineOf(node)) starts.push([lineOf(node), drawn]);
    for (const kid of kids(node)) visit(kid, drawn);
  };
  for (const node of doc.nodes) visit(node, null);
  starts.sort((x, y) => x[0] - y[0]);
  const marks = new Map(), orphans = [];
  for (const [number, note] of unclearLines(text)) {
    const target = starts.find(([start]) => start > number)?.[1] ?? null;
    if (target === null) orphans.push(note);
    else marks.set(target, [...(marks.get(target) ?? []), note]);
  }
  return {marks, orphans};
}

const textAt = (args, index) => (typeof args[index] === "string" ? args[index] : "");
// a ref is set only where the flow writes one, so models of flows without refs stay as they were
const setRef = (out, props) => { if (typeof props.get("ref") === "string") out.ref = props.get("ref"); };

class Builder {
  constructor(doc, text, prefix = "n") {
    this.doc = doc;
    this.prefix = prefix;
    ({marks: this.marks, orphans: this.orphans} = unclearMarks(doc, text));
    this.count = 0;
    // no prototype: data and tool names such as `constructor` or `__proto__` stay plain keys
    this.data = Object.create(null);
    this.tools = Object.create(null);
    this.toolKinds = Object.create(null);
    this.flat = [];
    this.counts = {phase: 0, step: 0, decide: 0, end: 0};
    this.by = Object.create(null);
    this.unclear = [];
  }

  newId() { return `${this.prefix}${++this.count}`; }

  notes(node, owner) {
    const found = this.marks.get(node) ?? [];
    this.unclear.push(...found.map((note) => ({text: note, node: owner})));
    return [...found];
  }

  use(list, value, id) {
    const users = list === "tools" ? (this.tools[value] ??= []) : this.entry(value)[list === "inputs" ? "inputOf" : "outputOf"];
    if (!users.includes(id)) users.push(id);
  }

  /** Names that a `when` or an `on-fail` outputs itself, each once; `producer` is the card credited with them. */
  ownOutputs(node, producer) {
    const names = [];
    for (const kid of kids(node).filter((kid) => kid.getName() === "output")) {
      const [kidArgs, kidProps] = argsProps(kid), value = String(kidArgs[0]);
      if (!names.includes(value)) names.push(value);
      this.use("outputs", value, producer);
      this.dataRef(value, kidProps);
      this.about(value, kidArgs);
    }
    return names;
  }

  entry(name) { return (this.data[name] ??= {input: null, output: null, outputOf: [], inputOf: []}); }

  /** What a data name is: the description on the first `output` line that has one. */
  about(name, args) { if (typeof args[1] === "string") this.entry(name).about ??= args[1]; }

  /** The skill labels that a data name carries on any of its lines, each once. */
  dataRef(name, props) {
    const ref = props.get("ref");
    if (typeof ref !== "string") return;
    const entry = this.entry(name);
    if (!(entry.refs ??= []).includes(ref)) entry.refs.push(ref);
  }

  block(nodes) { return nodes.filter((kid) => FLOW.has(kid.getName())).map((kid) => this.node(kid)); }

  node(node) {
    const [args, props] = argsProps(node), kind = node.getName();
    const out = {id: this.newId(), kind, line: lineOf(node)};
    this.counts[kind === "gate" ? "decide" : kind] += 1; // a gate counts as a decision
    if (kind === "end") {
      out.text = textAt(args, 0);
      out.unclear = this.notes(node, out.id);
      return out;
    }
    if (kind === "phase") {
      Object.assign(out, {name: args.length ? String(args[0]) : "phase", prose: textAt(args, 1), unclear: this.notes(node, out.id)});
      setRef(out, props);
      this.flat.push(out);
      out.children = this.block(kids(node));
      out.ends = ends(kids(node));
      return out;
    }
    const by = kind === "gate" ? "human" : String(props.get("by") ?? "");
    this.by[by] = (this.by[by] ?? 0) + 1;
    const choice = kind === "decide" || kind === "gate";
    Object.assign(out, {name: args.length ? String(args[0]) : "", by, question: choice ? textAt(args, 1) : "", prose: textAt(args, choice ? 2 : 1),
      file: String(props.get("file") ?? ""), skill: String(props.get("skill") ?? "")});
    setRef(out, props);
    out.unclear = this.notes(node, out.id);
    for (const key of Object.values(KEY)) out[key] = [];
    for (const kid of kids(node)) {
      const list = KEY[kid.getName()], [kidArgs, kidProps] = argsProps(kid);
      // a data line names one item (an `output` may add a description); `tools` lists several names
      if (list) for (const value of (list === "tools" ? kidArgs : kidArgs.slice(0, 1)).map(String)) {
        if (!out[list].includes(value)) out[list].push(value);
        this.use(list, value, out.id);
        if (list !== "tools") { this.dataRef(value, kidProps); this.about(value, kidArgs); }
      }
      // the kind of a tool is its type annotation: `tools (agent)reviewer`
      if (list === "tools") for (const entry of kid.entries) if (!entry.name && TOOL_KINDS.includes(entry.getTag())) this.toolKinds[String(entry.getValue())] ??= entry.getTag();
    }
    this.flat.push(out);
    if (kind === "step") {
      const fail = kids(node).find((kid) => kid.getName() === "on-fail");
      out.onfail = null;
      if (fail) {
        const id = this.newId();
        out.onfail = {id, kind: "onfail", line: lineOf(fail), prose: textAt(argsProps(fail)[0], 0), unclear: this.notes(fail, id), step: out.id,
          // what the recovery restores: the on-fail card produces it
          outputs: this.ownOutputs(fail, id)};
        out.onfail.children = this.block(kids(fail));
        out.onfail.ends = ends(kids(fail));
      }
    } else {
      out.whens = [];
      for (const when of kids(node).filter((kid) => kid.getName() === "when")) {
        const [whenArgs, whenProps] = argsProps(when);
        // an outcome's own output: the branch lists it, and the decision is the card that produces it
        const branch = {id: this.newId(), line: lineOf(when), outcome: whenArgs.length ? String(whenArgs[0]) : "?", prose: textAt(whenArgs, 1), unclear: this.notes(when, out.id),
          outputs: this.ownOutputs(when, out.id)};
        setRef(branch, whenProps);
        branch.children = this.block(kids(when));
        branch.ends = ends(kids(when));
        out.whens.push(branch);
      }
      if (kind === "gate") {
        const named = new Set(out.whens.map((branch) => branch.outcome));
        out.implied = IMPLIED.filter(([outcome]) => !named.has(outcome)).map(([outcome, meaning]) => ({outcome, prose: meaning}));
      } else if (out.whens.length === 1) {
        // grammar rule 3: the other outcome of a one-`when` decide continues after it; its label is derived and never repeats the written one
        const derived = new Map([["yes", "no"], ["no", "yes"], ["other", "else"]]).get(out.whens[0].outcome) ?? "other";
        out.implied = [{outcome: derived, prose: "the flow continues after the decide"}];
      }
    }
    return out;
  }

  context() {
    const node = this.doc.nodes.find((kid) => kid.getName() === "context");
    const result = {purpose: "", inputs: [], outputs: [], invariants: [], unclear: []};
    if (!node) return result;
    result.purpose = textAt(argsProps(node)[0], 0);
    result.unclear = this.notes(node, null);
    for (const kid of kids(node)) {
      const [kidArgs, kidProps] = argsProps(kid), kind = kid.getName();
      if (kind === "input" || kind === "output") {
        const [name, desc] = kidArgs.length >= 2 ? [String(kidArgs[0]), textAt(kidArgs, 1)] : ["", textAt(kidArgs, 0)];
        const item = {name, text: desc, line: lineOf(kid)};
        setRef(item, kidProps);
        result[kind + "s"].push(item);
        if (name) { this.entry(name)[kind] = desc; this.dataRef(name, kidProps); }
      } else if (kind === "invariant") {
        const rule = {text: textAt(kidArgs, 0), line: lineOf(kid)};
        if (kidProps.has("by")) rule.by = String(kidProps.get("by")); // who keeps the rule
        setRef(rule, kidProps);
        result.invariants.push(rule);
      }
    }
    return result;
  }

  /**
   * The cards whose prose names a data item (findMention), where no `input` or `output` line links them: a flow input
   * that no step asks for still shows where it matters. `mentionAt` keeps the quote of each, so the page shows why.
   */
  linkMentions(flow) {
    // each field alone, so a name never spans two fields
    const texts = [];
    for (const node of descendants(flow)) {
      for (const text of [node.question, node.prose, node.text]) if (text) texts.push([node.id, text]);
      for (const branch of node.whens ?? []) if (branch.prose) texts.push([node.id, branch.prose]); // a branch's prose belongs to its decision
    }
    for (const [name, entry] of Object.entries(this.data)) {
      const find = mentionOf(name);
      entry.mentionOf = []; entry.mentionAt = {};
      for (const [id, text] of texts) {
        // a card that outputs or asks for the item already has the stronger role
        if (entry.mentionAt[id] || entry.inputOf.includes(id) || entry.outputOf.includes(id)) continue;
        const found = find(text);
        if (found) { entry.mentionOf.push(id); entry.mentionAt[id] = found; }
      }
    }
  }

  /** Match each rule's words against node names, outcomes, data, and tools; the grammar has no explicit link. */
  linkInvariants(invariants) {
    // how many decides and gates have each outcome word: a shared word links only the nodes that the rule also names
    const owners = new Map();
    for (const node of this.flat) for (const outcome of new Set((node.whens ?? []).map((branch) => branch.outcome.toLowerCase()))) owners.set(outcome, (owners.get(outcome) ?? 0) + 1);
    for (const rule of invariants) {
      const words = new Set((rule.text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).map((word) => word.replace(/^-+|-+$/g, "")));
      const roles = new Map(), matched = new Set();
      const mark = (id, role) => {
        const current = roles.get(id);
        if (current === undefined || ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(current)) roles.set(id, role);
      };
      for (const node of this.flat) {
        if (words.has((node.name ?? "").toLowerCase())) { matched.add(node.name); mark(node.id, "uses"); }
        for (const branch of node.whens ?? []) {
          const outcome = branch.outcome.toLowerCase();
          if (words.has(outcome) && outcome !== "yes" && outcome !== "no" && (owners.get(outcome) === 1 || words.has((node.name ?? "").toLowerCase()))) {
            matched.add(branch.outcome);
            mark(node.id, "uses");
            for (const inner of descendants(branch.children)) mark(inner.id, "uses");
          }
        }
      }
      for (const [name, entry] of Object.entries(this.data)) if (words.has(name.toLowerCase())) {
        matched.add(name);
        for (const [role, key] of [["output", "outputOf"], ["input", "inputOf"]]) for (const id of entry[key]) mark(id, role);
      }
      for (const [name, users] of Object.entries(this.tools)) if (words.has(name.toLowerCase())) {
        matched.add(name);
        for (const id of users) mark(id, "uses");
      }
      rule.words = [...matched].sort();
      rule.nodes = Object.fromEntries([...roles.keys()].sort((x, y) => x.slice(1) - y.slice(1)).map((id) => [id, roles.get(id)]));
    }
  }
}

/**
 * Where `text` names the data item `name`, or null: the first whole-word match, in any case, with an English `s` or
 * `es` plural, a `-` in the name also matching a space or a line break. A match inside a longer word, a name joined by
 * `-` or `_`, a path, a file name, or after `@` or `#` does not count. The result quotes one line around the match:
 * {before, word, after}, cut at words, with … where it is cut, and without a list mark at its start.
 */
export const findMention = (text, name) => mentionOf(name)(text);

/** The matcher of findMention for one name, built once: a flow with many cards tests each name against every card. */
export function mentionOf(name) {
  if (!name) return () => null;
  const body = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "(?:-|\\s+)");
  const plural = /[a-z]$/i.test(name) ? "(?:e?s)?" : "";
  // \p{M}: a combining accent is part of the word before it; a slash on either side makes a path
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}_\-/\\.@#$])` + body + plural + String.raw`(?![\p{L}\p{M}\p{N}_\-/\\]|\.[\p{L}\p{N}_])`, "iu");
  return (text) => (text ? quote(text, pattern.exec(text)) : null);
}

function quote(text, match) {
  if (!match) return null;
  const from = text.lastIndexOf("\n", match.index - 1) + 1, stop = text.indexOf("\n", match.index + match[0].length);
  const flat = (part) => part.replace(/\s+/g, " ");
  let before = flat(text.slice(from, match.index)).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trimStart();
  let after = flat(text.slice(match.index + match[0].length, stop < 0 ? text.length : stop)).trimEnd();
  if (before.length > 40) before = "…" + before.slice(-39).replace(/^\S*\s/, "");
  if (after.length > 50) after = after.slice(0, 49).replace(/\s\S*$/, "") + "…";
  return {before, word: match[0], after};
}

/** The `skill-version` stamp on the flow's first line, or null. */
export const flowStamp = (doc) => headerProp(doc, "skill-version");

function* descendants(nodes) {
  for (const node of nodes) {
    yield node;
    yield* descendants(node.children ?? []);
    if (node.onfail) { yield node.onfail; yield* descendants(node.onfail.children); }
    for (const branch of node.whens ?? []) yield* descendants(branch.children);
  }
}

/** `anchors` is {ref: ["file:line", …]} from the validator, or null when the skill folder is unknown. */
export function buildModel(doc, text, title, source, errors, example = null, anchors = null) {
  const builder = new Builder(doc, text);
  const context = builder.context();
  const flow = builder.block(doc.nodes);
  builder.linkInvariants(context.invariants);
  builder.linkMentions(flow);
  const orphans = builder.orphans.map((note) => ({text: note, node: null}));
  return {
    format: 1,
    title,
    skillVersion: flowStamp(doc),
    // the SkillFlow version that last checked the flow; set only where the flow writes one, so other models stay as they were
    ...(headerProp(doc, "skillflow-version") ? {flowSkillflowVersion: headerProp(doc, "skillflow-version")} : {}),
    source,
    errors,
    stats: {...builder.counts, by: builder.by, unclear: builder.unclear.length + orphans.length},
    context,
    flow,
    data: builder.data,
    tools: Object.fromEntries(Object.keys(builder.tools).sort().map((name) => [name, builder.tools[name]])),
    ...(Object.keys(builder.toolKinds).length ? {toolKinds: Object.fromEntries(Object.keys(builder.toolKinds).sort().map((name) => [name, builder.toolKinds[name]]))} : {}),
    unclear: [...builder.unclear, ...orphans],
    sourceText: text,
    example: example ? exampleModel(example) : null,
    ...(anchors && Object.keys(anchors).length ? {anchors} : {}),
  };
}

/** The flows of the Help view: the tutorial flow, and in `pairs` the small flows of the best practices. */
function exampleModel({text, doc, pairs = []}) {
  const drawn = (flow, prefix) => {
    const builder = new Builder(flow.doc, flow.text, prefix);
    builder.context();
    return {flow: builder.block(flow.doc.nodes), sourceText: flow.text};
  };
  return {...drawn({text, doc}, "x"), pairs: pairs.map((pair, index) => drawn(pair, `y${index}-`))};
}

/**
 * What `pageModel` takes as `example`: {text, doc} of the flow in references/example.md, and in `pairs` the same for each
 * `<pre class="kdl" data-flow>` of help.html, in page order. Null when a file is absent or holds no flow.
 */
export function helpFlows() {
  let markdown, help;
  try {
    markdown = readFileSync(join(ASSETS, "..", "references", "example.md"), "utf8");
    help = readFileSync(join(ASSETS, "help.html"), "utf8");
  } catch { return null; }
  const flow = (text) => ({text, doc: parseFlow(text)});
  const example = /```kdl\n([\s\S]*?)```/.exec(markdown);
  // the page reads the text of a <pre>, so the entities of help.html are the characters here
  const plain = (html) => html.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return example ? {...flow(example[1]), pairs: [...help.matchAll(/<pre class="kdl" data-flow>([\s\S]*?)<\/pre>/g)].map((found) => flow(plain(found[1])))} : null;
}

/** JSON safe inside <script>: no `<`, `>`, `&` survive, so `</script>` and `<!--` cannot appear. */
export const scriptJson = (model) => JSON.stringify(model)
  .replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;"})[char]);

// the viewer's parts in assets/viewer/, in page order: they share one function scope, so this order is their run order
export const VIEWER_PARTS = ["model.js", "comment-store.js", "helpers.js", "shell.js", "layout.js", "canvas.js", "canvas-input.js", "navigation.js",
  "scenario.js", "scenario-ui.js", "panels.js", "review-ui.js", "toast.js", "save.js", "keys.js", "code-view.js", "source.js", "help-check-start.js"];

/** The viewer script: its parts joined inside one function, whose first statement is the strict directive. */
// The parts are the body of sfStart, which draws one model into the page; skillflow.boot draws another in its place.
// An edit page (model.edit) starts no viewer by itself: its editor starts one, with itself as the host.
export const viewerScript = () => "/* SkillFlow interactive viewer v2. Reads the JSON model in #flow-model; flow text only ever goes in via textContent. */\n(function () {\n  'use strict';\n" +
  "  function sfStart(M, host, carry) {\n" + VIEWER_PARTS.map((name) => readFileSync(join(ASSETS, "viewer", name), "utf8")).join("") + "  }\n" +
  "  var sfFirst = JSON.parse(document.getElementById('flow-model').textContent);\n" +
  "  window.skillflow = Object.freeze({ boot: function (model, host) { sfStart(model, host || null, null); } });\n" +
  "  if (!sfFirst.edit) sfStart(sfFirst, null, null);\n})();\n";

// the viewer's DOM-free files in assets/viewer-lib/: each declares one name, `sf…`, which the viewer reads; Node tests run each alone
export const VIEWER_LIBS = ["text.js", "comments.js", "kdl.js", "geometry.js"];

/** help.html with the notices of the third-party code: the version from the pin of the vendored parser, and the text of its license file. */
function helpHtml() {
  const vendor = join(import.meta.dirname, "_vendor", "bgotink-kdl"), read = (name) => readFileSync(join(vendor, name), "utf8");
  return readFileSync(join(ASSETS, "help.html"), "utf8")
    .replace("<!--kdl-version-->", () => escapeHtml(JSON.parse(read("PIN.json")).version))
    .replace("<!--kdl-license-->", () => escapeHtml(read("LICENSE.md").trim()));
}

/** The page of `model`. `head` and `tail` are HTML that an edit page adds: at the end of the head, and after the page script. */
export function page(model, head = "", tail = "") {
  const css = readFileSync(join(ASSETS, "viewer.css"), "utf8"), help = helpHtml();
  const libs = VIEWER_LIBS.map((name) => readFileSync(join(ASSETS, "viewer-lib", name), "utf8")).join("\n");
  const viewer = viewerScript();
  // one wrapper keeps the `sf…` names of the libs local to the page script: the viewer's own API is the page's only global
  const js = `(function () {\n${libs}\n${viewer}\n})();`;
  if (css.toLowerCase().includes("</style") || js.toLowerCase().includes("</script") || js.includes("<!--")) throw new Error("viewer asset would break its tag");
  if (help.toLowerCase().includes("</template") || help.toLowerCase().includes("<script")) throw new Error("help fragment would break its tag");
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta name="color-scheme" content="light dark"><title>${escapeHtml(model.title)} · SkillFlow</title>` +
    `<style>${css}</style>${head}</head><body>` +
    '<noscript><p style="padding:16px">This page draws the flow with JavaScript; enable it to see the graph.</p></noscript>' +
    '<div id="app"></div>' +
    `<template id="sf-help">${help}</template>` +
    `<script type="application/json" id="flow-model">${scriptJson(model)}</script>` +
    // review comments saved on the page go here; `null` until the reader saves the page
    '<script type="application/json" id="sf-comments">null</script>' +
    `<script>${js}</script>${tail}</body></html>\n`;
}

/** `example` is what `helpFlows` returns, or null to leave the flows of Help out. */
/** `gaps` is [{line, message}] of a draft (render --draft), or null for a finished flow. */
export const pageModel = (doc, text, title, source, example = null, anchors = null, gaps = null) =>
  ({...buildModel(doc, text, title, source, gaps ?? [], example, anchors), skillflowVersion: SKILLFLOW_VERSION, ...(gaps ? {draft: true} : {})});
export const renderPage = (...args) => page(pageModel(...args));
