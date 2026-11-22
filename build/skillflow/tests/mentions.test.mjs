// findMention: where prose names a data item as a word. The page marks such cards `mentions` and quotes the place.
import assert from "node:assert/strict";
import {test} from "node:test";
import {skillUrl} from "./skill-path.mjs";
const {findMention} = await import(skillUrl("scripts/render.mjs"));

const word = (text, name) => findMention(text, name)?.word ?? null;

test("a whole word, in any case, with an s or es plural, matches", () => {
  assert.equal(word("Restate the feature goal.", "feature"), "feature");
  assert.equal(word("Feature first.", "feature"), "Feature");
  assert.equal(word("List the features.", "feature"), "features");
  assert.equal(word("Two matches.", "match"), "matches");
  assert.equal(word("the feature's goal", "feature"), "feature");
  assert.equal(word("(feature)", "feature"), "feature");
  assert.equal(word("`feature`", "feature"), "feature");
});

test("a hyphen in the name also matches a space or a line break", () => {
  assert.equal(word("Ask for the skeleton state.", "skeleton-state"), "skeleton state");
  assert.equal(word("the skeleton-state value", "skeleton-state"), "skeleton-state");
  assert.equal(word("the skeleton\n  state", "skeleton-state"), "skeleton\n  state");
});

test("part of another word, a name, a path or a file name is not a mention", () => {
  for (const text of ["featured", "subfeature", "feature-flag", "my_feature", "references/feature", "feature.md", "feature/x", "a.feature", "@feature", "#feature"])
    assert.equal(word(text, "feature"), null, text);
  assert.equal(word("the skillflow page", "flow"), null);
  assert.equal(word("check flow.kdl", "flow"), null);
});

test("a sentence end or a comma after the word is still a mention", () => {
  assert.equal(word("Read the flow.", "flow"), "flow");
  assert.equal(word("the flow, then", "flow"), "flow");
  assert.equal(word("the flow: done", "flow"), "flow");
});

test("a name with regex characters or other scripts matches as written", () => {
  assert.equal(word("see a+b now", "a+b"), "a+b");
  assert.equal(word("see axb now", "a.b"), null);
  assert.equal(word("Прочитай отчёт сейчас.", "отчёт"), "отчёт");
  assert.equal(word("Прочитай отчёты.", "отчёт"), null);  // plurals are English only
});

test("the quote is one line around the first match, cut at words, with … where it is cut", () => {
  const m = findMention("First line.\n- Then restate the feature goal in one sentence and say that only contract code is written now.", "feature");
  assert.equal(m.word, "feature");
  assert.ok(!/\n/.test(m.before + m.after));
  assert.ok(m.before.length <= 40 && m.after.length <= 50, JSON.stringify(m));
  assert.match(m.after, /…$/);
  assert.deepEqual(findMention("feature", "feature"), {before: "", word: "feature", after: ""});
  assert.equal(findMention("", "feature"), null);
});

test("review cases: a slash after the name, a combining accent, and two fields never join", async () => {
  assert.equal(word("Open feature/.env", "feature"), null);
  assert.equal(word("Go to feature/", "feature"), null);
  assert.equal(word("Caféteria", "cafe"), null);
  assert.equal(word("Café now", "cafe"), null);  // é written as e and an accent is a different word
  const {buildModel} = await import(skillUrl("scripts/render.mjs"));
  const {parseFlow} = await import(skillUrl("scripts/validate.mjs"));
  const text = 'skillflow 1.0\ncontext "x" {\n\tinput release-plan "p"\n}\ndecide d "Plan now?" "Prepare a release" by=llm {\n\twhen yes {\n\t\tend "done"\n\t}\n}\n';
  assert.deepEqual(buildModel(parseFlow(text), text, "t", "f", []).data["release-plan"].mentionOf, []);
});
