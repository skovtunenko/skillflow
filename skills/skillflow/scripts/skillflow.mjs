#!/usr/bin/env node
// SkillFlow helper. Needs Node.js 22 or later; uses only its built-in modules.
import {readFileSync, realpathSync, writeFileSync} from "node:fs";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {parseArgs} from "node:util";
import {InvalidKdlError} from "./_vendor/bgotink-kdl/index.js";
import {FormatError, formatFlow} from "./fmt.mjs";
import {findFlows, flowName, resolveTarget, runMenu, skillOf, suggestCommand} from "./ctl.mjs";
import {runEdit} from "./edit.mjs";
import {real, replaceFile} from "./flow-file.mjs";
import {runMap, runRules} from "./folder.mjs";
import {flowStamp, helpFlows, renderPage} from "./render.mjs";
import {check, draftGaps, InputError, isFile, KDL_LINES, load, plural, reason, Report, SKILL_HINT, status, summary, syntaxErrors} from "./validate.mjs";

const HERE = import.meta.dirname;

function resolveSkill(args) {
  if (args.skill === undefined) return skillOf(args.flow);
  if (!isFile(join(args.skill, "SKILL.md"))) throw new InputError(`${args.skill}: no SKILL.md here; --skill takes the target skill folder, the one that holds its SKILL.md`);
  return args.skill;
}

/** The report lines, then one `next:` line that says what to do about the todo items or the draft gaps. */
function printReport(report, command) {
  for (const line of report.lines()) console.log("  " + line);
  if (report.todos.length) console.log(`  next: ${plural(report.todos.length, "todo item")} left; fill them, then run \`validate\` without --draft before sync`);
  else if (report.noSkill && report.gaps === report.errors.length) console.log(`  next: the target skill folder is unknown: ${SKILL_HINT}`);
  else if (report.gaps && report.gaps === report.errors.length)
    // the fix comes first: a flow that should pass needs the gaps filled, and --draft only defers them
    console.log(`  next: ${report.gaps === 1 ? "this error is a draft gap: fix it by its hint" : `all ${report.gaps} errors are draft gaps: fix them by their hints`}, or run \`${command} --draft\` while you sketch`);
}

function runValidate(args) {
  const {report, stats} = check(args.flow, resolveSkill(args), args.draft);
  console.log(status(report, args.flow));
  if (stats) console.log(summary(stats));
  printReport(report, "validate");
  return report.errors.length ? 1 : 0;
}

/** Review comments saved in the page at `path`: 0 for none or no file, an InputError for a page it cannot read, Infinity for a comment block that does not parse. */
export function savedComments(path) {
  let html;
  try { html = readFileSync(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return 0;
    // an unreadable page may hold comments: refuse to overwrite it
    throw new InputError(`${path}: cannot read the page to look for saved comments: ${reason(error)}`);
  }
  const block = /<script\b[^>]*\bid="sf-comments"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!block) return 0;
  try {
    const saved = JSON.parse(block[1]);
    if (saved === null) return 0;
    return Array.isArray(saved?.comments) ? saved.comments.length : Infinity;
  } catch { return Infinity; }
}

