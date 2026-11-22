// Command-line errors: the error comes first, in the usage's own words, then only the usage line that fixes it.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {SKILL} from "./skill-path.mjs";

const CLI = path.join(SKILL, "scripts/skillflow.mjs");
const run = (...args) => spawnSync("node", [CLI, ...args], {encoding: "utf8"});
/** The stderr lines of a run that must exit 2. */
const fails = (...args) => {
  const result = run(...args);
  assert.equal(result.status, 2, result.stderr);
  return result.stderr.trim().split("\n");
};
const error = (...args) => fails(...args)[0];

test("an unknown flag is named with the command's valid flags", () => {
  assert.equal(error("validate", "flow.kdl", "--skil", "x"), "error: unknown flag --skil for validate; valid flags: --skill, --draft");
  assert.equal(error("render", "flow.kdl", "--out", "p.html"), "error: unknown flag --out for render; valid flags: -o/--output, --skill, --draft");
  assert.equal(error("--bogus"), "error: unknown flag --bogus");
});

test("a flag the command does not take lists the ones it does", () => {
  assert.equal(error("map", "dir", "--skill", "x"), "error: map has no --skill; valid flags: none");
});

test("an error names the usage placeholders and ends with the command's usage and a help pointer", () => {
  assert.deepEqual(fails("validate", "a.kdl", "b.kdl"), [
    "error: validate takes one FLOW; extra: b.kdl",
    "usage: node skillflow.mjs validate FLOW [--skill DIR] [--draft]",
    "more: node skillflow.mjs validate --help",
  ]);
  assert.equal(error("map"), "error: map needs SKILL_DIR");
  assert.equal(error("validate", "f.kdl", "--skill"), "error: --skill needs a value: --skill DIR");
  assert.equal(error("render", "f.kdl", "-o"), "error: -o needs a value: -o PAGE");
  assert.equal(error("validate", "f.kdl", "--draft=yes"), "error: --draft takes no value");
  // Node calls a value that looks like a flag "ambiguous": the value is still missing
  assert.equal(error("validate", "f.kdl", "--skill", "--draft"), "error: --skill needs a value: --skill DIR");
  assert.deepEqual(fails("validat", "x"), ["error: unknown command validat; did you mean validate? commands: page, lint, edit, validate, render, fmt, map, rules", "more: node skillflow.mjs --help"]);
});

test("no arguments print the error, then the full usage", () => {
  const lines = fails();
  assert.equal(lines[0], "error: a command is needed: page, lint, edit, validate, render, fmt, map, rules");
  assert.ok(lines.includes("commands:"), lines.join("\n"));
});

test("--help, help, and <command> --help exit 0; one command shows only its flags", () => {
  const all = run("--help");
  assert.equal(all.status, 0);
  for (const part of ["validate FLOW", "render FLOW", "map SKILL_DIR", "rules SKILL_DIR", "--skill DIR", "-o PAGE", "--draft", "exit: 0 ok"]) assert.match(all.stdout, new RegExp(part.replace(/[-.]/g, "\\$&")));
  assert.equal(run("help").stdout, all.stdout);
  const one = run("validate", "--help");
  assert.equal(one.status, 0);
  assert.match(one.stdout, /^usage: node skillflow\.mjs validate FLOW \[--skill DIR\] \[--draft\]\n/);
  assert.doesNotMatch(one.stdout, /-o PAGE|map SKILL_DIR/);
  assert.equal(run("help", "map").stdout, run("map", "-h").stdout);
  // map and rules never exit 1: their help says so
  assert.match(run("map", "--help").stdout, /\nexit: 0 ok · 2 the command line is wrong or the folder cannot be read\n$/);
  assert.equal(error("help", "nope"), "error: unknown command nope; commands: page, lint, edit, validate, render, fmt, map, rules");
});

test("an unreadable input is named in words; a skill folder in place of the flow file points at the flow file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-cli-"));
  try {
    fs.writeFileSync(path.join(tmp, "SKILL.md"), "# x\n");
    fs.writeFileSync(path.join(tmp, "flow.kdl"), "skillflow 1.0\n");
    assert.equal(error("validate", path.join(tmp, "none.kdl")), `error: ${path.join(tmp, "none.kdl")}: cannot read: no such file or folder`);
    assert.equal(error("validate", tmp), `error: ${tmp}: cannot read: a folder, not a file; pass the flow file: ${path.join(tmp, "flow.kdl")}`);
    assert.equal(error("map", path.join(tmp, "flow.kdl")), `error: ${path.join(tmp, "flow.kdl")}: no SKILL.md here; pass the skill folder that holds SKILL.md`);
    assert.equal(error("validate", path.join(tmp, "flow.kdl"), "--skill", os.tmpdir()), `error: ${os.tmpdir()}: no SKILL.md here; --skill takes the target skill folder, the one that holds its SKILL.md`);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test("the status line counts errors, todo items, and warnings", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-cli-"));
  try {
    const flow = path.join(tmp, "flow.kdl");
    fs.writeFileSync(flow, 'skillflow 1.0\nstep a\nstep b by=llm {\n    output x\n}\n');
    assert.equal(run("validate", flow).stdout.split("\n")[0], `FAIL ${flow} · 1 error, 1 warning`);
    assert.equal(run("validate", flow, "--draft").stdout.split("\n")[0], `OK (draft) ${flow} · 1 todo item, 1 warning`);
    fs.writeFileSync(flow, "skillflow 1.0\nstep a by=llm\n");
    assert.equal(run("validate", flow).stdout.split("\n")[0], `OK ${flow}`);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});
