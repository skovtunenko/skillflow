// The editor of an edit page. The page is the viewer's page; the editor is its host: it sits in the Source view in Edit mode,
// checks the text while the person types with SkillFlow's own validator, gives the viewer each valid text to draw,
// and keeps the text in step with the flow file.
import * as fs from "node:fs";
import {InvalidKdlError} from "../../scripts/_vendor/bgotink-kdl/index.js";
import {FormatError, formatFlow} from "../../scripts/fmt.mjs";
import {helpFlows, page, pageModel} from "../../scripts/render.mjs";
import {check, CHILDREN, draftGaps, EXECUTORS, parseFlow, plural, PROPS, SKILL_HINT, status} from "../../scripts/validate.mjs";
import {boot} from "./boot.mjs";
import {codePane} from "./code-pane.mjs";
import {changes} from "./graph-diff.mjs";
import {escapeHtml, htmlLines} from "./highlight.mjs";
import {atLast, goTo, noEdits, record} from "./history.mjs";
import {prefsPair, readPrefs} from "./layout.mjs";
import {byLine, problemAt, problemList, stepProblem} from "./problems.mjs";
import {canLink, download, linkFile, serverStore} from "./store.mjs";
import {changedLines, isDirty, opened, outside, toDisk, toEditor} from "./sync.mjs";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const clock = (date) => date.toLocaleTimeString();

// The editor's elements never move in the page: a move of the text field ends the browser's Undo history, and each new text draws the viewer again.
// They are in one box of the body. The box lies over the place that the viewer gives (the Source view in Edit mode) and follows its size;
// with no place, or a place that is not shown, the box is not shown.
const park = Object.assign(document.createElement("div"), {id: "sf-park"});
park.append($("sf-editor-ui").content.cloneNode(true));
document.body.append(park);
document.body.append($("conflict"));
const editor = $("sfe");
// false in Read mode and while the Source view is not shown; the box takes its place first, so the answer is the one of this moment
const inView = () => { fit(); return editor.checkVisibility({visibilityProperty: true}); };

// sync: the text against the file; store: where Save writes (null: nowhere yet); good: the model of the last valid text; ui: what the viewer gives its host;
// problems: the list of the last check; active: the index of the problem now shown, -1 for none;
// history: the edits of this visit (history.mjs); how: where the text that waits for its check is from, "typed" or "undo";
// stopped: the server does not answer; saving: a save is on its way; saveError: why the last save failed, until the next one
const state = {sync: opened(boot.files[boot.flow]), store: boot.server ? serverStore : null, stopped: false, changedOutside: false, conflict: null, savedAt: null, saving: false, saveError: null,
  problems: [], active: -1, good: null, ui: null, note: null, timer: null, how: "typed", history: noEdits(), scrubbing: false, renders: 0};

// the page that the server sent holds the model of an empty flow: the viewer draws it until the text is valid
const empty = JSON.parse($("flow-model").textContent);
const example = helpFlows(); // the flows that the Help view draws