function runRender(args) {
  const skillDir = resolveSkill(args);
  const title = skillDir ? basename(skillDir) : basename(dirname(real(args.flow)));
  // without -o: <skill>-<skill-version>.html next to the flow file
  const named = args.output === undefined;
  let stamp = null;
  if (named) try { stamp = flowStamp(load(args.flow).doc); } catch { /* a flow that does not parse fails in check below */ }
  const name = `${title}${stamp ? "-" + stamp.replace(/[\\/]/g, "-") : ""}.html`;
  let page = args.output ?? join(dirname(args.flow), name);
  // a flow inside its skill: the default page goes next to the skill folder, so it never ships with the skill
  if (named && skillDir && real(page).startsWith(real(skillDir) + sep)) page = relative(".", join(dirname(resolve(skillDir)), name)) || name;
  const output = real(page);
  if (output === real(args.flow) || (skillDir && output.startsWith(real(skillDir) + sep))) {
    // a ready path: the current folder, or the folder above the skill when the current folder is inside it
    const here = resolve(basename(page)), outside = skillDir && real(here).startsWith(real(skillDir) + sep) ? join(dirname(resolve(skillDir)), basename(page)) : here;
    throw new InputError(`${page}: the page must be outside the flow file and the skill folder; pass -o, e.g. -o ${relative(".", outside) || basename(page)}`);
  }
  // a reviewer saved comments in this page: a new render would erase them
  const saved = savedComments(page);
  if (saved) throw new InputError(`${page}: the page holds ${saved === Infinity ? "review comments that cannot be read" : saved === 1 ? "1 saved review comment" : `${saved} saved review comments`}; render to another path, or move that page away first`);
  const {report, stats, anchors} = check(args.flow, skillDir, args.draft);
  if (report.errors.length) {
    console.log(`${status(report, args.flow)} (fix the errors before rendering)`);
    printReport(report, "render");
    return 1;
  }
  const {text, doc} = load(args.flow);
  const html = renderPage(doc, text, title, basename(args.flow), helpFlows(), anchors, draftGaps(report));
  try { writeFileSync(page, html); } catch (error) { throw new InputError(`${page}: cannot write: ${reason(error)}`); }
  console.log(`${status(report, args.flow)} -> ${page}`);
  console.log(summary(stats));
  printReport(report, "render");
  return 0;
}

/** Format the flow file in place, or with --check only say whether it is formatted. A file fmt cannot format stays as it is. */
function runFmt(args) {
  const report = new Report(args.flow);
  let text, formatted;
  try {
    ({text} = load(args.flow));
    formatted = formatFlow(text);
  } catch (error) {
    if (error instanceof InvalidKdlError) syntaxErrors(report, error);
    else if (error instanceof FormatError) report.error(error.line, error.message, error.hint);
    else throw error;
    console.log(status(report, args.flow));
    printReport(report, "fmt");
    return 1;
  }
  if (formatted === text) { console.log(`unchanged ${args.flow}`); return 0; }
  if (args.check) {
    // lines as an editor numbers them; a line that differs only in its ending differs
    const was = text.split("\n"), now = formatted.split("\n"), at = now.findIndex((line, index) => line !== was[index]);
    console.log(`not formatted ${args.flow} · first difference at line ${at < 0 ? now.length : Math.min(at + 1, was.length)}\n  next: run \`fmt\` on the file`);
    return 1;
  }
  try { replaceFile(args.flow, formatted); } catch (error) { throw new InputError(`${args.flow}: cannot write: ${reason(error)}`); }
  console.log(`formatted ${args.flow}`);
  return 0;
}

/** fmt, validate, and render a flow found by path or skill name. */
function runPage(args) {
  const {flow, skill} = resolveTarget(args.target);
  return runFmt({flow}) || runRender({flow, skill: skill ?? undefined, draft: args.draft});
}

/** fmt --check and validate a flow found by path or skill name; writes nothing. */
function runLint(args) {
  const {flow, skill} = resolveTarget(args.target);
  const formatted = runFmt({flow, check: true});
  return Math.max(formatted, runValidate({flow, skill: skill ?? undefined, draft: args.draft}));
}

