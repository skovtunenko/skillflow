// The human layer of the CLI: find a flow by path or by skill name, suggest a command for a typo, and the terminal menu.
import {spawnSync} from "node:child_process";
import {mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {basename, dirname, extname, join, relative, resolve} from "node:path";
import {createInterface} from "node:readline/promises";
import {styleText} from "node:util";
import {check, findSkillDir, headerProp, InputError, load, statOrNull} from "./validate.mjs";

// the first line of a flow file, with an optional byte order mark
const HEADER = /^﻿?skillflow(?:[ \t]|$)/;
const firstLine = (path) => { try { return readFileSync(path, "utf8").split("\n", 1)[0]; } catch { return ""; } };

/** A `.kdl` file whose first line starts with `skillflow`; its file name is free. */
export const isFlowFile = (path) => extname(path) === ".kdl" && HEADER.test(firstLine(path));

/** `skill="..."` on the first line of the flow, or null. */
const skillProp = (path) => /\bskill="([^"]*)"/.exec(firstLine(path))?.[1] ?? null;

/** The names a person may type for a flow: its folder, its file name, that name without a version, the folder that `skill=` names. */
export function flowNames(path) {
  const stem = basename(path, ".kdl"), named = skillProp(path);
  return [...new Set([basename(dirname(resolve(path))), stem, stem.replace(/[-_@.]v?\d+(?:\.\d+)*$/, ""), named && basename(named)].filter(Boolean))];
}

/** The one name the help and the menu show for a flow. */
export function flowName(path) {
  const named = skillProp(path), stem = basename(path, ".kdl");
  return named ? basename(named) : stem === "flow" ? basename(dirname(resolve(path))) : stem.replace(/[-_@.]v?\d+(?:\.\d+)*$/, "");
}

/** The git root above `cwd`, or null outside git. */
function gitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {cwd, encoding: "utf8"});
  return result.status === 0 ? result.stdout.trim() : null;
}

// every file below `dir`, without dot folders and node_modules; a folder that cannot be read is skipped
// shortcut: 6 folder levels, so a run from the home folder ends fast; a deeper flow outside git needs its path
function walk(dir, out = [], depth = 6) {
  if (depth < 0) return out;
  let entries = [];
  try { entries = readdirSync(dir, {withFileTypes: true}); } catch {}
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) walk(join(dir, entry.name), out, depth - 1);
    else out.push(join(dir, entry.name));
  }
  return out;
}

/** {flows, skills}: absolute paths of the flow files and the skill folders (each holds SKILL.md) that git sees from its root, else below `cwd`. */
export function findFlows(cwd = process.cwd()) {
  const root = gitRoot(cwd);
  // git decides: tracked and untracked files, not ignored ones, so installed copies and scratch files stay out
  // maxBuffer: 64 MB, because the flow and SKILL.md paths of a large repository can pass Node's default of 1 MB
  const listed = root && spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.kdl", "*SKILL.md"], {cwd: root, encoding: "utf8", maxBuffer: 64 << 20});
  const files = listed?.status === 0 ? listed.stdout.split("\0").filter(Boolean).map((file) => join(root, file)) : walk(resolve(cwd));
  return {
    flows: files.filter(isFlowFile).sort(),
    skills: [...new Set(files.filter((file) => basename(file) === "SKILL.md").map(dirname))].sort(),
  };
}

const shown = (path, cwd) => relative(cwd, path) || ".";
// git prints real paths: a folder reached through a symlink (macOS /tmp) gives its real path too, so the relative paths stay short
const real = (dir) => { try { return realpathSync(dir); } catch { return resolve(dir); } };

/** The skill folder of a flow: `skill=` or the flow folder or the one above, else the one skill folder with one of the flow's names. */
export function skillOf(flow, skills = () => findFlows(dirname(flow)).skills) {
  const found = findSkillDir(flow);
  let hasSkillProp = false;
  try { hasSkillProp = headerProp(load(flow).doc, "skill") !== null; } catch { hasSkillProp = skillProp(flow) !== null; }
  if (found || hasSkillProp) return found;
  const names = flowNames(flow), matches = (typeof skills === "function" ? skills() : skills).filter((dir) => names.includes(basename(dir)));
  return matches.length === 1 ? matches[0] : null;
}

/** {flow, skill} for a flow file, a folder with one flow file, or a skill name; paths are relative to `cwd`, skill is null when unknown. An InputError otherwise. */
export function resolveTarget(arg, cwd = process.cwd()) {
  cwd = real(cwd);
  const path = resolve(cwd, arg), stat = statOrNull(path);
  let flow;
  if (stat?.isFile()) flow = path;
  else if (stat?.isDirectory()) {
    const inside = readdirSync(path).map((name) => join(path, name)).filter(isFlowFile);
    if (inside.length !== 1) throw new InputError(inside.length ? `${arg}: ${inside.length} flow files here; pass one:\n${inside.map((file) => "  " + shown(file, cwd)).join("\n")}` : `${arg}: no flow file here (a .kdl file whose first line starts with skillflow)`);
    flow = inside[0];
  } else if (/[\\/]|\.kdl$/.test(arg)) throw new InputError(`${arg}: no such file or folder`);
  let skills;
  if (!flow) {
    const found = findFlows(cwd), flows = found.flows;
    skills = found.skills;
    const matches = flows.filter((file) => flowNames(file).includes(arg));
    if (matches.length > 1) throw new InputError(`${arg} names ${matches.length} flows; pass one path:\n${matches.map((file) => "  " + shown(file, cwd)).join("\n")}`);
    if (!matches.length) throw new InputError(`no flow named ${arg}` + (flows.length ? `; flows here: ${[...new Set(flows.map(flowName))].join(", ")}` : "; pass the flow file"));
    flow = matches[0];
  }
  const skill = skillOf(flow, skills);
  return {flow: shown(flow, cwd), skill: skill && shown(skill, cwd)};
}

