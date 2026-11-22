// Ban on global and module-level mutable state in SkillFlow's own code (not _vendor/): such state makes one call change the next.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {VIEWER_LIBS, viewerScript} = await import(skillUrl("scripts/render.mjs"));

const read = (relative) => fs.readFileSync(path.join(SKILL, relative), "utf8");
const scripts = fs.readdirSync(path.join(SKILL, "scripts")).filter((name) => name.endsWith(".mjs"));

test("no script declares a module-level let or var", () => {
  // top-level `const` is allowed for constants; anything reassigned at module level is state
  for (const name of scripts) assert.deepEqual(read(`scripts/${name}`).split("\n").flatMap((line, index) => (/^(let|var)\s/.test(line) ? [`${name}:${index + 1}`] : [])), [], name);
});

test("no script writes to globalThis, and the viewer writes only window.skillflow", () => {
  for (const name of scripts) assert.doesNotMatch(read(`scripts/${name}`), /\bglobalThis\.\w+\s*=[^=]/, name);
  const page = viewerScript() + VIEWER_LIBS.map((name) => read(`assets/viewer-lib/${name}`)).join("");
  const writes = [...page.matchAll(/\bwindow\.(\w+)\s*=[^=]/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(writes)], ["skillflow"], "the start in the page script, and each viewer it starts");
});
