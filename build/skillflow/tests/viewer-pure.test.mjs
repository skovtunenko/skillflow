// Tests for the viewer's DOM-free files in skills/productivity/skillflow/assets/viewer-lib/, each run alone in a vm
// context as the page runs it (node:test). Expected values were recorded from the viewer code before these functions left it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import vm from "node:vm";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {buildModel} = await import(skillUrl("scripts/render.mjs"));
const {load} = await import(skillUrl("scripts/validate.mjs"));

const HOSTILE = "</script><img src=x onerror=\"window.pwned=1\"> & <b>bold</b>";
// values from another vm realm have other prototypes: compare them as plain JSON
const J = (x) => JSON.parse(JSON.stringify(x));

/** The one name `file` declares, from a context of its own; newId reads a fixed clock and random source there. */
function lib(file, name) {
  const context = {};
  vm.runInNewContext("Date.now = function () { return 1700000000000; }; Math.random = function () { return 0.123456789; };", context);
  vm.runInNewContext(fs.readFileSync(path.join(SKILL, "assets", "viewer-lib", file), "utf8"), context);
  assert.deepEqual(Object.keys(context), [name], `${file} declares only ${name}`);
  return context[name];
}
const sfText = lib("text.js", "sfText"), sfComments = lib("comments.js", "sfComments"), sfKdl = lib("kdl.js", "sfKdl"), sfGeom = lib("geometry.js", "sfGeom");

const FLOW = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "release-notes.fixture"), "utf8");
const M = (() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-pure-"));
  try {
    fs.writeFileSync(path.join(tmp, "flow.kdl"), FLOW);
    const {text, doc} = load(path.join(tmp, "flow.kdl"));
    return buildModel(doc, text, "demo", "flow.kdl", [], null);
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
})();

test("text: plain, plural, countIn on the tutorial flow, parseProse on its prose and on hostile text", () => {
  assert.deepEqual([sfText.plain("  a \n\t b  "), sfText.plain(null), sfText.plain(HOSTILE)], ["a b", "", HOSTILE]);
  assert.deepEqual([sfText.plural(1, "step"), sfText.plural(0, "card"), sfText.plural(2, "decision")], ["1 step", "0 cards", "2 decisions"]);
  assert.deepEqual(J([sfText.countIn(M.flow), sfText.countIn(M.flow[1].children)]), [{step: 4, decide: 1, end: 3}, {step: 3, decide: 1, end: 2}]);
  assert.deepEqual(J(sfText.parseProse(M.flow[1].children[0].prose)),
    [{type: "p", text: "Group the changes by type. Leave out internal refactors. Show the draft and revise it until the user approves it or stops."}]);
  assert.deepEqual(J(sfText.parseProse("- one\n  wrapped\n- two\n1. first\n\nA para\nthat wraps `code`\n\n" + HOSTILE)),
    [{type: "ul", items: ["one wrapped", "two"]}, {type: "ol", items: ["first"]}, {type: "p", text: "A para that wraps `code`"}, {type: "p", text: HOSTILE}]);
  assert.deepEqual(J(sfText.parseProse("")), []);
});