// each command: its positional arguments, the flags it takes, what runs it, and one line for the usage
const COMMANDS = {
  page: {args: ["target"], flags: ["draft"], run: runPage, about: "for a person: format, validate, and write the page of a flow"},
  lint: {args: ["target"], flags: ["draft"], run: runLint, about: "for a person: check the format and validate a flow; write nothing"},
  edit: {args: ["target"], flags: ["offline"], run: runEdit, about: "for a person: edit a flow in the browser with a live graph; Save writes the flow file"},
  validate: {args: ["flow"], flags: ["skill", "draft"], run: runValidate, about: "check a flow file; exit 1 on errors"},
  render: {args: ["flow"], flags: ["output", "skill", "draft"], run: runRender, about: "validate, then write an offline interactive HTML page of the flow"},
  fmt: {args: ["flow"], flags: ["check"], run: runFmt, about: "format a flow file in place: one tab for each level, and the same blank lines in every flow"},
  map: {args: ["skillDir"], flags: [], run: runMap, about: "list a skill folder for reading"},
  rules: {args: ["skillDir"], flags: [], run: runRules, about: "list rule lines, script failure messages, and script file writes"},
};
// how the usage writes each argument and flag
const ARG = {flow: "FLOW", skillDir: "SKILL_DIR", target: "SKILL"};
const FLAG = {
  output: ["-o PAGE", "the page to write, outside the skill folder; default:\nSKILL-VERSION.html next to FLOW, or next to the skill folder\nwhen FLOW is inside it"],
  skill: ["--skill DIR", "the target skill folder; default: skill=\"PATH\" on the first line\nof FLOW, else the folder of FLOW or the one above it, whichever\nholds SKILL.md, else the one matching skill folder in the repo"],
  check: ["--check", "write nothing; exit 1 when the file is not formatted, with the\nfirst line that differs"],
  offline: ["--offline PAGE", "start no server: write the editor as one offline page, outside\nthe skill folder; it saves through the browser"],
  draft: ["--draft", "accept a sketch: missing executors, questions, prose, and\ndata paths become todo lines, not errors; a run without --draft\nmust pass before check or sync"],
};
// the launcher skillflowctl sets SKILLFLOW_PROG, so the text names the command that the person typed
const PROGRAM = process.env.SKILLFLOW_PROG || "node skillflow.mjs";
const synopsis = (name) => [name, ...COMMANDS[name].args.map((arg) => ARG[arg]), ...COMMANDS[name].flags.map((flag) => `[${FLAG[flag][0]}]`)].join(" ");
// a command's flags as the usage writes them, so an error can list them
const flagList = (name) => COMMANDS[name].flags.map((key) => (key === "output" ? "-o/--output" : `--${key}`)).join(", ") || "none";

/** Two aligned columns; a right cell may hold several lines. */
function columns(rows) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.flatMap(([left, right]) => right.split("\n").map((part, index) => `  ${(index ? "" : left).padEnd(width)}  ${part}`));
}

/** The help text: every command, or one command with its flags. */
export function usage(name = null) {
  const flags = name ? COMMANDS[name].flags : Object.keys(FLAG);
  const commands = name ? [COMMANDS[name].about] : ["commands:", ...columns(Object.keys(COMMANDS).map((key) => [`${key} ${COMMANDS[key].args.map((arg) => ARG[arg]).join(" ")}`, COMMANDS[key].about]))];
  const options = flags.map((flag) => [FLAG[flag][0], FLAG[flag][1] + (name ? "" : ` (${Object.keys(COMMANDS).filter((key) => COMMANDS[key].flags.includes(flag)).join(", ")})`)]);
  if (!name) options.push(["-h, --help", `this text; \`${PROGRAM} <command> --help\` shows one command`]);
  return [`usage: ${PROGRAM} ${name ? synopsis(name) : "<command> [options]"}`, "", ...commands,
    ...(options.length ? ["", "options:", ...columns(options)] : []),
    ...(!name || COMMANDS[name].args[0] === "target" ? ["", "SKILL: a flow file, a folder with one flow file, or a skill name; a flow file is", "a .kdl file whose first line starts with skillflow"] : []),
    "", !name || COMMANDS[name].args[0] !== "skillDir" ? "exit: 0 ok · 1 the flow has errors, or fmt --check found a file that is not formatted · 2 the command line is wrong or an input cannot be read"
      : "exit: 0 ok · 2 the command line is wrong or the folder cannot be read"].join("\n");
}

// a command-line error; `command` is the command it belongs to, when known
const wrong = (message, command = null) => Object.assign(new Error(message), {command});
const known = (name) => (Object.hasOwn(COMMANDS, name ?? "") ? name : null);
const COMMAND_LIST = Object.keys(COMMANDS).join(", ");
// an unknown command, with the nearest one when it is close
const unknown = (name) => {
  const near = suggestCommand(name, [...Object.keys(COMMANDS), "help"]);
  return wrong(`unknown command ${name}; ${near ? `did you mean ${near}? ` : ""}commands: ${COMMAND_LIST}`);
};

