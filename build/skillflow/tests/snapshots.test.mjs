// Snapshot tests: CLI `validate` output and the render model for fixture flows.
// UPDATE_SNAPSHOTS=1 rewrites tests/snapshots/ instead of comparing.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {buildModel} = await import(skillUrl("scripts/render.mjs"));
const {main} = await import(skillUrl("scripts/skillflow.mjs"));
const {installedVersion, load} = await import(skillUrl("scripts/validate.mjs"));

const SNAPSHOTS = path.join(import.meta.dirname, "snapshots");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const example = /```kdl\n([\s\S]*?)```/.exec(fs.readFileSync(path.join(SKILL, "references", "example.md"), "utf8"))[1];

const flows = {
  "phase-bad-child": "skillflow 1.0\nphase a {\n    loop x\n}\n",
  "bad-executor": "skillflow 1.0\nstep x by=robot\n",
  "missing-executor": "skillflow 1.0\nstep x\n",
  "duplicate-name": "skillflow 1.0\nstep x by=llm\nstep x by=llm\n",
  "name-with-space": 'skillflow 1.0\nstep "has space" by=llm\n',
  "decide-no-when": 'skillflow 1.0\ndecide ok "Fine?" by=llm\n',
  "input-read": "skillflow 1.0\ncontext {\n    input ghost \"g\"\n}\nstep x by=llm {\n    input ghost\n}\n",
  "missing-file": 'skillflow 1.0\nstep x by=code file="scripts/none.sh"\n',
  "file-on-llm": 'skillflow 1.0\nstep x by=llm file="scripts/collect.sh"\n',
  "unknown-property": "skillflow 1.0\nstep x by=llm color=red\n",
  "input-no-name": 'skillflow 1.0\ncontext {\n    input "a sentence"\n}\n',
  "file-outside-skill": 'skillflow 1.0\nstep x by=code file="../x.sh"\n',
  "end-with-children": 'skillflow 1.0\nend "x" {\n    step y by=llm\n}\n',
  "when-twice": 'skillflow 1.0\ndecide d "Q?" by=llm {\n    when a "one"\n    when a {\n        end "two"\n    }\n}\n',
  "decide-no-fork": 'skillflow 1.0\ndecide scope "Project or user?" by=human {\n    when project "the workspace folder"\n    when user "the home folder"\n}\n',
  "empty-on-fail": "skillflow 1.0\nstep x by=llm {\n    on-fail\n}\n",
  "unreachable-step": 'skillflow 1.0\nend "stop"\nstep x by=llm\n',
  "context-late": 'skillflow 1.0\nphase p {\n    step a by=llm\n}\ncontext {\n    invariant "x"\n}\n',
  "on-fail-duplicate-name": 'skillflow 1.0\nstep a by=llm { on-fail { end "x" } }\nstep a by=llm\n',
  "extra-argument": 'skillflow 1.0\nstep a by=llm "one" "two"\n',
  "number-prose": "skillflow 1.0\nstep a by=llm 42\n",
  "skill-not-name": "skillflow 1.0\nstep a by=llm skill=#true\n",
  "two-on-fail": 'skillflow 1.0\nstep a by=llm {\n    on-fail "x"\n    on-fail "y"\n}\n',
  "output-not-bare": 'skillflow 1.0\nstep a by=llm {\n    output "two words"\n}\n',
  "header-version-stamp": 'skillflow 1.0 skill-version="0.3"\nstep x by=llm\n',
  "header-bad-stamp": "skillflow 1.0 skill-version=2\nstep x by=llm\n",
  "header-missing": "phase a\n",
  "header-plain": "skillflow 1.0\nstep x by=llm\n",
  "example": example,
  "unicode-names": "skillflow 1.0\nstep шаг-1 by=llm {\n    output данные\n}\nstep шаг-2 by=llm {\n    input ответ \"ответ пользователя\"\n}\n",
  "html-escape-prose": "skillflow 1.0\nstep a by=llm \"Use <b> & \\\"q\\\" and 'x' </script>\"\n",
  "type-annotation": "skillflow 1.0\nstep a by=(t)llm\n",
};

function capture(argv) {
  const out = [];
  const {log, error} = console;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => out.push(a.join(" "));
  try { return {code: main(argv), text: out.map((l) => l + "\n").join("")}; } finally { console.log = log; console.error = error; }
}

function compare(file, actual) {
  if (UPDATE) { fs.mkdirSync(SNAPSHOTS, {recursive: true}); fs.writeFileSync(file, actual); return; }
  assert.equal(actual, fs.readFileSync(file, "utf8"), `${path.basename(file)} differs; rerun with UPDATE_SNAPSHOTS=1 to accept`);
}

for (const [name, body] of Object.entries(flows)) {
  test(`snapshot ${name}`, () => {
    // the real path: macOS /var is /private/var, and the validator names the skill folder by its real path
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-snap-")));
    try {
      fs.mkdirSync(path.join(tmp, "scripts"));
      fs.writeFileSync(path.join(tmp, "SKILL.md"), "# demo\n");
      fs.writeFileSync(path.join(tmp, "scripts", "collect.sh"), "");
      const flow = path.join(tmp, "flow.kdl");
      fs.writeFileSync(flow, body);
      const {code, text} = capture(["validate", flow]);
      // the installed SkillFlow version changes with each release; the snapshots keep a placeholder
      compare(path.join(SNAPSHOTS, `${name}.txt`), text.replaceAll(tmp, "<TMP>").replaceAll(`installed SkillFlow ${installedVersion()}`, "installed SkillFlow <VERSION>"));
      if (code === 0) {
        const {text: source, doc} = load(flow);
        compare(path.join(SNAPSHOTS, `${name}.model.json`), JSON.stringify(buildModel(doc, source, "demo", "flow.kdl", [], null), null, 1) + "\n");
      }
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
  });
}
