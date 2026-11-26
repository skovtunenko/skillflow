// The editor page's pure modules (assets/editor/): the stand-ins for node:fs and node:path, the text-against-file rules,
// the layout, the problem list, the graph changes, and what fits at the cursor. They have no DOM, so they run in Node as they are.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import vm from "node:vm";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {candidates, closesBlock, context, expand, newLine, openQuote, rank, toolNames} = await import(skillUrl("assets/editor/complete.mjs"));
const diff = await import(skillUrl("assets/editor/graph-diff.mjs"));
const {escapeHtml, htmlLines} = await import(skillUrl("assets/editor/highlight.mjs"));
const {atLast, goTo, LIMIT, noEdits, PAUSE, record} = await import(skillUrl("assets/editor/history.mjs"));
const {clampRatio, prefsPair, readPrefs} = await import(skillUrl("assets/editor/layout.mjs"));
const {memoryFs} = await import(skillUrl("assets/editor/memory-fs.mjs"));
const shim = await import(skillUrl("assets/editor/node-path.mjs"));
const {byLine, problemAt, problemList, stepProblem} = await import(skillUrl("assets/editor/problems.mjs"));
const {changedLines, differingLines, isDirty, opened, outside, toDisk, toEditor} = await import(skillUrl("assets/editor/sync.mjs"));

test("the path stand-in gives what node:path gives for POSIX paths", () => {
  const p = path.posix;
  for (const parts of [["/a/b", "..", "c"], ["/a", "./b/", "c.md"], ["a", "..", "..", "b"], ["/", ".."], ["", "a"], ["/a//b/"]])
    assert.equal(shim.join(...parts), p.join(...parts).replace(/(.)\/$/, "$1"), `join ${JSON.stringify(parts)}`);
  for (const parts of [["/skill/x", "SKILL.md"], ["/skill/x", "../y"], ["/a", "/b", "c"], ["a/b"]])
    assert.equal(shim.resolve(...parts), p.resolve("/", ...parts), `resolve ${JSON.stringify(parts)}`);
  for (const one of ["/a/b/c.md", "/a", "/", "a/b", "a", "/a/b/"]) assert.equal(shim.dirname(one), p.dirname(one), `dirname ${one}`);
  assert.deepEqual([shim.isAbsolute("/a"), shim.isAbsolute("a"), shim.sep], [true, false, "/"]);
});

test("the stand-ins export every name that the page's modules import from node:fs and node:path", () => {
  const have = {fs: Object.keys(memoryFs({})), path: Object.keys(shim)};
  for (const file of ["validate.mjs", "render.mjs", "fmt.mjs"]) {
    const source = fs.readFileSync(path.join(SKILL, "scripts", file), "utf8");
    for (const [, names, module] of source.matchAll(/^import \{([^}]+)\} from "node:(\w+)";/gm)) {
      assert.ok(have[module], `${file} imports node:${module}, which the editor page does not have`);
      for (const name of names.split(",").map((part) => part.trim())) assert.ok(have[module].includes(name), `${file} imports ${name} from node:${module}: add it to assets/editor/`);
    }
    assert.doesNotMatch(source, /\bprocess\.|\bBuffer\b/, `${file} uses a Node global, which a browser does not have`);
  }
});

