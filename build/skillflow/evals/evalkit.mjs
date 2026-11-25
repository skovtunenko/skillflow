#!/usr/bin/env node
// Eval kit for the SkillFlow skill: builds the workspace of a case and checks its [script] boxes.
//   node evalkit.mjs setup <case> <run-dir>   writes <run-dir>/ws (the agent works there) and <run-dir>/before.json
//   node evalkit.mjs grade <case> <run-dir>   prints one line per [script] box; exit 1 when a box fails
// cases.md defines the cases; the boxes a script cannot check are graded from the agent's reply.
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {SKILL} from "../tests/skill-path.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const CLI = path.join(SKILL, "scripts/skillflow.mjs");
const TARGET = "skills/expense-report", FLOW = `${TARGET}/expense-report.kdl`;

/** One seeded difference: [file below the workspace, text to find exactly once, its replacement]. */
const DRIFT = {
  missing: [`${TARGET}/SKILL.md`, "\nThen tell the user the path of the report and the grand total in one line.\n", ""],
  extra: [`${TARGET}/SKILL.md`, "It writes `report.md` in the receipts folder.\n",
    "It writes `report.md` in the receipts folder.\n\nThen email `report.md` to the address in `FINANCE_EMAIL` with the `mail` CLI.\n"],
  order: [`${TARGET}/SKILL.md`,
    "Give each receipt one category: travel, meals, office, or other. The match\nwords are in [categories.md](references/categories.md). Report a receipt\nthat has no amount.\n\nWhen any receipt is in a foreign currency, ask the user for the exchange rate\nof each foreign currency.\n",
    "When any receipt is in a foreign currency, first ask the user for the\nexchange rate of each foreign currency.\n\nThen give each receipt one category: travel, meals, office, or other. The\nmatch words are in [categories.md](references/categories.md). Report a\nreceipt that has no amount.\n"],
  executor: [`${TARGET}/SKILL.md`,
    "Run `scripts/write-report.sh <folder>` with the approved table on standard\ninput. It writes `report.md` in the receipts folder.\n",
    "Write `report.md` in the receipts folder yourself from the approved table.\n"],
  guard: [`${TARGET}/scripts/scan.sh`, "  exit 1\n", "  exit 0\n"],
  label: [`${TARGET}/SKILL.md`, "## S3 — Review\n", "## Step C — Review\n"],
  "broken-flow": [FLOW, "step summarize by=llm ", "step summarize "],
};

/** Per case: whether the workspace has the skill and its flow file, and the seeded differences. */
const CASES = {
  "check-clean": {flow: true},
  "check-drift": {flow: true, drift: ["missing", "extra", "order", "executor", "guard", "label"]},
  "check-no-flow": {},
  "check-broken-flow": {flow: true, drift: ["broken-flow"]},
  reverse: {},
  "sync-answered": {flow: true, drift: ["missing", "extra"]},
  "sync-batch": {flow: true, drift: ["missing", "extra"]},
  "explain-page": {flow: true},
  help: {flow: true},
  author: {skill: false},
  "trigger-flow": {flow: true},
  "trigger-no-flow": {},
};

/** Every file below `dir` with its SHA-256, as {path: hash}. */
function manifest(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, {recursive: true, withFileTypes: true})) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file)] = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return files;
}

function setup(name, runDir) {
  const spec = CASES[name], ws = path.join(runDir, "ws");
  if (fs.existsSync(ws)) throw new Error(`${ws} exists: give each run its own folder`);
  fs.mkdirSync(path.join(ws, "skills"), {recursive: true});
  fs.copyFileSync(path.join(FIXTURES, "AGENTS.md.fixture"), path.join(ws, "AGENTS.md"));
  if (spec.skill !== false) {
    fs.cpSync(path.join(FIXTURES, "expense-report"), path.join(ws, TARGET), {recursive: true});
    fs.renameSync(path.join(ws, TARGET, "SKILL.md.fixture"), path.join(ws, TARGET, "SKILL.md"));
  }
  if (spec.flow) fs.copyFileSync(path.join(FIXTURES, "expense-report.kdl.fixture"), path.join(ws, FLOW));
  for (const key of spec.drift ?? []) {
    const [file, from, to] = DRIFT[key], text = fs.readFileSync(path.join(ws, file), "utf8");
    if (text.split(from).length !== 2) throw new Error(`drift ${key}: its text must be in ${file} exactly once`);
    fs.writeFileSync(path.join(ws, file), text.replace(from, () => to));
  }
  fs.writeFileSync(path.join(runDir, "before.json"), JSON.stringify(manifest(ws), null, 2));
  return ws;
}