test("text: the prose Markdown subset has nested lists, the usual list marks, bold and italic", () => {
  // a deeper indent opens a list inside the item above it; a return to an outer indent goes on with the outer list
  assert.deepEqual(J(sfText.parseProse("Intro line.\n- one\n  - one a\n    wrapped\n  - one b\n    1. deep\n- two\n\n* star\n+ plus\n\n1) first\n2) second")), [
    {type: "p", text: "Intro line."},
    {type: "ul", items: ["one", "two"], subs: {0: {type: "ul", items: ["one a wrapped", "one b"], subs: {1: {type: "ol", items: ["deep"]}}}}},
    {type: "ul", items: ["star", "plus"]}, {type: "ol", items: ["first", "second"]}]);
  // tabs indent too, and a first line with its own indent does not hide the indent of the next lines
  assert.deepEqual(J(sfText.parseProse("\t- a\n\t\t- b\n\t- c")), [{type: "ul", items: ["a", "c"], subs: {0: {type: "ul", items: ["b"]}}}]);
  const kinds = (text) => J(sfText.parseInline(text)).map((part) => `${part.t}:${part.text}`);
  assert.deepEqual(kinds("Run `fmt` **before** each *commit*, _always_."), ["text:Run ", "code:fmt", "text: ", "b:before", "text: each ", "i:commit", "text:, ", "i:always", "text:."]);
  assert.deepEqual(kinds("**Do not** skip (*ever*)."), ["b:Do not", "text: skip (", "i:ever", "text:)."]);
  // a mark that is not around a word is text: globs, arithmetic, snake_case, a lone star, and marks inside code
  for (const text of ["Copy *.md and *.txt files.", "2 * 3 * 4", "use file_name_here and __init__", "a * b", "*", "** not bold **", "`**raw**`"])
    assert.deepEqual(J(sfText.parseInline(text)).filter((part) => part.t === "b" || part.t === "i"), [], text);
  assert.equal(sfText.bare("- Run `fmt` **before** a *commit*"), "Run fmt before a commit");
  assert.deepEqual(kinds(HOSTILE), [`text:${HOSTILE}`]);
});

test("kdl: tokenize keeps every character and classes the tutorial flow, edge syntax and hostile text as before", () => {
  const tokens = sfKdl.tokenize(M.sourceText);
  assert.equal(tokens.map((t) => t.text).join(""), M.sourceText);
  const pair = (list) => J(list).map((t) => [t.text, t.cls]);
  assert.deepEqual(pair(sfKdl.tokenize('step a "x\\"y" // ? not unclear\n  // ? unclear\n/- step b #"raw "q""# k=1 (t)v\n"""\nmulti\n"""\n/* c */ "open')), [
    ["step", "tk-node"], [" ", ""], ["a", "tk-arg"], [" ", ""], ['"x\\"y"', "tk-str"], [" ", ""], ["// ? not unclear", "tk-com"], ["\n", ""],
    ["  ", ""], ["// ? unclear", "tk-ask"], ["\n", ""], ["/-", "tk-sd"], [" ", ""], ["step", "tk-node"], [" ", ""], ["b", "tk-arg"], [" ", ""],
    ['#"raw "q""#', "tk-str"], [" ", ""], ["k", "tk-key"], ["=", "tk-op"], ["1", "tk-val"], [" ", ""], ["(", "tk-op"], ["t", "tk-arg"], [")", "tk-op"],
    ["v", "tk-arg"], ["\n", ""], ['"""\nmulti\n"""', "tk-node"], ["\n", ""], ["/* c */", "tk-com"], [" ", ""], ['"open', "tk-node"]]);
  assert.deepEqual(pair(sfKdl.tokenize('step "' + HOSTILE + '"')), [["step", "tk-node"], [" ", ""], ['"</script><img src=x onerror="', "tk-str"],
    ["window.pwned", "tk-key"], ["=", "tk-op"], ["1", "tk-val"], ['"> & <b>bold</b>"', "tk-str"]]);
});

