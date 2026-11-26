// Guards for rules and states that no other test pinned: each case fails when its rule is deleted from the validator.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, test} from "node:test";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {check, follow, parseFlow, Report, skillVersion} = await import(skillUrl("scripts/validate.mjs"));
const {main} = await import(skillUrl("scripts/skillflow.mjs"));

let tmp, skill;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-guards-"));
  skill = path.join(tmp, "skill");
  fs.mkdirSync(path.join(skill, "scripts"), {recursive: true});
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo\n");
});
afterEach(() => fs.rmSync(tmp, {recursive: true, force: true}));

const run = (body, dir = skill) => {
  const flow = path.join(skill, "flow.kdl");
  fs.writeFileSync(flow, "skillflow 1.0\n" + body);
  return check(flow, dir).report;
};
const errors = (body, dir) => run(body, dir).errors.map(([line, message]) => `${line} ${message}`);

test("rules that only this file guards", () => {
  const cases = [
    ['step a by=llm {\n    on-fail "x"\n}\n', "3 `on-fail` is not allowed inside `step`"],
    ['step a by=llm {\n    tools\n}\n', "3 `tools` lists nothing"],
    ['step a by=llm {\n    tools "two words"\n}\n', "3 `two words` in `tools` is not a bare word"],
    ['context {\n    output 5\n}\n', "3 `output` takes a sentence, or a name and a sentence"],
    ['decide d "Q?" by=llm {\n    when\n}\n', "3 `when` needs an outcome word"],
    ["step a by=llm\nskillflow 1.0\n", "3 `skillflow` appears twice"],
  ];
  for (const [body, expected] of cases) assert.ok(errors(body).includes(expected), `${expected}\n${errors(body).join("\n")}`);
});

test("file= without the skill folder is one gap, named once", () => {
  const report = run('step a by=code file="scripts/a.sh"\nstep b by=code file="scripts/b.sh"\n', null);
  assert.deepEqual(report.errors.map(([line, message]) => `${line} ${message}`), ["2 cannot check `file=` paths without the target skill folder"]);
});

test("a file= symlink that leads outside the skill is an error", () => {
  fs.writeFileSync(path.join(tmp, "outside.sh"), "echo hi\n");
  fs.symlinkSync(path.join(tmp, "outside.sh"), path.join(skill, "scripts", "link.sh"));
  assert.ok(errors('step a by=code file="scripts/link.sh"\n').includes("2 `file=scripts/link.sh` leads outside the skill folder"));
});

test("follow() gives the same answer before and after a check() of another flow", () => {
  // a check() must leave no state behind: a flow whose named result is `x` once made a later trace accept a rewrite of `x`
  const nodes = parseFlow('step a by=llm {\n    output x\n}\n').nodes;
  const warnings = () => { const report = new Report(""); follow(nodes, new Set(["x"]), report); return report.warnings.length; };
  const before = warnings();
  fs.writeFileSync(path.join(skill, "other.kdl"), 'skillflow 1.0\ncontext {\n    input x "x"\n    output x "x again"\n}\nstep a by=llm {\n    output x\n}\n');
  check(path.join(skill, "other.kdl"), skill);
  assert.equal(warnings(), before);
  assert.equal(before, 1);
});

test("a SKILL.md with CRLF line ends still gives its version", () => {
  fs.writeFileSync(path.join(skill, "SKILL.md"), '---\r\nname: demo\r\nmetadata:\r\n  version: "1.2"\r\n---\r\n# demo\r\n');
  assert.equal(skillVersion(path.join(skill, "SKILL.md")), "1.2");
  fs.writeFileSync(path.join(skill, "flow.kdl"), 'skillflow 1.0 skill-version="0.9"\nstep a by=llm\n');
  assert.match(check(path.join(skill, "flow.kdl"), skill).report.warnings.map(([, m]) => m).join(), /synced with skill version 0\.9, but SKILL\.md says 1\.2/);
});