function grade(name, runDir) {
  const ws = path.join(runDir, "ws"), before = JSON.parse(fs.readFileSync(path.join(runDir, "before.json"), "utf8")), after = manifest(ws);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((file) => before[file] !== after[file]).sort();
  const inSkill = (file) => file.startsWith(`${TARGET}/`);
  const validate = (flow, ...flags) => spawnSync("node", [CLI, "validate", path.join(ws, flow), ...flags], {encoding: "utf8"});
  const boxes = [];
  const box = (text, pass, detail = "") => { boxes.push([pass, text + (detail && !pass ? `: ${detail}` : "")]); };
  const unchanged = (text, files) => box(text, files.length === 0, files.join(", "));
  const cleanFlow = (flow) => {
    if (!after[flow]) { box(`${flow} exists`, false); return ""; }
    const run = validate(flow), status = run.stdout.split("\n")[0];
    box("validate exits 0 with no warning", run.status === 0 && !status.includes("warning"), status || run.stderr.trim());
    return fs.readFileSync(path.join(ws, flow), "utf8");
  };

  if (name.startsWith("check-") || ["sync-batch", "help"].includes(name)) unchanged("no file changed", changed);
  if (name === "explain-page") {
    unchanged("the skill folder is unchanged", changed.filter(inSkill));
    box("an HTML page exists outside the skill folder", changed.some((file) => file.endsWith(".html") && !inSkill(file) && after[file]));
  }
  if (name === "reverse") {
    const flow = cleanFlow(FLOW);
    if (flow) box('the first line has skill-version="1.4"', flow.split("\n")[0].includes('skill-version="1.4"'), flow.split("\n")[0]);
    unchanged("only the flow file is new", changed.filter((file) => file !== FLOW));
  }
  if (name === "sync-answered") {
    const flow = cleanFlow(FLOW);
    box("the flow file gained the email step", /mail/.test(flow));
    box("SKILL.md changed", changed.includes(`${TARGET}/SKILL.md`));
    unchanged("nothing changed outside SKILL.md and the flow file", changed.filter((file) => ![FLOW, `${TARGET}/SKILL.md`].includes(file)));
  }
  if (name === "author") {
    const flows = Object.keys(after).filter((file) => file.endsWith(".kdl"));
    box("one flow file exists", flows.length === 1, flows.join(", "));
    if (flows.length === 1) {
      const run = validate(flows[0], "--draft");
      box("validate --draft exits 0", run.status === 0, run.stdout.split("\n")[0] || run.stderr.trim());
      box("no step has file=", !fs.readFileSync(path.join(ws, flows[0]), "utf8").includes("file="));
    }
  }
  if (name === "trigger-no-flow") unchanged("no flow file was made", Object.keys(after).filter((file) => file.endsWith(".kdl")));
  if (name === "trigger-flow") unchanged("the flow file is unchanged before the user answers", changed.filter((file) => file === FLOW));

  for (const [pass, text] of boxes) console.log(`${pass ? "pass" : "FAIL"}  ${text}`);
  return boxes.every(([pass]) => pass);
}

if (import.meta.filename === process.argv[1]) {
  const [command, name, runDir] = process.argv.slice(2);
  if (!["setup", "grade"].includes(command) || !CASES[name] || !runDir) {
    console.error(`usage: node evalkit.mjs setup|grade <case> <run-dir>\ncases: ${Object.keys(CASES).join(", ")}`);
    process.exit(2);
  }
  if (command === "setup") console.log(setup(name, path.resolve(runDir)));
  else process.exit(grade(name, path.resolve(runDir)) ? 0 : 1);
}

export {CASES, FLOW, TARGET, grade, setup};