test("comments: hash, stamp, and readEnvelope on malformed and hostile envelopes", () => {
  assert.deepEqual([sfComments.hash(M.sourceText), sfComments.hash(HOSTILE), sfComments.hash("")], ["aa0002", "14qsx8h", "ztntfp"]);
  assert.deepEqual([sfComments.stamp("2026-11-08T21:31:00+02:00"), sfComments.stamp("garbage"), sfComments.stamp(5), sfComments.stamp("")], ["2026-11-08T19:31:00.000Z", "", "", ""]);
  assert.deepEqual([sfComments.readEnvelope(null), sfComments.readEnvelope("x"), sfComments.readEnvelope(42)], [null, null, null]);
  // version 0.3: a bare list
  assert.deepEqual(J(sfComments.readEnvelope([{words: "bare", anchor: "end:x", id: "ok-1"}])), {v: 2, rev: 0, savedRev: 0, savedAt: 0, updatedAt: 0, ver: 0, from: -1, copy: null, base: null,
    comments: [{words: "bare", anchor: "end:x", id: "ok-1", intents: [], kind: "", name: "", text: "", at: "", created: "", on: "node"}]});
  // a saved file from someone else: huge rev, a save time ahead of the clock, bad ids, records of the wrong shape
  const env = {rev: 2 ** 60, savedRev: 5, savedAt: 1800000000000, updatedAt: -3, from: "x", copy: "<img>", base: "fresh:abc", comments: [
    {id: "c1", on: "node", anchor: "step:draft", words: HOSTILE, intents: ["Unclear", "Unclear", "Bogus", "Wrong"], at: "2026-11-08T10:00:00Z", resolved: "nope", line: 1.5},
    {id: "c1", words: "dup id", intents: [], anchor: "step:x", created: "2026-11-01T00:00:00Z", at: "bad", resolved: "2026-11-09T00:00:00Z", line: 7},
    {id: "__proto__", on: "lines", from: 3, to: 2, quote: "q", words: "from after to"},
    {id: "c3", on: "lines", from: 2, to: 3, quote: "a\nb", words: "", intents: ["Remove"], anchor: 5},
    {id: "c4", on: "lines", from: 2, to: 3, quote: "a\nb", words: "lines", anchor: null, kind: 7},
    {id: "c5", words: "  ", intents: []}, {id: "c6", on: "other", words: "x", anchor: "a"}, null, "str", {words: 3}]};
  assert.deepEqual(J(sfComments.readEnvelope(env)), {v: 2, rev: 1000000000, savedRev: 5, savedAt: 0, updatedAt: 0, ver: 1800000000000, from: -1, copy: null, base: "fresh:abc", comments: [
    {id: "c1", on: "node", anchor: "step:draft", words: HOSTILE, intents: ["Confusing", "Wrong"], at: "2026-11-08T10:00:00.000Z", kind: "", name: "", text: "", created: "2026-11-08T10:00:00.000Z"},
    {id: "cloyw3v284fzzzx", words: "dup id", intents: [], anchor: "step:x", created: "2026-11-01T00:00:00.000Z", at: "", resolved: "2026-11-09T00:00:00.000Z", line: 7, kind: "", name: "", text: "", on: "node"},
    {id: "c4", on: "lines", from: 2, to: 3, quote: "a\nb", words: "lines", anchor: null, kind: "", intents: [], name: "", text: "", at: "", created: ""}]});
  assert.deepEqual(J(sfComments.readEnvelope({comments: "notalist", rev: -1, savedAt: 5, from: 3.7, copy: "fine:id-1"})),
    {v: 2, rev: 0, savedRev: 0, savedAt: 5, updatedAt: 0, ver: 5, from: 3, copy: "fine:id-1", base: null, comments: []});
});