test("a Markdown file of the skill that cannot be read is skipped, not a crash", {skip: process.getuid?.() === 0 && "root reads any file"}, () => {
  fs.mkdirSync(path.join(skill, "references"));
  const locked = path.join(skill, "references", "r.md");
  fs.writeFileSync(locked, "x\n");
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo\nsee references/r.md\n");
  fs.chmodSync(locked, 0o000);
  try {
    const flow = path.join(skill, "flow.kdl");
    fs.writeFileSync(flow, "skillflow 1.0\n" + Array.from({length: 60}, (_, i) => `step s${i} by=llm "${"intent ".repeat(10)}"`).join("\n") + "\n");
    const {log} = console;
    console.log = () => {};
    try { assert.equal(main(["validate", flow]), 0); } finally { console.log = log; }
  } finally {
    fs.chmodSync(locked, 0o644);
  }
});

test("a ref repeated with other case, spaces, or hyphens is the same ref", () => {
  assert.ok(errors('step a by=llm ref="S 9"\nstep b by=llm ref="s-9"\n').includes('3 ref "s-9" is already used on line 2'));
});

test("a file= path that climbs out in the middle is an error", () => {
  assert.ok(errors('step a by=code file="scripts/../../x.sh"\n').includes("2 `file=scripts/../../x.sh` must be a path inside the skill folder"));
});

test("render keeps a page whose comment block parses but holds no comment list", async () => {
  const {savedComments} = await import(skillUrl("scripts/skillflow.mjs"));
  const page = path.join(tmp, "page.html");
  for (const [block, expected] of [['{"v":2}', Infinity], ["[]", Infinity], ["null", 0], ['{"comments":[]}', 0], ['{"comments":[{}]}', 1]]) {
    fs.writeFileSync(page, `<script type="application/json" id="sf-comments">${block}</script>`);
    assert.equal(savedComments(page), expected, block);
  }
});

test("rules: a line with only `unless`, a failure deep under its branch, and a large script", async () => {
  const {spawnSync} = await import("node:child_process");
  const CLI = path.join(SKILL, "scripts/skillflow.mjs");
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo\nAsk unless the user said so.\n");
  fs.writeFileSync(path.join(skill, "scripts", "run.py"), "if missing:\n" + "    x = 1\n".repeat(5) + "    raise SystemExit('no input')\n");
  fs.writeFileSync(path.join(skill, "scripts", "big.py"), "x = 1\n".repeat(10_000));
  const rules = spawnSync("node", [CLI, "rules", skill], {encoding: "utf8"}).stdout;
  assert.match(rules, /^SKILL\.md:2: Ask unless the user said so\.$/m);
  assert.match(rules, /^scripts\/run\.py:7: raise SystemExit\('no input'\) {2}\[under: if missing:\]$/m);
  const map = spawnSync("node", [CLI, "map", skill], {encoding: "utf8"}).stdout;
  assert.match(map, /^ {2}scripts\/big\.py {2}10000 lines {2}\[name and purpose only\]$/m);
  assert.match(map, /^ {2}scripts\/run\.py {2}7 lines$/m);
});

test("syntax and placement hints name the cause", () => {
  const hints = (body) => run(body).errors.map(([, , hint]) => hint).join("\n");
  assert.match(hints('step a by=llm "x\nmore"\n'), /^a "…" string ends on its line/);
  assert.match(hints('step a by=llm """x"""\n'), /^a """ string spans lines/);
  // a node indented under another without { } is read at the top level: the hint says where it belongs
  assert.match(hints('step a by=llm "x"\n    output notes "n"\n'), /`output` belongs in context, step, decide, gate, when, catch: put it in the \{ \} block of such a node$/);
  assert.doesNotMatch(hints("phase p {\n    loop x\n}\n"), /belongs in/);
});

test("an existing-data warning names the line that names the data first, since either line may be wrong", () => {
  const [[line, message, hint]] = run('step a by=llm {\n    input draft "the draft"\n}\nstep b by=llm {\n    output draft "the draft"\n}\n').warnings;
  assert.deepEqual([line, message], [6, "output `draft` exists already: an update is not written"]);
  assert.match(hint, /^line 3 names it first, and it may be the mistake: fix that line, or drop this line/);
});
