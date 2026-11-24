// The human layer: skillflowctl, the lookup of a flow by path or skill name, page and lint, the typo hint, and the menu rows.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {tmpDir} from "./tmp.mjs";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {flowNames, menuRows, resolveTarget, suggestCommand} = await import(skillUrl("scripts/ctl.mjs"));

const CTL = path.join(SKILL, "skillflowctl");
const FLOW = "skillflow 1.0\n\nstep a by=llm\n";

/** A folder with the given files: {relative path: text}. With git, a repository that ignores `ignored/`. */
function tree(files, git = false) {
  const dir = tmpDir("sf-ctl-");
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    fs.writeFileSync(path.join(dir, file), text);
  }
  if (git) {
    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
    assert.equal(spawnSync("git", ["init", "-q"], {cwd: dir}).status, 0);
  }
  return dir;
}
const ctl = (cwd, ...args) => spawnSync(CTL, args, {cwd, encoding: "utf8", env: {...process.env, NO_COLOR: ""}});

test("skillflowctl is executable and names itself in the usage", () => {
  assert.ok(fs.statSync(CTL).mode & 0o111);
  const result = ctl(SKILL, "--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^usage: skillflowctl <command>/);
  assert.match(result.stdout, /\nexamples:\n {2}skillflowctl page \S+/);
});

test("skillflowctl.cmd runs the same script with the same program name, with CRLF line ends", () => {
  const text = fs.readFileSync(path.join(SKILL, "skillflowctl.cmd"), "utf8");
  assert.match(text, /^@echo off\r\n/);
  assert.doesNotMatch(text.replaceAll("\r\n", ""), /\n/);
  assert.match(text, /\r\nset "SKILLFLOW_PROG=skillflowctl"\r\nnode "%~dp0scripts\\skillflow\.mjs" %\*\r\nexit \/b %ERRORLEVEL%\r\n$/);
});

test("a flow file is found by its folder name, its file name, or that name without a version", () => {
  assert.deepEqual(flowNames("/r/build/x/flow.kdl"), ["x", "flow"]);
  assert.deepEqual(flowNames("/r/build/y/x-2026.11.20.kdl"), ["y", "x-2026.11.20", "x"]);
  const dir = tree({"build/x/x-2026.11.20.kdl": FLOW, "skills/b/x/SKILL.md": "# x\n", "build/x/notes.kdl": "node 1\n"}, true);
  assert.deepEqual(resolveTarget("x", dir), {flow: "build/x/x-2026.11.20.kdl", skill: "skills/b/x"});
  // a folder with one flow file: the .kdl file that is not a flow does not count
  assert.deepEqual(resolveTarget("build/x", dir), {flow: "build/x/x-2026.11.20.kdl", skill: "skills/b/x"});
});

test("a name of two flows lists both and exits 2; ignored files do not count", () => {
  const dir = tree({"a/x/flow.kdl": FLOW, "b/x/flow.kdl": FLOW, "ignored/x/flow.kdl": FLOW}, true);
  const result = ctl(dir, "page", "x");
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "error: x names 2 flows; pass one path:\n  a/x/flow.kdl\n  b/x/flow.kdl\n");
  assert.match(ctl(dir, "lint", "nope").stderr, /^error: no flow named nope; flows here: x\n/);
});

test("outside git, the lookup searches the current folder without dot folders", () => {
  const dir = tree({"x/flow.kdl": FLOW, ".hidden/x/flow.kdl": FLOW});
  assert.deepEqual(resolveTarget("x", dir), {flow: "x/flow.kdl", skill: null});
});

test("lint names the first line that differs, exits 1, and changes no file", () => {
  const dir = tree({"x/SKILL.md": "# x\n", "x/flow.kdl": "skillflow 1.0\nstep a by=llm\n"}, true);
  const before = fs.readFileSync(path.join(dir, "x/flow.kdl"), "utf8");
  const result = ctl(dir, "lint", "x");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^not formatted x\/flow\.kdl · first difference at line 2\n/);
  assert.deepEqual(fs.readdirSync(path.join(dir, "x")).sort(), ["SKILL.md", "flow.kdl"]);
  assert.equal(fs.readFileSync(path.join(dir, "x/flow.kdl"), "utf8"), before);
});

test("page formats, validates, and writes the page outside the skill folder", () => {
  const dir = tree({"skills/x/SKILL.md": "# x\n", "build/x/flow.kdl": "skillflow 1.0\nstep a by=llm\n"}, true);
  const result = ctl(dir, "page", "x");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^formatted build\/x\/flow\.kdl\nOK build\/x\/flow\.kdl -> build\/x\/x\.html\n/);
  assert.ok(fs.existsSync(path.join(dir, "build/x/x.html")));
});

test("validate resolves a mirrored skill folder automatically without --skill or skill=", () => {
  const dir = tree({
    "skills/b/x/SKILL.md": "---\nname: x\nmetadata:\n  version: \"1.0\"\n---\n# x\n## Step 1\n",
    "build/b/x/flow.kdl": 'skillflow 1.0 skill-version="1.0"\n\nstep a ref="Step 1" by=llm\n',
  }, true);
  const result = spawnSync("node", [path.join(SKILL, "scripts", "skillflow.mjs"), "validate", "build/b/x/flow.kdl"], {cwd: dir, encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /warning/);
  assert.match(result.stdout, /refs 1\/1/);
  // an explicit wrong skill= still fails even after a leading comment or with a raw string
  for (const header of ['// note\nskillflow 1.0 skill="../nope"\n', 'skillflow 1.0 skill=#"../nope"#\n']) {
    fs.writeFileSync(path.join(dir, "build/b/x/flow.kdl"), `${header}\nstep a by=llm\n`);
    const bad = spawnSync("node", [path.join(SKILL, "scripts", "skillflow.mjs"), "validate", "build/b/x/flow.kdl"], {cwd: dir, encoding: "utf8"});
    assert.equal(bad.status, 1, header + bad.stdout);
    assert.match(bad.stdout, /names no folder with SKILL\.md/);
  }
});

test("without arguments and without a terminal: the usage, no color, exit 2", () => {
  // NO_COLOR goes: with FORCE_COLOR, Node warns on stderr that it ignores it
  const {NO_COLOR, ...env} = process.env;
  const result = spawnSync(CTL, [], {encoding: "utf8", env: {...env, FORCE_COLOR: "1"}});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^error: a command is needed: page, lint, /);
  assert.doesNotMatch(result.stderr, /\x1b\[/);
});

test("a typo names the nearest command", () => {
  assert.equal(suggestCommand("pgae", ["page", "lint", "help"]), "page");
  assert.equal(suggestCommand("lnit", ["page", "lint"]), "lint");
  assert.equal(suggestCommand("zzzz", ["page", "lint"]), null);
  const result = ctl(SKILL, "pgae", "x");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^error: unknown command pgae; did you mean page\? /);
});

test("menu rows: number, name, status, path; › marks the last choice", () => {
  const rows = menuRows([{name: "release", flow: "b/release/flow.kdl", errors: 0}, {name: "x", flow: "x/flow.kdl", errors: 2}, {name: "y", flow: "y.kdl", errors: null}], "x/flow.kdl");
  assert.deepEqual(rows, [
    "   1  release  ok          b/release/flow.kdl",
    "›  2  x        2 errors    x/flow.kdl",
    "   3  y        unreadable  y.kdl",
  ]);
});
