// Seeded differential test: random structural flows through the validator and the independent reference model.
// Compares the node inputs that ask for new data (those without an "exists already" warning), the named flow output
// `c` (not produced, recovery warning, no normal end), and the data where the flow ends, in two seeded profiles.
// Adapted from the 2026-11-08 logic review; bounded evidence, not a proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {reference} from "./reference-model.mjs";
import {skillUrl} from "./skill-path.mjs";
const {argsProps, check, follow, kids, lineOf, parseFlow, Report} = await import(skillUrl("scripts/validate.mjs"));

// a profile sets how often each shape appears: "mixed" covers all structure; "recovery" makes continuing catch
// handlers common, so the recovery warnings get real coverage. min: cases each run must reach.
const PROFILES = {
  mixed: {seed: 20261108, cases: 1500, names: ["a", "b", "c"], output: 0.65, input: 0.5, fail: 0.4, handlerOutput: 0.4, handlerEnd: 0.2, more: 0.5, min: {missing: 500, recovery: 40, ended: 50}},
  recovery: {seed: 20261109, cases: 1000, names: ["b", "c"], output: 0.6, input: 0.3, fail: 0.7, handlerOutput: 0.15, handlerEnd: 0.1, more: 0.8, min: {missing: 300, recovery: 60, ended: 20}},
};
let P = PROFILES.mixed, seed = 0, id = 0;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = (list) => list[Math.floor(random() * list.length)];
const data = () => pick(P.names);
const ports = () => `${random() < P.input ? `input ${data()}\n` : ""}${random() < P.output ? `output ${data()}\n` : ""}`;

function action(depth = 0, handler = false) {
  const name = `n${++id}`;
  const kind = depth < 3 ? pick(handler ? ["step", "decide", "gate"] : ["step", "step", "decide", "gate", "phase"]) : "step";
  if (kind === "phase") return `phase ${name} {\n${block(depth + 1)}\n}\n`;
  if (kind === "step") {
    const fail = depth < 3 && random() < P.fail
      ? `catch "Recover." {\n${random() < P.handlerOutput ? `output ${data()}\n` : ""}${random() < 0.65 ? action(depth + 1, true) : ""}${random() < P.handlerEnd ? 'end "stopped"\n' : ""}}\n` : "";
    return `step ${name} by=code {\n${ports()}${fail}}\n`;
  }
  const outcomes = kind === "gate" ? pick([["rejected"], ["approved", "rejected"], ["approved"], ["revise", "rejected"]]) : pick([["yes"], ["yes", "no"]]);
  // an outcome with nothing in it carries prose: a bare `when` is an error
  const whens = outcomes.map((outcome) => {
    const body = `${random() < 0.4 ? `output ${data()}\n` : ""}${random() < 0.6 ? action(depth + 1) : ""}${random() < 0.25 ? 'end "stopped"\n' : ""}`;
    return `when ${outcome}${body ? "" : ' "nothing"'} {\n${body}}\n`;
  });
  return `${kind} ${name} "Q?" ${kind === "decide" ? "by=llm" : ""} {\n${ports()}${whens.join("")}}\n`;
}
const block = (depth) => action(depth) + (random() < P.more ? action(depth) : "") + (random() < P.more / 3 ? action(depth) : "");

for (const [profile, settings] of Object.entries(PROFILES)) test(`${settings.cases} generated flows (${profile}): the validator agrees with the reference model`, () => {
  P = settings; seed = settings.seed;
  const seen = {missing: 0, recovery: 0, ended: 0};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-generated-"));
  try {
    for (let i = 0; i < P.cases; i++) {
      id = 0;
      const text = 'skillflow 1.0\ncontext {\n  input a "initial"\n  output c "the result"\n}\n' + block(0), file = path.join(tmp, "flow.kdl");
      fs.writeFileSync(file, text);
      const lenient = reference(text), strict = reference(text, true);
      const doc = parseFlow(text), owners = new Map(), asked = [];
      const visit = (node, owner) => {
        if (["step", "decide", "gate"].includes(node.getName())) owner = String(argsProps(node)[0][0]);
        if (node.getName() === "input" && owner && lenient.reached.includes(owner)) { owners.set(lineOf(node), owner); asked.push(`${owner}:${argsProps(node)[0][0]}`); }
        kids(node).forEach((kid) => visit(kid, owner));
      };
      doc.nodes.forEach((node) => visit(node, ""));
      const {report} = check(file, null);
      // the generator must write grammar-valid flows (a bare `when` among them is an error): only data-path errors may remain
      assert.deepEqual(report.errors.filter(([, message]) => !/never runs|^flow output `/.test(message)), [], `${profile} case ${i}:\n${text}`);
      const read = new Set(report.warnings.flatMap(([line, message]) => {
        const found = /^input `(.+?)` exists already: reading is prose$/.exec(message);
        return found ? [`${owners.get(line)}:${found[1]}`] : [];
      }));
      const has = (list, pattern) => list.some(([, message]) => pattern.test(message));
      const after = follow(doc.nodes, new Set(["a"]), new Report("")), status = lenient.outputStatus.c;
      assert.deepEqual({
        end: after === null ? null : [...after].sort(),
        missing: [...new Set(asked.filter((item) => !read.has(item)))].sort(),
        notProduced: has(report.errors, /^flow output `c` is not produced/),
        recovery: has(report.warnings, /^flow output `c` exists only when/),
        noEnd: has(report.warnings, /^flow output `c` cannot leave the flow/),
      }, {
        end: lenient.end,
        missing: lenient.missing,
        notProduced: status === "none" || status === "some",
        recovery: status === "all" && strict.outputStatus.c !== "all",
        noEnd: status === "no-normal-end",
      }, `${profile} case ${i}:\n${text}`);
      seen.missing += lenient.missing.length > 0;
      seen.recovery += status === "all" && strict.outputStatus.c !== "all";
      seen.ended += lenient.end === null;
    }
    // a changed generator must keep exercising each kind of finding, or this test proves little
    for (const kind of Object.keys(seen)) assert.ok(seen[kind] >= P.min[kind], `${profile}: only ${seen[kind]} cases with ${kind} (want ${P.min[kind]})`);
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});