const stored = () => { try { return localStorage.getItem("skillflow-editor"); } catch { return null; } };
let slot = null;
/** Put the editor's box over its place. */
function fit() {
  const box = slot?.isConnected ? slot.getBoundingClientRect() : {width: 0};
  park.classList.toggle("on", box.width > 0);
  if (box.width) Object.assign(park.style, {left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`});
}
const fitted = new ResizeObserver(fit);
window.addEventListener("resize", fit);
/** The viewer's place for the editor; null: none. A viewer that draws a new text takes its place away and the next one gives its own at once. */
function mount(place) {
  fitted.disconnect();
  slot = place;
  if (!place) return queueMicrotask(() => { if (!slot) fit(); }); // the box stays in view between two viewers: the text field keeps its focus
  place.setAttribute("aria-owns", editor.id); // for a screen reader the editor is inside the Source view
  fitted.observe(place);
  fit();
}

// what the viewer asks of the editor (assets/viewer/: model.js, source.js, navigation.js, save.js)
const host = {
  start: readPrefs(document.cookie || stored(), matchMedia("(max-width: 760px)").matches),
  toolbar: $("sfe-bar"),
  mount,
  park: () => mount(null),
  booted(ui) { state.ui = ui; },
  onCard: (line) => code.jumpTo(line, false),
  topLine: (line) => code.topLine(line),
  /** The Source view in Read mode gives a place for a note: showNote fills it. */
  readNote(place) { state.note = place; showNote(); },
  /** The page of the last valid text, as `render` writes it: Export review page saves this one, without the editor. */
  page: () => page(state.good?.model ?? {...empty, edit: undefined, copy: undefined}),
  /** The errors in the editor's text: while there are any, the page above is of an older text. */
  errors: () => errorCount(),
  remember(prefs) {
    if (prefs.view === "help") return;
    // a cookie belongs to the host, not the port, so the next editor server finds it; an offline page has only localStorage
    document.cookie = `${prefsPair(prefs)}; max-age=31536000; path=/; samesite=strict`;
    try { localStorage.setItem("skillflow-editor", prefsPair(prefs)); } catch { /* storage is off: the choices last for this page */ }
  },
};
// the first viewer: it gives the editor its highlighter and its toast before the first check
window.skillflow.boot(structuredClone(empty), host);
const toast = (text, bad = false, action) => state.ui.toast(text, bad, action);

// one choice of this viewer, kept in this browser: `fallback` until the person changes it
const kept = (key, fallback) => { try { return (localStorage.getItem(key) ?? fallback) === "on"; } catch { return fallback === "on"; } };
const keep = (key, on) => { try { localStorage.setItem(key, on ? "on" : "off"); } catch { /* storage is off: the choice lasts for this page */ } };
// what the list of suggestions reads: the validator's own tables, and the files of the skill for `file=`, scripts first
const grammar = {children: CHILDREN, props: PROPS, by: EXECUTORS, files: []};
function listFiles(paths) {
  const own = paths.filter((file) => boot.skill && file.startsWith(boot.skill + "/") && file !== boot.flow).map((file) => file.slice(boot.skill.length + 1));
  grammar.files = own.sort((a, b) => b.startsWith("scripts/") - a.startsWith("scripts/") || a.localeCompare(b));
}
listFiles(Object.keys(boot.files));

const code = codePane(state.ui.tokenize, {
  grammar, auto: () => $("auto").checked,
  onInput(event) {
    showSync();
    state.how = /^history/.test(event.inputType ?? "") ? "undo" : "typed"; // the browser's Undo and Redo say so
    clearTimeout(state.timer);
    state.timer = setTimeout(() => run(state.how), 150);
  },
  onLine(line) { state.ui.ring(line); showProblem(problemAt(state.problems, state.active, line)); },
});

// ---------- check and redraw ----------
const EDITOR_SKILL_HINT = "this editor has no skill folder: save, then start it for the folder with SKILL.md (skillflowctl edit <skill-dir>), or write skill=\"<path>\" on the first line and start it again";
/** `how`: where the text is from, as history.mjs `record` reads it. */
function run(how = "set") {
  clearTimeout(state.timer);
  state.timer = null;
  const text = code.area.value, started = performance.now();
  let report, model = null, checked = started;
  try {
    fs.writeFileSync(boot.flow, text); // the validator reads the flow from the page's file system
    let result = check(boot.flow, boot.skill, false);
    // a text that only lacks parts is a draft: its graph draws, and each missing part is a to-do in the list, not an error
    if (result.report.errors.length && result.report.gaps === result.report.errors.length) result = check(boot.flow, boot.skill, true);
    report = result.report;
    checked = performance.now();
    if (!report.errors.length) model = pageModel(parseFlow(text), text, boot.title, boot.name, example, result.anchors, draftGaps(report));
  } catch (error) {
    console.warn("skillflow editor:", error);
    report = {errors: [[null, `the check stopped: ${error.message}`, "this is a defect in SkillFlow, not in the flow; the last valid graph stays"]], todos: [], warnings: [], draft: false};
  }
  const problems = problemList(report), ok = !report.errors.length;
  // the page takes no command-line flag and reads no other folder: the way to the skill's files is a new editor
  for (const problem of problems) if (problem.hint === SKILL_HINT) problem.hint = EDITOR_SKILL_HINT;
  state.problems = problems;
  code.mark(byLine(problems));
  $("problems").innerHTML = problems.length ? problems.map(({kind, at, message, hint}, index) =>
    `<li class="p-${kind}"><button type="button" data-index="${index}"><b>${kind}</b> <code>${at ? "L" + escapeHtml(at) : "–"}</code> ${escapeHtml(message)}${hint ? ` <span class="hint">${escapeHtml(hint)}</span>` : ""}</button></li>`).join("")
    : '<li><span class="p-ok">No problems. The validator accepts this flow.</span></li>';
  $("p-prev").disabled = $("p-next").disabled = !problems.length;
  showProblem(problemAt(problems, -1, code.cursorLine()));
  root.dataset.status = !ok ? "fail" : report.todos.length ? "draft" : "ok";
  $("st-main").textContent = status(report, boot.name);
  $("st-main").dataset.tip = `The result of the last check, which took ${(checked - started).toFixed(1)} ms`;
  const replaced = state.scrubbing ? 0 : toHistory(text, ok, how);
  if (model) draw(model, text);
  // after the draw: a new graph has a new place for messages
  if (replaced) toast(`This edit replaced ${plural(replaced, "later edit")}`);
  showStale(report.errors.length);
  showSync();
}

/** Give the viewer the model of a valid text, and mark the cards that the text added or changed. */
function draw(model, text) {
  const before = state.good?.model, started = performance.now();
  state.good = {model, text};
  // the viewer writes into its model: it gets a copy, and the editor's own stays as render.mjs built it. An edit page is one copy for its comments.
  window.skillflow.boot({...structuredClone(model), edit: true, copy: empty.copy}, host);
  const {added, changed} = before ? changes(before, model) : {added: [], changed: []};
  const card = (id) => document.querySelector(`.canvas .node[data-id="${id}"]`);
  for (const id of added) card(id)?.classList.add("sfx-new");
  for (const id of changed) card(id)?.classList.add("sfx-chg");
  state.ui.ring(code.cursorLine());
  state.renders += 1;
  Object.assign(root.dataset, {renders: state.renders, added: added.length, changed: changed.length, drawMs: (performance.now() - started).toFixed(0)}); // for the browser tests
}

/** A button that goes to the next problem: the text comes into view in Edit mode with its list of problems open. Each press is one step, as F8. */
function toProblem(id, className, text) {
  const button = Object.assign(document.createElement("button"), {type: "button", id, className, textContent: text});
  button.dataset.tip = "Go to the next problem in the text";
  button.addEventListener("click", () => { state.ui.edit(); foldProblems(false, false); goProblem(1); });
  return button;
}

/**
 * The Source view in Read mode shows the last valid text with its comments. The note in its head says when the editor's text is another one
 * (it has errors), or is not saved yet; a press goes to the editor.
 */
function showNote() {
  if (!state.note) return;
  const errors = errorCount();
  const edit = Object.assign(document.createElement("button"), {type: "button", textContent: "unsaved changes"});
  edit.dataset.tip = "The text has changes that are not in the file. Go to the editor; Ctrl+S or ⌘S saves from here too";
  edit.addEventListener("click", () => state.ui.edit());
  state.note.replaceChildren(...(errors ? [toProblem("", "bad", `The last valid text · ${plural(errors, "error")} in the editor`)] : root.hasAttribute("data-dirty") ? [edit] : []));
}

// a declaration, not a const: a page that opens in Read mode asks for the count while the first viewer boots, before this line runs
function errorCount() { return state.problems.filter((problem) => problem.kind === "error").length; }

/** While the text has errors: a count in the page head and a notice over the graph of the last valid text. A press on either goes to the next problem. */
function showStale(errors) {
  $("sf-live")?.remove();
  $("sf-stale")?.remove();
  if (!errors) return;
  state.ui.head.append(toProblem("sf-live", "badge-err", plural(errors, "error")));
  const notice = Object.assign(document.createElement("div"), {id: "sf-stale", className: "gstale"});
  notice.setAttribute("role", "status");
  notice.append(toProblem("", "", state.good ? `The graph of the last valid text · ${plural(errors, "error")} in the text` : `No graph yet · ${plural(errors, "error")} in the text`));
  state.ui.stage.append(notice);
}

// ---------- from one problem to the next ----------
/** Mark problem `index` of the list as the shown one; -1: none. */
function showProblem(index) {
  const count = state.problems.length;
  state.active = index;
  // one stop for the Tab key in the list: the shown problem, else the first; the arrow keys reach the others
  $("problems").querySelectorAll("button").forEach((button, at) => {
    button.tabIndex = at === Math.max(index, 0) ? 0 : -1;
    if (at === index) { button.setAttribute("aria-current", "true"); button.scrollIntoView({block: "nearest"}); } else button.removeAttribute("aria-current");
  });
  $("pcount").textContent = index >= 0 ? `${index + 1} of ${count}` : count ? plural(count, "problem") : "clean";
}

/** Go to problem `index`: its line in the text, its card in the graph, its row in the list. `focus`: the text takes the focus. */
function openProblem(index, focus) {
  const problem = state.problems[index];
  if (problem.line) code.jumpTo(problem.line, focus);
  showProblem(index);
  return problem;
}

/** F8 and the two arrows of the Problems bar: the problem after the cursor's line (`step` 1) or before it (-1). */
function goProblem(step) {
  const index = stepProblem(state.problems, state.active, code.cursorLine(), step);
  if (index < 0) return toast("No problems");
  const hidden = !inView(), {kind, at, message} = openProblem(index, !hidden);
  const text = `${kind} ${index + 1} of ${state.problems.length}${at ? `, line ${at}` : ""}: ${message}`;
  // the list is not in view (the Graph view alone, Read mode, or the list folded): the problem shows as a message, and its card has the ring
  if (hidden || $("pbox").classList.contains("shut")) toast(text, kind === "error"); else $("p-say").textContent = text;
}
$("p-prev").addEventListener("click", () => goProblem(-1));
$("p-next").addEventListener("click", () => goProblem(1));
$("problems").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) openProblem(Number(button.dataset.index), true); });
// in the list, the arrow keys move from row to row and the text follows; Enter goes into the text
$("problems").addEventListener("keydown", (event) => {
  const buttons = [...$("problems").querySelectorAll("button")], at = buttons.indexOf(document.activeElement);
  const to = {ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1}[event.key];
  if (at < 0 || to === undefined) return;
  event.preventDefault();
  if (!buttons[to]) return;
  openProblem(to, false);
  buttons[to].focus();
});
/** Fold the Problems list to its bar, or open it; `keep`: the choice is kept in this browser. */
function foldProblems(shut, keep = true) {
  $("pbox").classList.toggle("shut", shut);
  $("p-toggle").setAttribute("aria-expanded", String(!shut));
  if (keep) try { localStorage.setItem("skillflow-problems", shut ? "shut" : "open"); } catch { /* storage is off */ }
}
$("p-toggle").addEventListener("click", () => foldProblems(!$("pbox").classList.contains("shut")));

// ---------- history ----------
// The rules are in history.mjs: an undo line, where a new text at an earlier edit takes the place of the later edits.
/** Put the checked text into the history. Returns the number of later edits that it replaced. */
function toHistory(text, ok, how) {
  const {history, replaced} = record(state.history, text, ok, new Date(), how);
  state.history = history;
  drawHistory();
  return replaced;
}
function drawHistory() {
  const scrub = $("scrub"), {edits, at} = state.history, shown = edits[at];
  scrub.max = String(Math.max(0, edits.length - 1));
  scrub.value = String(Math.max(0, at));
  $("ticks").innerHTML = edits.map((edit, index) => `<i class="${edit.ok ? "t-ok" : "t-bad"}${index === at ? " t-on" : ""}"></i>`).join("");
  $("tlabel").textContent = shown ? `edit ${at + 1}/${edits.length} · ${clock(shown.time)}` : "";
  scrub.setAttribute("aria-valuetext", $("tlabel").textContent);
  scrub.dataset.tip = shown ? `${$("tlabel").textContent}. Drag to go to another edit of this visit. A new edit there replaces the later ones. Red marks are texts with errors` : "";
  $("h-back").disabled = at <= 0;
  $("h-fwd").disabled = at >= edits.length - 1;
}
/** Show the edit at `index`. The browser's Undo takes the step back. */
function toEdit(index) {
  const next = goTo(state.history, index);
  if (!next) return drawHistory();
  state.history = next;
  state.scrubbing = true;
  try { replaceText(next.edits[index].text); run(); } finally { state.scrubbing = false; }
  drawHistory();
}
/** Put a whole new text in as typing does, so the browser's Undo and Redo stay right. The control that has the focus keeps it. */
function replaceText(text) {
  const held = document.activeElement;
  code.setText(text, true);
  if (held && held !== code.area) held.focus({preventScroll: true});
}
/** A text typed a moment ago becomes an edit before a step, so the step counts from it. */
const typedFirst = () => { if (state.timer) run(state.how); };
$("scrub").addEventListener("input", () => { const asked = Number($("scrub").value); typedFirst(); toEdit(asked); });
$("h-back").addEventListener("click", () => { typedFirst(); toEdit(state.history.at - 1); });
$("h-fwd").addEventListener("click", () => { typedFirst(); toEdit(state.history.at + 1); });

// ---------- the text against the file ----------
function showSync() {
  const dirty = isDirty(state.sync, code.area.value);
  root.toggleAttribute("data-dirty", dirty);
  root.toggleAttribute("data-outside", state.changedOutside);
  document.title = `${dirty ? "● " : ""}${boot.name} · ${boot.title} · SkillFlow`;
  root.toggleAttribute("data-save-error", Boolean(state.saveError));
  $("st-file").textContent = fileStatus(dirty);
  showNote();
}
/** Where the text stands against its file, in the words of what Save does now. */
function fileStatus(dirty) {
  if (state.saving) return "saving…";
  if (state.saveError) return `not saved: ${state.saveError}`;
  // no server: the conflict is with a file the page cannot reach, so Save goes elsewhere
  if (state.stopped) return `no connection to the editor server${state.changedOutside ? " · the file changed on disk" : ""} · Save ${canLink() ? "picks a file" : "downloads the text"}`;
  if (state.changedOutside) return "changed on disk · Save to compare";
  if (!state.store) return dirty ? "not saved · no file linked" : "no file linked";
  return dirty ? "unsaved changes" : state.savedAt ? `saved ${clock(state.savedAt)}` : "no changes";
}

// one save at a time: a save that comes while one is on its way waits for it, and starts from the text that it wrote
let saving = Promise.resolve();
function save() {
  if (!state.store) return canLink() ? link() : downloadFlow();
  return (saving = saving.then(saveNow, saveNow));
}
async function saveNow() {
  const text = toDisk(code.area.value, state.sync.ending);
  if (text === state.sync.base) return toast("No changes to save");
  Object.assign(state, {saving: true, saveError: null});
  showSync();
  // the place this save writes: a lost connection or a newly linked file changes state.store while the save is on its way
  const store = state.store;
  let result;
  try { result = await store.save(state.sync.base, text); } catch (error) {
    // the reason stays in the status until the next save; the message stays until it is dismissed
    state.saveError = error.message;
    return toast(`Not saved: ${error.message}. The text is still here.`, true, ["Save again", save]);
  } finally { state.saving = false; showSync(); }
  // another file was linked meanwhile: this answer is about the old one
  if (state.store && state.store !== store) return;
  // the file already holds this text: a second press of Save while the first was on its way
  if (result.saved || result.disk === text) {
    Object.assign(state, {sync: opened(text), changedOutside: false, savedAt: new Date()});
    toast(`Saved ${store.name ?? boot.name}`);
    showSync();
  } else if (result.disk === null) {
    // the file was removed after the page loaded it: nothing on disk to overwrite, so the save writes it again
    state.sync = {...state.sync, base: null};
    if (state.store) await saveNow();
  } else askWhich(result.disk);
}

/** The file holds a text the page has not seen: show both versions and ask which to keep. `picked`: the person just linked this file. */
function askWhich(disk, picked = false) {
  const mine = code.area.value, theirs = toEditor(disk), [onlyTheirs, onlyMine] = changedLines(theirs, mine);
  const fill = (id, text, marked) => { $(id).innerHTML = htmlLines(text, state.ui.tokenize).map((html, index) => `<div class="l${marked.has(index + 1) ? " chg" : ""}"><i>${index + 1}</i>${html}</div>`).join(""); };
  state.conflict = disk;
  const name = state.store?.name ?? boot.name;
  $("cf-title").textContent = picked ? `${name} already holds another text` : `${name} changed on disk`;
  $("cf-why").textContent = picked ? "The file you picked is not empty, and its text differs from the editor's." : "Another program changed the file after this page loaded it.";
  fill("cf-disk", theirs, onlyTheirs);
  fill("cf-mine", mine, onlyMine);
  $("conflict").showModal();
}
/** The person's answer to askWhich: "mine", "disk", or "later". */
function decide(choice) {
  const disk = state.conflict;
  state.conflict = null;
  if (choice === "later") { state.changedOutside = true; return showSync(); }
  // either way the page has now seen the disk version: a save may replace it
  Object.assign(state, {sync: opened(disk), changedOutside: false});
  if (choice === "mine") return save();
  code.setText(toEditor(disk), true);
  state.history = atLast(state.history);
  run();
  toast("Loaded the version on disk. Undo brings your text back.");
}
// the choice is taken from the button press itself, and the dialog is closed first so the text field can take the focus:
// the dialog's own close event comes later, in a tab that is not in view much later
$("conflict").addEventListener("submit", (event) => { event.preventDefault(); $("conflict").close(); decide(event.submitter.value); });
// Escape closes the dialog with no choice made
$("conflict").addEventListener("cancel", () => decide("later"));

/** The flow file changed outside the page; `disk` is its new text, null when it was removed. */
function fromOutside(disk) {
  const {sync, action} = outside(state.sync, code.area.value, disk);
  Object.assign(state, {sync, changedOutside: action === "conflict"});
  if (action === "load") { replaceText(toEditor(disk)); state.history = atLast(state.history); run(); toast(`${boot.name} changed on disk: the new text is loaded`); }
  else if (action === "removed") toast(`${boot.name} was removed from disk. Save writes it again.`, true);
  showSync();
}

async function link() {
  let linked;
  try { linked = await linkFile(boot.name); } catch (error) { return error.name === "AbortError" ? null : toast(`Not linked: ${error.message}`, true); }
  const text = toDisk(code.area.value, state.sync.ending), {disk} = linked;
  // a new or empty file, the text the page loaded, or the editor's own text: nothing to lose, the save writes at once
  const seen = !disk.trim() || disk === state.sync.base || disk === text;
  Object.assign(state, {store: linked.store, sync: seen ? {...state.sync, base: disk} : state.sync, stopped: false, changedOutside: false, saveError: null});
  $("link").textContent = `Linked: ${linked.store.name}`;
  // the person chose another file: the server's news of its own file no longer applies to this text
  events?.close();
  // another text in the picked file: both versions first, as for a change on disk; "Save my version" then writes
  if (!seen) return askWhich(disk, true);
  await save();
  showSync();
}

/** No server answers: Save goes to a linked file or a download. */
function offline(stopped) {
  // a failure of the old way to the file says nothing about the next Save
  Object.assign(state, {store: null, stopped, saveError: null});
  $("link").hidden = !canLink();
  $("dl-flow").hidden = false;
  showSync();
}

/** The download of the flow: the browser saves a copy, which the page cannot see, so the text still counts as unsaved. */
function downloadFlow() {
  download(boot.name, toDisk(code.area.value, state.sync.ending), "text/plain");
  toast(`The browser downloads ${boot.name}. It is a copy: the editor is not linked to it, so the text still counts as unsaved.`);
}

// ---------- the editor's bar and keys ----------
function format() {
  try {
    const formatted = formatFlow(code.area.value);
    if (formatted === code.area.value) return toast("Already formatted");
    code.setText(formatted, true);
    run();
    toast("Formatted");
  } catch (error) {
    toast(error instanceof FormatError ? `fmt: line ${error.line ?? "?"}: ${error.message}` : error instanceof InvalidKdlError ? "fmt: the flow does not parse; fix the errors first" : `fmt: ${error.message}`, true);
  }
}
$("fmt").addEventListener("click", format);
// the three helps for typing: the focus stays in the text
for (const id of ["ask", "ws"]) $(id).addEventListener("mousedown", (event) => event.preventDefault());
$("ask").addEventListener("click", () => code.suggest());
$("auto").checked = kept("skillflow-suggest", "on");
$("auto").addEventListener("change", (event) => keep("skillflow-suggest", event.target.checked));
function showSpaces(on, save = true) {
  $("ws").setAttribute("aria-pressed", String(on));
  code.showSpaces(on);
  if (save) keep("skillflow-spaces", on);
}
$("ws").addEventListener("click", () => showSpaces($("ws").getAttribute("aria-pressed") !== "true"));
showSpaces(kept("skillflow-spaces", "off"), false);
$("save").addEventListener("click", save);
$("link").addEventListener("click", link);
$("dl-flow").addEventListener("click", downloadFlow);

document.addEventListener("keydown", (event) => {
  const command = event.metaKey || event.ctrlKey;
  // F8 as in other editors; Alt+. and Alt+, for a keyboard whose F8 is a media key
  const step = command ? 0 : event.key === "F8" && !event.altKey ? (event.shiftKey ? -1 : 1) : event.altKey && !event.shiftKey ? {Period: 1, Comma: -1}[event.code] ?? 0 : 0;
  const action = command && event.key.toLowerCase() === "s" ? save : command && event.key === "Enter" ? run : event.altKey && event.shiftKey && event.code === "KeyF" ? format : step ? () => goProblem(step) : null;
  if (!action) return;
  event.preventDefault();
  action();
});
window.addEventListener("beforeunload", (event) => { if (isDirty(state.sync, code.area.value)) event.preventDefault(); });

// ---------- start ----------
let events = null; // the server's stream of file changes; null in an offline page and after the person links a file
code.area.setAttribute("aria-label", `Text of ${boot.name}`);
foldProblems((() => { try { return localStorage.getItem("skillflow-problems") === "shut"; } catch { return false; } })(), false);
code.setText(toEditor(boot.files[boot.flow]));
code.area.setSelectionRange(0, 0);
run();
if (inView()) code.area.focus({preventScroll: true});
if (boot.server) {
  events = new EventSource("events");
  events.addEventListener("flow", (event) => fromOutside(JSON.parse(event.data).text));
  // a file of the skill changed: the `file=` and `ref=` checks read the new files. Each connection starts with the files as
  // they are (scripts/edit.mjs); the same files as the page has draw nothing again.
  let skillFiles = JSON.stringify({files: Object.fromEntries(Object.entries(boot.files).filter(([path]) => path.startsWith(`${boot.skill}/`) && path !== boot.flow))});
  events.addEventListener("files", (event) => {
    if (event.data === skillFiles) return;
    skillFiles = event.data;
    const {files} = JSON.parse(event.data); fs.replaceFolder(boot.skill, files); listFiles(Object.keys(files)); run();
  });
  // The browser tries again by itself after a lost connection (a sleep, a network change). Until it answers, Save goes to a file the person
  // picks or to a download. A server that stopped for good never answers: a new one has another port and token.
  events.onerror = () => {
    if (state.store !== serverStore) return; // the next tries fail too, or the person linked a file
    offline(true);
    toast("No connection to the editor server. The text is still here. The editor connects again by itself; until then Save picks a file or downloads the text.", true);
  };
  // the stream starts with the file as it is now (scripts/edit.mjs): a change while the connection was lost comes as a change from outside
  events.onopen = () => {
    if (!state.stopped) return; // the first connection, or the person linked a file meanwhile
    Object.assign(state, {store: serverStore, stopped: false});
    $("link").hidden = $("dl-flow").hidden = true;
    showSync();
    toast("Connected to the editor server again: Save writes the flow file");
  };
} else offline(false);