test("the file stand-in reads, lists, and fails as node:fs does", () => {
  const disk = memoryFs({"/skill/x/SKILL.md": "# x\n", "/skill/x/scripts/a.sh": "é", "/flow/flow.kdl": "skillflow 1.0\n"});
  assert.equal(disk.readFileSync("/skill/x/../x/SKILL.md", "utf8"), "# x\n");
  assert.deepEqual([...disk.readFileSync("/skill/x/scripts/a.sh")], [0xc3, 0xa9], "bytes without an encoding");
  assert.deepEqual(disk.readdirSync("/skill/x"), ["SKILL.md", "scripts"]);
  assert.deepEqual(disk.readdirSync("/skill/x", {withFileTypes: true}).map((entry) => [entry.name, entry.isFile(), entry.isDirectory(), entry.isSymbolicLink()]),
    [["SKILL.md", true, false, false], ["scripts", false, true, false]]);
  assert.deepEqual([disk.statSync("/skill/x/scripts/a.sh").size, disk.statSync("/skill").isDirectory(), disk.lstatSync("/").isDirectory()], [2, true, true]);
  assert.equal(disk.realpathSync("/skill/./x"), "/skill/x");
  const code = (run) => { try { run(); } catch (error) { return error.code; } return null; };
  assert.deepEqual([code(() => disk.statSync("/none")), code(() => disk.readFileSync("/skill")), code(() => disk.readFileSync("/skill/none")),
    code(() => disk.readdirSync("/flow/flow.kdl")), code(() => disk.readdirSync("/none")), code(() => disk.realpathSync("/skill/none"))],
    ["ENOENT", "EISDIR", "ENOENT", "ENOTDIR", "ENOENT", "ENOENT"]);
  // a folder whose name starts with another folder's name is not inside it
  assert.equal(code(() => disk.statSync("/ski")), "ENOENT");
  disk.writeFileSync("/flow/flow.kdl", "new");
  disk.replaceFolder("/skill/x", {"/skill/x/SKILL.md": "# y\n"});
  assert.deepEqual([disk.readFileSync("/flow/flow.kdl", "utf8"), disk.readdirSync("/skill/x"), disk.readFileSync("/skill/x/SKILL.md", "utf8")], ["new", ["SKILL.md"], "# y\n"]);
});

test("line endings: the editor holds \\n, the file keeps its own", () => {
  const sync = opened("a\r\nb\r\n");
  assert.deepEqual([sync.ending, toEditor("a\r\nb\r\n"), toDisk("a\nb\n", sync.ending), opened("a\nb").ending, toDisk("a\nb", "\n")], ["\r\n", "a\nb\n", "a\r\nb\r\n", "\n", "a\nb"]);
  assert.equal(isDirty(sync, "a\nb\n"), false, "the same text with the editor's line ends is not an edit");
  assert.equal(isDirty(sync, "a\nB\n"), true);
});

test("a change from outside: loaded without edits, a conflict with edits, nothing when the file holds the editor's text", () => {
  const sync = opened("one\n");
  assert.deepEqual(outside(sync, "one\n", "two\n"), {sync: opened("two\n"), action: "load"});
  assert.deepEqual(outside(sync, "mine\n", "two\n"), {sync, action: "conflict"}, "the base stays, so the server refuses the next save");
  assert.deepEqual(outside(sync, "mine\n", "mine\n"), {sync: opened("mine\n"), action: "none"}, "this page's own save, seen through the watcher");
  assert.deepEqual(outside(sync, "mine\n", "one\n"), {sync, action: "none"});
  assert.deepEqual(outside(sync, "mine\n", null), {sync: {base: null, ending: "\n"}, action: "removed"});
  assert.deepEqual(outside({base: null, ending: "\n"}, "mine\n", null).action, "none");
  assert.equal(isDirty({base: null, ending: "\n"}, ""), true, "a removed file is always unsaved");
});

test("changedLines marks the lines that only one version has", () => {
  const sets = (left, right) => changedLines(left, right).map((lines) => [...lines]);
  assert.deepEqual(sets("a\nb\nc", "a\nb\nc"), [[], []]);
  assert.deepEqual(sets("a\nb\nc", "a\nX\nc"), [[2], [2]]);
  assert.deepEqual(sets("a\nc", "a\nb\nc\nd"), [[], [2, 4]]);
  assert.deepEqual(sets("a\nb\nc\nd", "c\nd"), [[1, 2], []]);
  assert.deepEqual(sets("", "a"), [[1], [1]]);
});

