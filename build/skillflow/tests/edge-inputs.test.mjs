// Edge inputs from the 2026-11-14 review: empty text, names that are Object keys, a failure line that writes, an unreadable page.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {tmpDir} from "./tmp.mjs";
import {SKILL} from "./skill-path.mjs";

const CLI = path.join(SKILL, "scripts/skillflow.mjs");
const run = (...args) => spawnSync("node", [CLI, ...args], {encoding: "utf8"});
const tmp = () => tmpDir("sf-edge-");
const flow = (dir, body) => { const file = path.join(dir, "flow.kdl"); fs.writeFileSync(file, `skillflow 1.0\n${body}`); return file; };

test("an empty question or invariant fails strict validation", () => {
  for (const body of ['gate approved ""\n', 'context {\n  invariant "  "\n}\nstep a "Do it." by=llm\n']) {
    const result = run("validate", flow(tmp(), body));
    assert.equal(result.status, 1, body + result.stdout);
  }
});

test("a decide outcome named like an Object key keeps its implied outcome", () => {
  const dir = tmp(), page = path.join(dir, "p.html");
  const file = flow(dir, 'decide pick "Q?" by=llm {\n  when constructor {\n    end "stop"\n  }\n}\nstep done "Do it." by=llm\n');
  assert.equal(run("render", file, "-o", page).status, 0);
  assert.ok(fs.readFileSync(page, "utf8").includes('"implied":[{"outcome":"other"'));
});

test("on-fail with an end and continuing prose points to a decide, not to dropping the end", () => {
  const file = flow(tmp(), 'step a "Do it." by=llm {\n  on-fail "If the token is absent, end. If the request times out, continue." {\n    end "missing token"\n  }\n}\n');
  const out = run("validate", file).stdout;
  assert.match(out, /holds an `end`, but its prose says the flow continues/);
  assert.match(out, /decide/);
  assert.doesNotMatch(out, /drop the bare end/);
});

test("rules lists a line that handles a failure and writes a file as both", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# T\n");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts", "w.js"), 'try { fs.writeFileSync("output.txt", "x"); } catch (e) { console.error(e); }\n');
  const out = run("rules", dir).stdout;
  assert.match(out, /scripts\/w\.js:1: .*\[write\]/);
  assert.match(out, /1 failure lines, 1 write lines/);
});

test("render refuses a page it cannot read and leaves it unchanged", {skip: process.getuid?.() === 0 && "root reads any file"}, () => {
  const dir = tmp(), page = path.join(dir, "p.html");
  const before = '<script id="sf-comments" type="application/json">{"comments":[{"id":"c1"}]}</script>';
  fs.writeFileSync(page, before);
  fs.chmodSync(page, 0o200);
  try {
    const result = run("render", flow(dir, 'step a "Do it." by=llm\n'), "-o", page);
    assert.equal(result.status, 2, result.stdout + result.stderr);
  } finally { fs.chmodSync(page, 0o600); }
  assert.equal(fs.readFileSync(page, "utf8"), before);
});

// Feedback from 20 reverse runs (2026-11-14): page name and version, closing end, library writes, depth in on-fail, router size base.
const skill = (dir, md, files = {}) => {
  const root = path.join(dir, "sk");
  fs.mkdirSync(path.join(root, "references"), {recursive: true});
  fs.writeFileSync(path.join(root, "SKILL.md"), md);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return root;
};

test("render without -o writes <skill>-<skill-version>.html next to the flow, or next to the skill folder for a flow inside it", () => {
  const dir = tmp(), root = skill(dir, "# sk\n"), flows = path.join(dir, "flows");
  fs.mkdirSync(flows);
  const file = path.join(flows, "flow.kdl");
  fs.writeFileSync(file, 'skillflow 1.0 skill-version="1.2"\nstep a "Do it." by=llm\n');
  assert.equal(run("render", file, "--skill", root).status, 0);
  const html = fs.readFileSync(path.join(flows, "sk-1.2.html"), "utf8");
  const own = /version:\s*"([^"]+)"/.exec(fs.readFileSync(path.resolve(path.dirname(CLI), "..", "SKILL.md"), "utf8"))[1];
  assert.ok(html.includes(`"skillflowVersion":"${own}"`));
  fs.copyFileSync(file, path.join(root, "flow.kdl"));
  const inside = run("render", path.join(root, "flow.kdl"));
  assert.equal(inside.status, 0, inside.stderr);
  assert.ok(fs.existsSync(path.join(path.dirname(root), "sk-1.2.html")));
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith(".html")), []);
});