test("geometry: merge, normalize, bounds, rounded on a block with a loop-back left of x=0", () => {
  const block = () => ({w: 100, h: 200, ax: 50, nodes: [{id: "a", x: 0, y: 0, w: 100, h: 40, att: [50, 0]}, {id: "b", x: 10, y: 80, w: 80, h: 40}],
    groups: [{id: "g", x: 0, y: 0, w: 100, h: 200, ax: 50, hw: 60}], edges: [{kind: "implied", arrow: true, to: "a", cond: ["k"], after: null, pts: [[50, 40], [-22, 40], [-22, 100], [10, 100]]}],
    labels: [{el: null, w: 30, h: 16, kind: "implied", x: -10, y: 70}], joins: [[50, 190]], exit: true, ex: 60});
  const merged = sfGeom.blank();
  sfGeom.merge(merged, block(), 5, 7);
  assert.deepEqual(J(merged), {w: 0, h: 0, ax: 0, nodes: [{id: "a", x: 5, y: 7, w: 100, h: 40, att: [55, 7]}, {id: "b", x: 15, y: 87, w: 80, h: 40, att: null}],
    groups: [{id: "g", x: 5, y: 7, w: 100, h: 200, ax: 50, hw: 60}], edges: [{kind: "implied", arrow: true, to: "a", cond: ["k"], after: null, pts: [[55, 47], [-17, 47], [-17, 107], [15, 107]]}],
    labels: [{el: null, w: 30, h: 16, kind: "implied", x: -5, y: 77}], joins: [[55, 197]], exit: true});
  assert.deepEqual(J(sfGeom.normalize(block())), {w: 125, h: 200, ax: 75, nodes: [{id: "a", x: 25, y: 0, w: 100, h: 40, att: [75, 0]}, {id: "b", x: 35, y: 80, w: 80, h: 40, att: null}],
    groups: [{id: "g", x: 25, y: 0, w: 100, h: 200, ax: 50, hw: 60}], edges: [{kind: "implied", arrow: true, to: "a", cond: ["k"], after: null, pts: [[75, 40], [3, 40], [3, 100], [35, 100]]}],
    labels: [{el: null, w: 30, h: 16, kind: "implied", x: 15, y: 70}], joins: [[75, 190]], exit: true, ex: 85});
  const inside = block(); inside.edges = []; inside.labels = [];
  assert.equal(sfGeom.normalize(inside), inside, "a block inside its width comes back as it is");
  assert.deepEqual(J(sfGeom.bounds(block())), [-25, 0, 100, 200]);
  assert.deepEqual([sfGeom.rounded([[0, 0], [0, 40], [30, 40], [30, 40.6], [80, 40.6]]), sfGeom.rounded([[1.25, 2], [3, 4]])],
    ["M0.0 0.0 L0.0 30.0 Q0.0 40.0 10.0 40.0 L30.0 40.0 L30.0 40.6 L80.0 40.6", "M1.3 2.0 L3.0 4.0"]);
});