test("differingLines gives the whole lines that differ, and the rest rebuilds the new text", () => {
  const span = (before, after) => {
    const {start, end} = differingLines(before, after);
    // the kept parts are whole lines of both texts, and they put the new text together again
    assert.equal(before.slice(0, start) + after.slice(start, after.length - end) + before.slice(before.length - end), after);
    assert.ok(start + end <= Math.min(before.length, after.length));
    return [start, end];
  };
  assert.deepEqual(span("a\nbb\nc\n", "a\nbX\nc\n"), [2, 2]);
  assert.deepEqual(span("a\nb", "a\nb\nc"), [2, 0]);
  assert.deepEqual(span("a\nb\nc", "c"), [0, 1]);
  assert.deepEqual(span("x\nx\nx\n", "x\nx\n"), [4, 0], "a repeated line: the kept parts do not overlap");
  assert.deepEqual(span("", "a\n"), [0, 0]);
  assert.deepEqual(span("ab", "ab\n"), [0, 0]);
  assert.deepEqual(span("😀a\nz", "😀b\nz"), [0, 1], "a line is never cut inside");
});

test("the layout choices survive their own cookie; with none, the page starts as an editor", () => {
  const start = {view: "source", split: "cols", ratio: 55, srcMode: "edit", panelShut: true, dir: "cols"};
  assert.deepEqual(readPrefs(""), start);
  assert.deepEqual(readPrefs(null, true), {...start, split: ""}, "a narrow window starts with the text alone");
  const prefs = {view: "graph", split: "rows", ratio: 61, srcMode: "read", panelShut: false, dir: "rows"};
  assert.equal(prefsPair(prefs), "skillflow-editor=graph.rows.61.read.open.rows");
  assert.deepEqual(readPrefs(`other=1; ${prefsPair(prefs)}; more=2`), prefs);
  assert.deepEqual(readPrefs(prefsPair({...prefs, split: ""})), {...prefs, split: ""}, "one view at a time; the way the split was turned is kept");
  assert.deepEqual(readPrefs("skillflow-editor=graph.one.61.read.open"), {...prefs, split: "", dir: "cols"}, "a pair of the version before has no turn");
  // a pair of the first editor, or a pair with a part this version does not know, counts as nothing saved
  for (const old of ["skillflow-editor=%7B%22mode%22%3A%22both%22%7D", "skillflow-editor=help.cols.55.edit.shut", "skillflow-editor=graph.wide.55.edit.shut", "skillflow-editor=graph.cols.55.write.shut"]) assert.deepEqual(readPrefs(old), start, old);
  assert.deepEqual(readPrefs("skillflow-editor=source.cols.999.edit.x"), {...start, ratio: 80});
  assert.deepEqual([clampRatio(5), clampRatio(95), clampRatio(33.4), clampRatio("x")], [20, 80, 33, 55]);
});

test("the problem list is in line order, and each line shows its worst kind", () => {
  const report = {errors: [[12, "bad", "fix it"], [null, "no line", ""]], todos: [["12", "later", ""], [3, "todo", ""]], warnings: [[3, "hm", ""], ["7:2", "col", ""]]};
  const problems = problemList(report);
  assert.deepEqual(problems.map(({kind, line, at}) => [kind, line, at]), [["error", 0, ""], ["todo", 3, "3"], ["warning", 3, "3"], ["warning", 7, "7:2"], ["error", 12, "12"], ["todo", 12, "12"]]);
  assert.equal(problems.find(({line}) => line === 12).hint, "fix it");
  const lines = byLine(problems);
  assert.deepEqual([...lines].map(([line, {kind, items}]) => [line, kind, items.length]), [[0, "error", 1], [3, "todo", 2], [7, "warning", 1], [12, "error", 2]]);
});