test("a closing top-level end is named as the reason a flow output cannot leave, and warns without named flow outputs", () => {
  const out = run("validate", flow(tmp(), 'context {\n  output notes "the notes"\n}\nstep a "Write." by=llm {\n  output notes "the notes"\n}\nend "done"\n')).stdout;
  assert.match(out, /cannot leave the flow/);
  assert.match(out, /drop the closing top-level `end` on line 8/);
  assert.doesNotMatch(out, /closing top-level `end` is unnecessary/);
  const unnamed = run("validate", flow(tmp(), 'context {\n  output "the notes"\n}\nstep a "Write." by=llm\nend "done"\n'));
  assert.equal(unnamed.status, 0);
  assert.match(unnamed.stdout, /:6: warning: closing top-level `end` is unnecessary/);
});

test("rules marks library saves as writes", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# T\n");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts", "w.py"), 'wb.save(path)\nprs.save("deck.pptx")\nwith zipfile.ZipFile(out, "w") as z:\n    pass\nzipfile.ZipFile(src)\n');
  const writes = run("rules", dir).stdout.split("\n").filter((l) => l.includes("[write]")).map((l) => Number(/:(\d+):/.exec(l)[1]));
  assert.deepEqual(writes, [1, 2, 3]);
});

test("a decide inside on-fail and a top-level phase add no depth warning; nested phases and deeper logic still do", () => {
  const deep = (inner) => `phase outer {\n  phase inner {\n    decide d "Q?" by=llm {\n      when yes {\n        step s "Do it." by=llm {\n${inner}        }\n      }\n    }\n  }\n}\n`;
  const recovery = '        on-fail "If X, end." {\n          decide x "Is it X?" by=llm {\n            when yes {\n              step tell "Tell." by=human\n              end "x"\n            }\n          }\n        }\n';
  assert.doesNotMatch(run("validate", flow(tmp(), deep(recovery))).stdout, /levels deep/);
  const main = '        on-fail "Stop." {\n          end "stop"\n        }\n';
  assert.doesNotMatch(run("validate", flow(tmp(), deep(main))).stdout, /levels deep/);
  assert.doesNotMatch(run("validate", flow(tmp(), 'phase p {\n  decide d "Q?" by=llm {\n    when yes {\n      decide e "R?" by=llm {\n        when yes {\n          step s "Do." by=llm\n        }\n      }\n    }\n  }\n}\n')).stdout, /levels deep/);
  assert.match(run("validate", flow(tmp(), 'phase outer {\n  phase inner {\n    decide d "Q?" by=llm {\n      when yes {\n        decide e "R?" by=llm {\n          when yes {\n            step s "Do." by=llm\n          }\n        }\n      }\n    }\n  }\n}\n')).stdout, /4 levels deep/);
});

test("the size limit counts the Markdown files SKILL.md names", () => {
  const dir = tmp(), root = skill(dir, "# sk\nRun `references/stage-1.md`.\n", {"references/stage-1.md": "x".repeat(40_000)});
  const prose = Array.from({length: 30}, (_, i) => `step s${i} "${"Do the work of this stage well. ".repeat(5).trim()}" by=llm\n`).join("");
  const file = path.join(dir, "flow.kdl");
  fs.writeFileSync(file, `skillflow 1.0\n${prose}`);
  assert.doesNotMatch(run("validate", file, "--skill", root).stdout, /the limit is/);
  fs.writeFileSync(path.join(root, "SKILL.md"), "# sk\n");
  assert.match(run("validate", file, "--skill", root).stdout, /the limit is 4000: 50% of the 5 characters of SKILL\.md, but at least 4000/);
});