/** The edit distance with swapped neighbours as one edit. */
function distance(a, b) {
  const d = Array.from({length: a.length + 1}, (_, i) => Array.from({length: b.length + 1}, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** The nearest command to `word`, or null when none is close: 2 edits cover two typos or swaps (a swap is one edit), and more would name an unrelated command. */
export function suggestCommand(word, commands) {
  const [best] = commands.map((name) => [distance(word.toLowerCase(), name), name]).filter(([far]) => far <= 2 && far < word.length).sort(([x], [y]) => x - y);
  return best?.[1] ?? null;
}

/** The menu lines: number, name, status, path; `›` marks the last choice. */
export function menuRows(entries, last, paint = (style, text) => text) {
  const width = Math.max(...entries.map(({name}) => name.length));
  return entries.map(({name, flow, errors}, index) => {
    const [style, state] = errors === null ? ["yellow", "unreadable"] : errors ? ["red", `${errors} error${errors === 1 ? "" : "s"}`] : ["green", "ok"];
    return `${flow === last ? "›" : " "}${String(index + 1).padStart(3)}  ${name.padEnd(width)}  ${paint(style, state.padEnd(10))}  ${paint("dim", flow)}`;
  });
}

// the last menu choice per repository, in the user's cache folder; the menu works without it
const LAST = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "skillflowctl", "last.json");
const readLast = () => { try { return JSON.parse(readFileSync(LAST, "utf8")); } catch { return {}; } };
function saveLast(all) {
  try { mkdirSync(dirname(LAST), {recursive: true}); writeFileSync(LAST, JSON.stringify(all)); } catch { /* a read-only home: no memory, same menu */ }
}

/**
 * One answer of the menu, trimmed; a number is the exit code of a quit: 0 for q or Ctrl+D, 130 for Ctrl+C, as a shell expects.
 * Without this, Ctrl+C prints an AbortError stack and Ctrl+D leaves the question unsettled.
 */
export function ask(prompt, text) {
  return new Promise((done) => {
    const quit = (code) => () => { prompt.off("close", eof).off("SIGINT", interrupt); process.stdout.write("\n"); done(code); };
    const eof = quit(0), interrupt = quit(130);
    prompt.once("close", eof).once("SIGINT", interrupt);
    prompt.question(text).then(
      (answer) => { prompt.off("close", eof).off("SIGINT", interrupt); answer = answer.trim(); done(answer.toLowerCase() === "q" ? 0 : answer); },
      interrupt);
  });
}

/** The terminal menu: pick a flow and an action, then `run([action, flow])`. Returns the exit code. */
export async function runMenu(run, cwd = process.cwd()) {
  cwd = real(cwd);
  const color = !process.env.NO_COLOR;
  const paint = (style, text) => (color ? styleText(style, text, {validateStream: false}) : text);
  const {flows, skills} = findFlows(cwd);
  if (!flows.length) { console.error("no flow files here; a flow file is a .kdl file whose first line starts with skillflow"); return 2; }
  const entries = flows.map((file) => {
    const flow = shown(file, cwd);
    let errors = null;
    try { errors = check(file, skillOf(file, skills)).report.errors.length; } catch {}
    return {name: flowName(file), flow, errors};
  });
  const key = gitRoot(cwd) ?? resolve(cwd), all = readLast(), last = all[key] ?? {};
  console.log(menuRows(entries, last.flow, paint).join("\n"));
  console.log(`${paint("dim", "type a number or a name; Enter takes the one in [ ]")}  ${paint("bold", "quit: q, Ctrl+C, or Ctrl+D")}`);
  const prompt = createInterface({input: process.stdin, output: process.stdout});
  try {
    const fallback = Math.max(0, entries.findIndex(({flow}) => flow === last.flow)) + 1;
    const pick = await ask(prompt, `flow [${fallback}] · q quits: `);
    if (typeof pick === "number") return pick;
    const entry = entries[Number(pick || fallback) - 1] ?? entries.find(({name}) => name === pick);
    if (!entry) { console.error(`no flow ${pick}`); return 2; }
    const actions = ["page", "lint", "edit"], lastAction = actions.includes(last.action) ? last.action : "page";
    const answer = await ask(prompt, `action: p page · l lint · e edit · q quits [${lastAction[0]}]: `);
    if (typeof answer === "number") return answer;
    const action = actions.find((name) => name === (answer.toLowerCase() || lastAction) || name[0] === answer.toLowerCase());
    if (!action) { console.error(`no action ${answer}; p, l, e, or q`); return 2; }
    saveLast({...all, [key]: {flow: entry.flow, action}});
    return run([action, entry.flow]);
  } finally {
    prompt.close();
  }
}