/** Help examples with the names of the flows in this repository. */
function examples() {
  let names = [];
  try { names = [...new Set(findFlows().flows.map(flowName))]; } catch { /* no flows: placeholders */ }
  const one = names.toSorted((x, y) => x.length - y.length)[0] ?? "SKILL";
  return ["examples:", ...columns([
    [`${PROGRAM} page ${one}`, "format and validate the flow, then write its page"],
    [`${PROGRAM} lint ${one}`, "check only; exit 1 on a problem"],
    [`${PROGRAM} edit ${one}`, "edit in the browser: the graph follows the text"],
    [PROGRAM, "in a terminal: pick a flow and an action from a menu; q quits"],
  ]), ...(names.length ? ["", `flows here: ${names.join(", ")}`] : [])].join("\n");
}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({args: argv, allowPositionals: true,
      options: {skill: {type: "string"}, output: {type: "string", short: "o"}, offline: {type: "string"}, draft: {type: "boolean"}, check: {type: "boolean"}, help: {type: "boolean", short: "h"}}});
  } catch (error) {
    // Node's own text tells how to pass a positional that starts with '-'; name the flag and the valid ones instead
    const command = known(argv.find((arg) => !arg.startsWith("-")));
    if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const flag = /'([^']+)'/.exec(error.message)?.[1];
      throw wrong(`unknown flag ${flag}` + (command ? ` for ${command}; valid flags: ${flagList(command)}` : ""), command);
    }
    const key = /--([\w-]+)/.exec(error.message)?.[1];
    if (error.code !== "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" || !Object.hasOwn(FLAG, key)) throw error;
    // Node says "ambiguous" when the next word is another flag: the value is missing either way
    throw wrong(/argument missing|ambiguous/.test(error.message) ? `${FLAG[key][0].split(" ")[0]} needs a value: ${FLAG[key][0]}` : `--${key} takes no value`, command);
  }
  const {values, positionals} = parsed;
  const [command, ...rest] = positionals;
  // `help` and --help: all commands, or the one named
  if (values.help || command === "help") {
    const topic = command === "help" ? rest[0] : command;
    if (topic !== undefined && !known(topic)) throw unknown(topic);
    return {help: topic ?? null};
  }
  if (!command) throw wrong(`a command is needed: ${COMMAND_LIST}`);
  if (!known(command)) throw unknown(command);
  const {args, flags, run} = COMMANDS[command], expected = args.map((arg) => ARG[arg]).join(" ");
  if (rest.length < args.length) throw wrong(`${command} needs ${expected}`, command);
  if (rest.length > args.length) throw wrong(`${command} takes one ${expected}; extra: ${rest.slice(args.length).join(" ")}`, command);
  for (const key of Object.keys(values)) if (!flags.includes(key)) throw wrong(`${command} has no --${key}; valid flags: ${flagList(command)}`, command);
  return {run, args: {...values, ...Object.fromEntries(args.map((name, index) => [name, rest[index]]))}};
}

/** The exit code; a Promise of it for the terminal menu (no arguments, stdin and stdout a terminal) and for `edit`, which runs until it is stopped. */
export function main(argv) {
  if (!argv.length && process.stdin.isTTY && process.stdout.isTTY) return runMenu(main);
  let command;
  try {
    command = parse(argv);
  } catch (error) {
    // the error first, then only the usage that helps fix it
    console.error(`error: ${error.message}`);
    console.error(error.command ? `usage: ${PROGRAM} ${synopsis(error.command)}\nmore: ${PROGRAM} ${error.command} --help` : argv.length ? `more: ${PROGRAM} --help` : `\n${usage()}`);
    return 2;
  }
  if (command.help !== undefined) { console.log(usage(command.help) + (command.help === null ? "\n\n" + examples() : "")); return 0; }
  try {
    return command.run(command.args);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    console.error(`error: ${error.message}`);
    return 2;
  }
}

// run as a script, also through a symlinked path on Node versions without import.meta.main
const isMain = () => { try { return realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (import.meta.main ?? isMain()) Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