// [block, index of the end card, index of its incoming edge, att, boxW, columns] and the spot, from the tutorial page's layout in Chrome
const PLACE_END =[[[{"w":473.5,"h":357,"nodes":[{"id":"n2","x":16,"y":60,"w":256,"h":59,"att":null},{"id":"n3","x":221.5,"y":171,"w":236,"h":36,"att":null},{"id":"n4","x":231.5,"y":239,"w":216,"h":70,"att":null}],"edges":[{"kind":"main","arrow":true,"to":"n2","pts":[[144,36],[144,60]]},{"kind":"main","arrow":false,"cond":["n3=ok"],"pts":[[144,119],[144,135],[144,135],[144,171]]},{"kind":"main","arrow":false,"cond":["n3=ok"],"after":"n3=ok","pts":[[144,171],[144,333]]},{"kind":"fail","arrow":true,"cond":["n3=fails"],"pts":[[144,119],[144,135],[339.5,135],[339.5,171]]},{"kind":"main","arrow":true,"to":"n4","cond":["n3=fails"],"pts":[[339.5,207],[339.5,239]]},{"kind":"main","arrow":false,"after":"n1","pts":[[144,333],[144,357]]}],"labels":[{"x":144,"y":153,"w":43,"h":20},{"x":339.5,"y":153,"w":76,"h":20}],"joins":[]},2,4,[339.5,239],473.5,1],{"nx":513.5,"ax":513.5,"y":274}],[[{"w":579.5,"h":875,"nodes":[{"id":"n6","x":102,"y":60,"w":256,"h":117,"att":null},{"id":"n7","x":102,"y":209,"w":256,"h":81,"att":null},{"id":"n9","x":210.75,"y":342,"w":216,"h":70,"att":null},{"id":"n10","x":102,"y":468,"w":256,"h":59,"att":null},{"id":"n11","x":317.5,"y":579,"w":236,"h":36,"att":null},{"id":"n12","x":307.5,"y":647,"w":256,"h":78,"att":null},{"id":"n13","x":327.5,"y":757,"w":216,"h":70,"att":null}],"edges":[{"kind":"main","arrow":true,"to":"n6","pts":[[230,36],[230,60]]},{"kind":"main","arrow":true,"to":"n7","pts":[[230,177],[230,209]]},{"kind":"implied","arrow":false,"cond":["n7=approved"],"pts":[[230,290],[230,306],[141.25,306],[141.25,342]]},{"kind":"implied","arrow":false,"cond":["n7=approved"],"after":"n7=approved","pts":[[141.25,342],[141.25,436]]},{"kind":"branch","arrow":true,"cond":["n7=rejected"],"pts":[[230,290],[230,306],[318.75,306],[318.75,342]]},{"kind":"implied","arrow":true,"cond":["n7=revise"],"pts":[[102,249.5],[80,249.5],[80,84],[102,84]]},{"kind":"main","arrow":true,"to":"n10","pts":[[141.25,436],[141.25,452],[230,452],[230,468]]},{"kind":"main","arrow":false,"cond":["n11=ok"],"pts":[[230,527],[230,543],[230,543],[230,579]]},{"kind":"main","arrow":false,"cond":["n11=ok"],"after":"n11=ok","pts":[[230,579],[230,851]]},{"kind":"fail","arrow":true,"cond":["n11=fails"],"pts":[[230,527],[230,543],[435.5,543],[435.5,579]]},{"kind":"main","arrow":true,"to":"n12","cond":["n11=fails"],"pts":[[435.5,615],[435.5,647]]},{"kind":"main","arrow":true,"to":"n13","cond":["n11=fails"],"pts":[[435.5,725],[435.5,757]]},{"kind":"main","arrow":false,"after":"n5","pts":[[230,851],[230,875]]}],"labels":[{"x":141.25,"y":324,"w":83,"h":20},{"x":318.75,"y":324,"w":83,"h":20},{"x":51,"y":166.75,"w":70,"h":20},{"x":230,"y":561,"w":43,"h":20},{"x":435.5,"y":561,"w":76,"h":20}],"joins":[]},6,11,[435.5,757],579.5,2],{"nx":619.5,"ax":619.5,"y":792}],[[{"w":579.5,"h":875,"nodes":[{"id":"n6","x":102,"y":60,"w":256,"h":117,"att":null},{"id":"n7","x":102,"y":209,"w":256,"h":81,"att":null},{"id":"n9","x":210.75,"y":342,"w":216,"h":70,"att":null},{"id":"n10","x":102,"y":468,"w":256,"h":59,"att":null},{"id":"n11","x":317.5,"y":579,"w":236,"h":36,"att":null},{"id":"n12","x":307.5,"y":647,"w":256,"h":78,"att":null},{"id":"n13","x":619.5,"y":757,"w":216,"h":70,"att":[619.5,792]}],"edges":[{"kind":"main","arrow":true,"to":"n6","pts":[[230,36],[230,60]]},{"kind":"main","arrow":true,"to":"n7","pts":[[230,177],[230,209]]},{"kind":"implied","arrow":false,"cond":["n7=approved"],"pts":[[230,290],[230,306],[141.25,306],[141.25,342]]},{"kind":"implied","arrow":false,"cond":["n7=approved"],"after":"n7=approved","pts":[[141.25,342],[141.25,436]]},{"kind":"branch","arrow":true,"cond":["n7=rejected"],"pts":[[230,290],[230,306],[318.75,306],[318.75,342]]},{"kind":"implied","arrow":true,"cond":["n7=revise"],"pts":[[102,249.5],[80,249.5],[80,84],[102,84]]},{"kind":"main","arrow":true,"to":"n10","pts":[[141.25,436],[141.25,452],[230,452],[230,468]]},{"kind":"main","arrow":false,"cond":["n11=ok"],"pts":[[230,527],[230,543],[230,543],[230,579]]},{"kind":"main","arrow":false,"cond":["n11=ok"],"after":"n11=ok","pts":[[230,579],[230,851]]},{"kind":"fail","arrow":true,"cond":["n11=fails"],"pts":[[230,527],[230,543],[435.5,543],[435.5,579]]},{"kind":"main","arrow":true,"to":"n12","cond":["n11=fails"],"pts":[[435.5,615],[435.5,647]]},{"kind":"main","arrow":false,"to":"n13","cond":["n11=fails"],"pts":[[435.5,725],[435.5,757]]},{"kind":"main","arrow":false,"after":"n5","pts":[[230,851],[230,875]]},{"kind":"main","arrow":true,"to":"n13","cond":["n11=fails"],"pts":[[435.5,757],[435.5,792],[619.5,792]]}],"labels":[{"x":141.25,"y":324,"w":83,"h":20},{"x":318.75,"y":324,"w":83,"h":20},{"x":51,"y":166.75,"w":70,"h":20},{"x":230,"y":561,"w":43,"h":20},{"x":435.5,"y":561,"w":76,"h":20}],"joins":[]},2,4,[318.75,342],579.5,2],{"nx":619.5,"ax":619.5,"y":377}]]
;