test("stepProblem goes to the next or the previous problem from the cursor, in a ring, and takes each problem of one line in turn", () => {
  const problems = [3, 7, 7, 12].map((line) => ({line}));
  // no problem is shown: the first after the cursor's line, the last before it
  assert.deepEqual([1, 3, 5, 7, 12, 40].map((line) => stepProblem(problems, -1, line, 1)), [0, 1, 1, 3, 0, 0]);
  assert.deepEqual([1, 3, 5, 7, 12, 40].map((line) => stepProblem(problems, -1, line, -1)), [3, 3, 0, 0, 2, 3]);
  // the shown problem is at the cursor: its neighbour, the second problem of line 7 included
  assert.deepEqual([stepProblem(problems, 1, 7, 1), stepProblem(problems, 2, 7, 1), stepProblem(problems, 3, 12, 1), stepProblem(problems, 0, 3, -1), stepProblem(problems, 2, 7, -1)], [2, 3, 0, 3, 1]);
  // the cursor left the shown problem: the step is from the cursor
  assert.equal(stepProblem(problems, 3, 1, 1), 0);
  // a problem with no line is a row of the list: the step from it is to its neighbour
  const noLine = [{line: 0}, {line: 0}, {line: 5}];
  assert.deepEqual([stepProblem(noLine, 0, 9, 1), stepProblem(noLine, 1, 9, 1), stepProblem(noLine, -1, 5, -1), stepProblem(noLine, 1, 5, -1)], [1, 2, 1, 0]);
  assert.deepEqual([stepProblem([], -1, 1, 1), stepProblem([], -1, 1, -1)], [-1, -1]);
});

test("problemAt names the problem of the cursor's line and keeps the shown one of that line", () => {
  const problems = [3, 7, 7, 12].map((line) => ({line}));
  assert.deepEqual([problemAt(problems, -1, 7), problemAt(problems, 2, 7), problemAt(problems, 0, 7), problemAt(problems, 2, 8), problemAt([], -1, 1)], [1, 2, 1, -1, -1]);
});

test("htmlLines gives one escaped line of spans for each text line", () => {
  const tokenize = (text) => text.split(/(\n|<b>)/).filter(Boolean).map((part) => ({text: part, cls: part === "<b>" ? "tk-node" : ""}));
  assert.deepEqual(htmlLines('a <b> "q"\n\n&', tokenize), ['a <span class="tk-node">&lt;b&gt;</span> &quot;q&quot;', "", "&amp;"]);
  assert.deepEqual(htmlLines("", tokenize), [""]);
  // a token that holds a line break, such as a multi-line string, continues on the next line with its class
  assert.deepEqual(htmlLines("x\ny", () => [{text: "x\ny", cls: "tk-str"}]), ['<span class="tk-str">x</span>', '<span class="tk-str">y</span>']);
  assert.equal(escapeHtml(`<&">`), "&lt;&amp;&quot;&gt;");
});

test("graph changes: new and changed cards by a key that survives a redraw", () => {
  const model = (flow) => ({flow});
  const before = model([{id: "n1", kind: "step", name: "read", prose: "Read.", line: 3, children: []},
    {id: "n2", kind: "decide", name: "ok", line: 5, whens: [{outcome: "no", children: [{id: "n3", kind: "end", text: "stop", line: 7}]}], catch: {id: "n4", kind: "catch", children: []}}]);
  const after = model([{id: "m1", kind: "step", name: "added", prose: "New.", line: 2, children: []},
    {id: "m2", kind: "step", name: "read", prose: "Read it all.", line: 6, children: []},
    {id: "m3", kind: "decide", name: "ok", line: 9, whens: [{outcome: "no", children: [{id: "m4", kind: "end", text: "stop", line: 11}]}], catch: {id: "m5", kind: "catch", children: []}}]);
  assert.deepEqual(diff.changes(before, after), {added: ["m1"], changed: ["m2"]}, "a card that only moved to another line is not changed");
  assert.deepEqual(diff.changes(before, before), {added: [], changed: []});
});

// ---------- what fits at the cursor (complete.mjs), with the page's own tokenizer and the validator's own tables ----------
const {CHILDREN, EXECUTORS, PROPS} = await import(skillUrl("scripts/validate.mjs"));
const kdl = {};
vm.runInNewContext(fs.readFileSync(path.join(SKILL, "assets", "viewer-lib", "kdl.js"), "utf8"), kdl);
const tokenize = (text) => kdl.sfKdl.tokenize(text);
const GRAMMAR = {children: CHILDREN, props: PROPS, by: EXECUTORS, files: ["scripts/collect.mjs", "scripts/report.mjs"]};
const SAMPLE = `skillflow 1.0

context {
	input request "what the user asks for"
	output report "the review report"
	invariant by=llm "no file changes without consent"
}

step collect by=code file="scripts/collect.mjs" "Collect the changed files." {
	tools git rg
	output files "the changed files"
	catch "Report the error; the run ends."
}

decide risky "Does the change touch a public API?" by=llm {
	when yes {
		gate approve "Does the user accept the risk?" {
			tools (agent)ask-user
		}
	}
	when no {
		step review by=llm "Review the files and write the report."
	}
}

end "the report is ready"
`;
/** The place and the ranked labels after `typed` goes in right after `after` in the sample. */
function at(after, typed) {
  const pos = SAMPLE.indexOf(after) + after.length, text = SAMPLE.slice(0, pos) + typed + SAMPLE.slice(pos), place = context(text, pos + typed.length, tokenize);
  return {place, labels: rank(candidates(place, text, GRAMMAR, tokenize), place.word).map((item) => item.label)};
}

