// Data-path corpus: hand expectations, checked against the validator and against an independent reference model.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {describe, test} from "node:test";
import {dataCases, formCases} from "./data-paths.cases.mjs";
import {reference} from "./reference-model.mjs";
import {tmpDir} from "./tmp.mjs";
import {skillUrl} from "./skill-path.mjs";
const {buildModel} = await import(skillUrl("scripts/render.mjs"));
const {argsProps, check, follow, kids, lineOf, parseFlow, Report} = await import(skillUrl("scripts/validate.mjs"));

const tmp = tmpDir("sf-paths-");
let count = 0;
const flowText = (text) => "skillflow 1.0\n" + text;

function validate(text) {
  const file = path.join(tmp, `f${++count}.kdl`);
  fs.writeFileSync(file, text);
  return check(file, null).report;
}

/**
 * The data facts of a validator report, keyed by node name so that line numbers do not matter. missing: the inputs of
 * the nodes in `reached` that get no "exists already" warning, so the skill asks the user for new data there.
 */
function facts(text, reached) {
  const report = validate(text), owners = [], asked = [], read = new Set();
  const visit = (n) => {
    if (["step", "decide", "gate"].includes(n.getName())) {
      const name = String(argsProps(n)[0][0]);
      owners.push([lineOf(n), name]);
      if (reached.includes(name)) for (const k of kids(n)) if (k.getName() === "input") asked.push(`${name}:${argsProps(k)[0][0]}`);
    }
    kids(n).forEach(visit);
  };
  parseFlow(text).nodes.forEach(visit);
  owners.sort((a, b) => a[0] - b[0]);
  const owner = (line) => owners.filter(([l]) => l <= line).at(-1)?.[1] ?? "?";
  const out = {missing: [], unreachable: [], flowOutputs: [], recovery: [], other: []};
  for (const [line, message] of report.errors) {
    let m;
    if ((m = /^`(\w+)` never runs/.exec(message))) out.unreachable.push(`${m[1]}:${owners.find(([l]) => l === line)?.[1]}`);
    else if ((m = /^flow output `(.+?)` is not produced/.exec(message))) out.flowOutputs.push(m[1]);
    else out.other.push(message);
  }
  for (const [line, message] of report.warnings) {
    let m;
    if ((m = /^input `(.+?)` exists already: reading is prose$/.exec(message))) { read.add(`${owner(line)}:${m[1]}`); continue; }
    // style warnings of the born-once rule have their own tests in skillflow.test.mjs; this corpus checks data paths
    if (/ has no description$| is written inside a node$| exists already: | forks no path: /.test(message)) continue;
    if ((m = /^flow output `(.+?)` exists only when/.exec(message))) out.recovery.push(`output:${m[1]}`);
    else out.other.push(message);
  }
  out.missing = [...new Set(asked.filter((item) => !read.has(item)))];
  for (const key of ["missing", "unreachable", "flowOutputs", "recovery"]) out[key].sort();
  return out;
}

describe("data paths", () => {
  for (const c of dataCases) {
    test(`${c.name}: ${c.why}`, () => {
      const text = flowText(c.text), ref = reference(text), strict = reference(text, true);
      const notProduced = Object.entries(ref.outputStatus).filter(([, s]) => s === "none" || s === "some").map(([o]) => o).sort();
      // recovery: the flow outputs that the strict reading loses beyond the lenient one
      const recovery = Object.keys(ref.outputStatus).filter((o) => ref.outputStatus[o] === "all" && strict.outputStatus[o] !== "all").map((o) => `output:${o}`).sort();
      assert.deepEqual({missing: ref.missing, unreachable: ref.unreachable, end: ref.end, unused: ref.unused, flowOutputs: notProduced, recovery},
        {...c.expect, flowOutputs: c.flowOutputs, recovery: c.recovery ?? []}, "the reference model disagrees with the hand expectation");
      const got = facts(text, ref.reached);
      assert.deepEqual(got, {missing: c.expect.missing, unreachable: c.expect.unreachable, flowOutputs: c.flowOutputs,
        recovery: c.recovery ?? [], other: []});
    });
  }
});

function* cards(nodes) {
  for (const n of nodes) {
    yield n;
    yield* cards(n.children ?? []);
    if (n.catch) yield* cards(n.catch.children);
    for (const w of n.whens ?? []) yield* cards(w.children);
  }
}

/** Blocks that the render model marks as ending, keyed like `terminates` of the reference model. */
function modelTerminates(model) {
  const out = {};
  for (const n of cards(model.flow)) {
    if (n.kind === "phase") out[n.name] = n.ends;
    if (n.catch) out[`${n.name}/catch`] = n.catch.ends;
    for (const w of n.whens ?? []) out[`${n.name}/${w.outcome}`] = w.ends;
  }
  return out;
}

// one flow through the validator and the render model agrees with the reference model on control flow
describe("control flow", () => {
  for (const c of dataCases) {
    test(c.name, () => {
      const text = flowText(c.text), ref = reference(text), doc = parseFlow(text);
      if (c.terminates) assert.deepEqual(ref.terminates, c.terminates, "the reference model disagrees with the hand expectation");
      const model = buildModel(doc, text, "t", "s", []);
      const after = follow(doc.nodes, new Set(model.context.inputs.map((i) => i.name)), new Report(""));
      assert.deepEqual(after && [...after].sort(), ref.end, "validator: data where the flow ends normally");
      const marked = modelTerminates(model);
      assert.deepEqual(Object.fromEntries(Object.keys(ref.terminates).map((k) => [k, marked[k]])), ref.terminates, "render model: blocks that end");
    });
  }
});

describe("data forms", () => {
  for (const c of formCases) {
    test(c.name, () => {
      const lines = [...validate(flowText(c.text)).lines()].filter((l) => / error: /.test(l));
      if (!c.errors.length) assert.deepEqual(lines, []);
      for (const pattern of c.errors) assert.ok(lines.some((l) => pattern.test(l)), `${pattern} not in:\n${lines.join("\n")}`);
    });
  }
});

test("a recovery warning names the step on the path that reaches the end, not one on an ended branch", () => {
  const branch = (outcome, step, tail) => `  when ${outcome} {\n    step ${step} by=code {\n      output report\n      catch "Continue without a report."\n    }\n${tail}  }\n`;
  const report = validate(flowText(`decide route "Which?" by=human {\n${branch("archived", "obsolete", '    end "archived"\n')}${branch("active", "current", "")}}\n`.replace(/^/, 'context {\n  output report "the report"\n}\n')));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings.filter(([, m]) => m.includes("exists only when")).map(([, m]) => m.match(/step `(.+?)`/)[1]), ["current"]);
});

test("a flow output with no normal end warns", () => {
  const report = validate(flowText('context {\n  output r "the result"\n}\nstep a by=llm {\n  output r\n}\nend "stop"\n'));
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some(([line, message]) => line === 3 && message.includes("every path stops at an `end`")));
});

test("render credits an outcome's output to its decision", () => {
  const c = dataCases.find((x) => x.name === "when-direct-both"), text = flowText(c.text);
  const model = buildModel(parseFlow(text), text, "t", "s", []);
  const decide = model.flow[0];
  assert.deepEqual(model.data.mode.outputOf, [decide.id]);
  assert.deepEqual(decide.whens.map((w) => w.outputs), [["mode"], ["mode"]]);
  assert.deepEqual(decide.outputs, [], "the decision itself outputs nothing");
});