test("geometry: placeEnd puts each end of the tutorial flow where the page put it", () => {
  for (const [[out, self, inc, att, boxW, columns], spot] of PLACE_END) assert.deepEqual(J(sfGeom.placeEnd(out, out.nodes[self], out.edges[inc], att, boxW, columns)), spot);
});

test("comments: each tag's meaning and symbol, line numbers from 1, a saved revision no later than the current one", () => {
  assert.deepEqual(J(sfComments.INTENTS), [["Wrong", "the node does not match how the skill works", "fail", "✕"], ["Confusing", "the reviewer cannot tell what the node means", "ask", "?"],
    ["Missing", "something the skill does is missing here", "input", "+"], ["Simplify", "the node is too detailed or too complex", "code", "↘"], ["Remove", "the node should go", "end", "−"]]);
  const env = sfComments.readEnvelope({rev: 3, savedRev: 9, comments: [{id: "a", words: "w", anchor: "step:x", line: 0}, {id: "b", on: "lines", from: 0, to: 1, quote: "q", words: "w"}]});
  assert.deepEqual([env.rev, env.savedRev, J(env.comments).map((c) => [c.id, "line" in c])], [3, 3, [["a", false]]]);
});

test("kdl: a #keyword keeps its keyword class", () => {
  assert.deepEqual(J(sfKdl.tokenize("step a #true #null")).filter((t) => t.cls).map((t) => [t.text, t.cls]), [["step", "tk-node"], ["a", "tk-arg"], ["#true", "tk-kw"], ["#null", "tk-kw"]]);
});

test("geometry: the column gap, and placeEnd when no spot beside the box on the end's own line is clear", () => {
  // an edge on each side crosses the end's line, so step 1 fails; values recorded from the code
  const self = {id: "e", x: 40, y: 100, w: 100, h: 40}, inc = {pts: [[90, 40], [90, 100]]}, sides = [{pts: [[20, 0], [20, 400]]}, {pts: [[200, 0], [200, 400]]}];
  // a join blocks the left side's first lines; an edge at y=300 ends the right side's clear stretch, whose middle wins
  const joined = {w: 300, h: 400, nodes: [self], edges: [inc, ...sides, {pts: [[150, 300], [350, 300]]}], labels: [], joins: [[30, 120]]};
  assert.deepEqual(J(sfGeom.placeEnd(joined, self, inc, [90, 100], 300, 2)), {nx: 340, ax: 340, y: 208});
  // attached at its own line, with an edge below it: only that line is open
  const attached = {w: 300, h: 400, nodes: [self], edges: [inc, ...sides, {pts: [[90, 120], [90, 400]]}], labels: [], joins: []};
  assert.deepEqual(J(sfGeom.placeEnd(attached, self, inc, [90, 120], 300, 2)), {nx: -140, ax: -40, y: 120});
});