test("the place of the cursor selects what fits: a node of the parent, a property, a value, a name of the text", () => {
  const cases = [
    ["a node inside context", '"the review report"', "\n\tin", "node", "input"],
    ["a property of step", "when no {", "\n\t\tstep lint b", "prop", "by="],
    ["a value of by=", "when no {", "\n\t\tstep lint by=", "value", "llm"],
    ["a path for file=", "when no {", "\n\t\tstep lint by=code file=", "value", '"scripts/collect.mjs"'],
    ["a tool name from another tools line", "tools git rg", " ", "name", "ask-user"],
    ["a template node at the top level", 'the run ends."\n}', "\n\nde", "node", "decide"],
    ["nothing inside a string", '"Review the files', " st", "prose", undefined],
    ["every node of the parent on an empty line", "when no {", "\n\t\t", "node", "phase"],
  ];
  for (const [name, after, typed, kind, top] of cases) {
    const got = at(after, typed);
    assert.deepEqual([got.place.kind, got.labels[0]], [kind, top], name);
  }
  assert.equal(at('end "the report is ready"\n', "// st").place.kind, "comment", "nothing inside a comment");
  // the parent comes from the braces before the cursor, and a property that the node has is not offered again
  const inner = at("when no {", "\n\t\tstep lint by=llm ");
  assert.deepEqual([inner.place.path, inner.place.parent, inner.labels], [["decide", "when"], "when", ["skill=", "ref="]]);
  assert.deepEqual(at("when no {", "\n\t\tstep lint by=code ").labels, ["file=", "skill=", "ref="], "file= only after by=code");
  assert.deepEqual(at("gate approve", " {\n\t\t\t\twhen ").labels, ["rejected", "approved", "revise"], "gate suggests rejected first, then overrides of implied outcomes");
  assert.deepEqual(toolNames(SAMPLE, tokenize), ["git", "rg", "ask-user"], "a tool's kind is not a name");
  // every node and property of the validator's tables has a template, so a new one cannot come without its suggestion
  for (const parent of Object.keys(CHILDREN)) for (const item of candidates({kind: "node", parent}, "", GRAMMAR, tokenize)) assert.ok(item.hint && item.insert.startsWith(item.label), `node ${item.label}`);
  for (const node of Object.keys(PROPS)) for (const item of candidates({kind: "prop", node, keys: []}, "", GRAMMAR, tokenize)) assert.ok(item.hint && item.insert.startsWith(item.label), `property ${item.label} of ${node}`);
});

test("rank puts a start match first and keeps letters in order; expand gives a template its indent and its fields", () => {
  const items = ["output", "skillflow", "tools", "input"].map((label) => ({label}));
  assert.deepEqual(rank(items, "o").map((item) => item.label), ["output", "skillflow", "tools"]);
  assert.deepEqual(rank(items, "ot").map((item) => item.label), ["output"], "o then t, in this order");
  assert.deepEqual(rank(items, "").length, 4);
  assert.deepEqual(expand("a ${b}\nc", "\t"), {text: "a b\n\tc", stops: [[2, 3]]});
  assert.deepEqual(expand("when ${yes} {\n\t${}\n}", "\t\t"), {text: "when yes {\n\t\t\t\n\t\t}", stops: [[5, 8], [14, 14]]});
});

