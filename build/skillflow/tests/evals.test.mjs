// The eval kit builds what cases.md promises: every seeded difference applies, and the reference flow is clean.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {CASES, FLOW, grade, setup} from "../evals/evalkit.mjs";
import {SKILL} from "./skill-path.mjs";
import {tmpDir} from "./tmp.mjs";

const validate = (ws) => spawnSync("node", [path.join(SKILL, "scripts/skillflow.mjs"), "validate", path.join(ws, FLOW)], {encoding: "utf8"});
const quiet = (run) => { const log = console.log; console.log = () => {}; try { return run(); } finally { console.log = log; } };

test("every case sets up, and its seeded differences apply exactly once", () => {
  for (const name of Object.keys(CASES)) assert.ok(fs.existsSync(path.join(setup(name, tmpDir("sf-eval-")), "AGENTS.md")), name);
});

test("the reference flow matches the fixture skill with no warning", () => {
  const run = validate(setup("check-clean", tmpDir("sf-eval-")));
  assert.equal(run.status, 0, run.stdout);
  assert.doesNotMatch(run.stdout.split("\n")[0], /warning/);
});

test("the renamed label and the broken flow reach the validator", () => {
  assert.match(validate(setup("check-drift", tmpDir("sf-eval-"))).stdout, /S3/);
  assert.equal(validate(setup("check-broken-flow", tmpDir("sf-eval-"))).status, 1);
});

test("grade passes an untouched check workspace and fails a changed one", () => {
  const run = tmpDir("sf-eval-"), ws = setup("check-clean", run);
  assert.equal(quiet(() => grade("check-clean", run)), true);
  fs.appendFileSync(path.join(ws, FLOW), "\n");
  assert.equal(quiet(() => grade("check-clean", run)), false);
});

test("grade fails reverse until a clean flow file exists", () => {
  const run = tmpDir("sf-eval-"), ws = setup("reverse", run);
  assert.equal(quiet(() => grade("reverse", run)), false);
  fs.copyFileSync(path.join(import.meta.dirname, "../evals/fixtures/expense-report.kdl.fixture"), path.join(ws, FLOW));
  assert.equal(quiet(() => grade("reverse", run)), true);
});