test("Enter keeps the indent of its line and adds a level after a brace; a closing brace on a line of its own takes one back", () => {
  assert.deepEqual([newLine("\t\tstep a by=llm"), newLine("\twhen yes {"), newLine("phase p {  "), newLine(""), newLine("    step a")], ["\n\t\t", "\n\t\t", "\n\t", "\n", "\n    "]);
  // Enter in a one-line string closes it first: the quote that closes it, none for a closed, a multi-line, or a commented string
  assert.deepEqual(["step a \"do it", "step a file=\"x", "step a #\"raw", "step a \"done\"", "step a \"\"\"", "step a // \"no", "step a \"broken\n", "step a \"say \\\"", "step a \"dir\\\\\""].map((before) => openQuote(before, tokenize)),
    ["\"", "\"", "\"#", "", "", "", "", "\"", ""]);
  assert.deepEqual([closesBlock("when yes {\n\t\t"), closesBlock("\t"), closesBlock("step a\t"), closesBlock("when yes {\n"), closesBlock("\t  ")], [true, true, false, false, false]);
});

test("history: a run of typing is one edit; a new text at an earlier edit replaces the later ones; Undo of the browser replaces none", () => {
  const texts = ({edits}) => edits.map((edit) => edit.text);
  // the page starts: the opened text is an edit that typing never joins
  let {history} = record(noEdits(), "A", true, 0);
  assert.deepEqual([texts(history), history.at, history.edits[0].open], [["A"], 0, false]);
  // keys with short pauses are one edit; a pause of PAUSE ends the run
  for (const [text, time] of [["Ab", 100], ["Abc", 300], ["Abcd", 300 + PAUSE - 1]]) ({history} = record(history, text, true, time, "typed"));
  assert.deepEqual([texts(history), history.at], [["A", "Abcd"], 1]);
  ({history} = record(history, "Abcde", false, 300 + 2 * PAUSE, "typed"));
  assert.deepEqual([texts(history), history.edits.map((edit) => edit.ok)], [["A", "Abcd", "Abcde"], [true, true, false]]);
  // the same text again changes only its mark
  assert.deepEqual(record(history, "Abcde", true, 9000, "typed").history.edits[2], {...history.edits[2], ok: true});
  // Format is an edit of its own, also right after a key
  ({history} = record(history, "Abcde\n", true, 300 + 2 * PAUSE + 1));
  assert.deepEqual([texts(history).length, history.edits.at(-1).open], [4, false]);
  // a step back, then a key: the later edits go, and the count says how many
  const back = goTo(history, 1);
  assert.deepEqual([back.at, back.edits.some((edit) => edit.open), goTo(history, 9), goTo(history, -1)], [1, false, null, null]);
  const typed = record(back, "Abcd!", true, 20000, "typed");
  assert.deepEqual([texts(typed.history), typed.history.at, typed.replaced], [["A", "Abcd", "Abcd!"], 2, 2]);
  // a key after a step never joins the edit shown, however soon it comes
  assert.equal(record(goTo(typed.history, 2), "Abcd!?", true, 20001, "typed").history.edits.length, 4);
  // the browser's Undo after a step gives a text that an edit holds: that edit is shown, and none is replaced
  const undone = record(back, "Abcde\n", true, 20000, "undo");
  assert.deepEqual([texts(undone.history), undone.history.at, undone.replaced], [texts(history), 3, 0]);
  // an Undo to a text that no edit holds is as a key
  assert.deepEqual(record(back, "Abc", true, 20000, "undo").replaced, 2);
  // a text from the disk goes after the last edit
  assert.deepEqual(record(atLast(back), "disk", true, 30000).replaced, 0);
  // the oldest edits go first at the limit, and the edit shown stays the last one
  let long = noEdits();
  for (let index = 0; index < LIMIT + 5; index++) long = record(long, `t${index}`, true, index * 2 * PAUSE).history;
  assert.deepEqual([long.edits.length, long.edits[0].text, long.at], [LIMIT, "t5", LIMIT - 1]);
  // record changes no history that it gets
  assert.deepEqual([texts(back), back.at], [["A", "Abcd", "Abcde", "Abcde\n"], 1]);
});
