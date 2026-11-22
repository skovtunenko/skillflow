// The list of what fits at the cursor of the text field: when it opens, its keys, the insert, and the fields of an inserted template.
// With "As you type" on, no key is needed to open it:
// - a typed word or `key=` opens the list with the first item selected, so Enter or Tab inserts it;
// - an empty place (a new line, a space after a node's arguments) opens it with nothing selected, so Enter and Tab still edit the text
//   and only the Down arrow goes into the list.
// Alt+Down, Ctrl+Space, the Suggest button, and Tab right after a word always open it with the first item selected.
// Inside a string or a comment the list never opens.
// The fields of an inserted template are marked in the text: the one to fill now, and the ones that Tab goes to next.
import {candidates, context, expand, rank} from "./complete.mjs";
import {escapeHtml} from "./highlight.mjs";

const LINE = 20, PAD_TOP = 10, PAD_LEFT = 14; // the line height and the padding of the text field, as editor.css sets them

/**
 * `area` is the text field, `pop` the list (a child of the field's box), `say` a live region. `tokenize` is the page's KDL highlighter,
 * `grammar` what `candidates` reads, `auto()` whether the list may open by itself while the person types.
 */
export function suggester(area, pop, say, {tokenize, grammar, auto}) {
  // at: the place of the cursor (complete.mjs context); list: the items shown; active: the selected one, -1 for none;
  // fields: the template fields still to visit; seen: the cursor's place at the last look; quiet: the list's own insert is on its way;
  // now: the field to fill, {start, end, at, of, fresh}: `end` is a distance from the end of the text, as in `fields`
  const state = {at: null, list: [], active: 0, fields: [], now: null, seen: -1, quiet: false, char: 0};
  const marks = Object.assign(document.createElement("div"), {id: "flds"});
  marks.setAttribute("aria-hidden", "true"); // the live region says the field
  pop.parentNode.append(marks);

  /** Where the place `pos` of the text is in the field's box: the left edge of its column and the top of its line. */
  function spot(pos) {
    // no line wrap and one font: the place is arithmetic
    // shortcut: a wide character (CJK, emoji) counts as one column and moves the list by a column; measure the line's text if flows get them
    if (!state.char) {
      const probe = Object.assign(document.createElement("span"), {textContent: "x".repeat(100)});
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      pop.parentNode.append(probe);
      state.char = probe.getBoundingClientRect().width / 100;
      probe.remove();
    }
    const lines = area.value.slice(0, pos).split("\n");
    let column = 0;
    for (const char of lines.at(-1)) column = char === "\t" ? column + 4 - (column % 4) : column + 1;
    return {x: PAD_LEFT + column * state.char - area.scrollLeft, y: PAD_TOP + (lines.length - 1) * LINE - area.scrollTop};
  }

  function place() {
    const {x, y: top} = spot(state.at.from), y = top + LINE, height = pop.offsetHeight;
    pop.style.left = `${Math.max(4, Math.min(x, area.clientWidth - pop.offsetWidth - 4))}px`;
    // above the line when the room below is too small
    pop.style.top = `${y + height > area.clientHeight && y - LINE - height > 0 ? y - LINE - height : y}px`;
  }

  /** Mark the fields of the inserted template: a frame on the one to fill, a dashed frame on each next one, and a count where Tab goes on. */
  function drawFields() {
    const {now} = state, length = area.value.length;
    // the marks show only while the cursor is in the field to fill: after an Undo, or a move away, their places are not sure
    if (!now || area.selectionStart < now.start || area.selectionEnd > length - now.end) { marks.innerHTML = ""; return; }
    const frame = (start, end, kind) => { const from = spot(start), to = spot(end); return `<i class="fld ${kind}" style="left:${from.x - 3}px;top:${from.y}px;width:${Math.max(to.x - from.x, 2) + 6}px"></i>`; };
    let html = state.fields.map(([start, end]) => frame(length - start, length - end, "next")).join("");
    const {x, y} = spot(now.start);
    html += frame(now.start, length - now.end, now.fresh ? "now in" : "now");
    // above the line; under it on the first line, where no room is above
    if (now.of > 1) html += `<b class="fld-tip" style="left:${Math.max(0, x - 3)}px;top:${y >= 22 ? y - 22 : y + LINE + 2}px">${now.at}/${now.of}${state.fields.length ? " · Tab: next" : ""}</b>`;
    marks.innerHTML = html;
  }
  const endFields = () => { state.fields = []; state.now = null; drawFields(); };

  function draw() {
    const {list, active} = state;
    pop.hidden = !list.length;
    // the selected item is the text field's active one for a screen reader; the live region below says it too
    if (list.length && active >= 0) area.setAttribute("aria-activedescendant", `pop-${active}`); else area.removeAttribute("aria-activedescendant");
    pop.innerHTML = list.map((item, index) => `<li role="option" id="pop-${index}" aria-selected="${index === active}" data-index="${index}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.hint)}</span></li>`).join("")
      + `<li class="pop-tip" role="presentation">${active < 0 ? "↓ goes into the list · Enter and Tab edit the text · Esc closes" : "Enter or Tab inserts · Esc closes"}</li>`;
    // a new field is said once, before what the list says
    const field = state.now?.fresh && state.now.of > 1 ? `Field ${state.now.at} of ${state.now.of}. ` : "";
    say.textContent = field + (!list.length ? "" : active < 0 ? `${list.length} suggestions. The Down arrow goes into the list.` : `${list.length} suggestions. ${list[active].label}, ${list[active].hint}`);
    drawFields();
    if (state.now) state.now.fresh = false;
    if (!list.length) return;
    place();
    if (active >= 0) pop.children[active].scrollIntoView({block: "nearest"});
  }

  /** Read the place of the cursor and show the list. `force`: open with the first item selected; `silent`: only close. */
  function look(force = false, silent = false) {
    state.seen = area.selectionStart;
    state.at = context(area.value, state.seen, tokenize);
    const {at} = state, ranked = rank(candidates(at, area.value, grammar, tokenize), at.word);
    const complete = ranked.length === 1 && ranked[0].insert === at.word;
    const lineBefore = area.value.slice(area.value.lastIndexOf("\n", state.seen - 1) + 1, state.seen), choosing = Boolean(at.word) || at.kind === "value";
    const idle = !at.word && (at.kind === "node" ? !lineBefore.trim() : (at.kind === "prop" || at.kind === "name") && /\s$/.test(lineBefore));
    state.list = ranked.length && !complete && !silent && (force || (auto() && (choosing || idle))) ? ranked : [];
    state.active = force || choosing ? 0 : -1;
    draw();
  }
  const close = () => { state.list = []; draw(); };

  function accept(item) {
    const text = area.value, from = state.at.from, indent = /^[\t ]*/.exec(text.slice(text.lastIndexOf("\n", from - 1) + 1))[0], made = expand(item.insert, indent);
    state.quiet = true;
    area.setSelectionRange(from, area.selectionEnd);
    document.execCommand("insertText", false, made.text); // the browser's Undo takes the insert back
    state.quiet = false;
    // a field is kept as its distance from the end of the text: typing in one field does not move the fields after it
    // shortcut: an edit after the fields moves them; Escape or a press in the text ends the fields. Upgrade: follow the edits
    const length = area.value.length;
    if (made.stops.length) { state.fields = made.stops.map(([start, end]) => [length - from - start, length - from - end]); state.now = null; }
    if (!nextField()) look(); // after `by=` the values open at once
  }
  function nextField() {
    const field = state.fields.shift(), of = state.now ? state.now.of : state.fields.length + 1;
    if (!field) { if (state.now) endFields(); return false; }
    state.now = {start: area.value.length - field[0], end: field[1], at: of - state.fields.length, of, fresh: true};
    area.setSelectionRange(state.now.start, area.value.length - field[1]);
    look();
    return true;
  }
  /** Tab right after a word completes it: one fit goes in at once, several open the list. False: nothing fits, and Tab indents. */
  function tabComplete() {
    if (area.selectionStart !== area.selectionEnd || !context(area.value, area.selectionStart, tokenize).word) return false;
    look(true);
    const fits = state.list.length;
    if (fits === 1) accept(state.list[0]);
    return fits > 0;
  }

  // a press on an item inserts it; the focus stays in the text
  pop.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const option = event.target.closest("li[data-index]");
    if (option) accept(state.list[option.dataset.index]);
  });
  area.addEventListener("pointerdown", endFields);

  return {
    /** True while the list is open. */
    get open() { return state.list.length > 0; },
    /** The text changed by typing. */
    input() { if (!state.quiet) look(); },
    /** The cursor moved without typing: the list closes. */
    moved() { if (area.selectionStart !== state.seen) look(false, true); },
    /** The text field scrolled. */
    scrolled() { if (state.list.length) place(); drawFields(); },
    /** Open the list by hand. */
    ask() { area.focus(); look(true); },
    /** A key of the text field; true when the list took it. Tab: a template field, then a completion; false leaves Tab to the indent. */
    key(event) {
      const {list} = state;
      // Alt+Down opens a list in a combobox by the ARIA pattern; Ctrl+Space is for a system that leaves it free
      if ((event.ctrlKey && event.code === "Space") || (event.altKey && event.key === "ArrowDown")) { event.preventDefault(); look(true); return true; }
      if (list.length) {
        if (event.key === "ArrowDown" || (event.key === "ArrowUp" && state.active >= 0)) {
          event.preventDefault();
          state.active = state.active < 0 ? 0 : (state.active + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length;
          draw();
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && state.active >= 0 && !event.shiftKey) { event.preventDefault(); accept(list[state.active]); return true; }
        if (event.key === "Escape") { event.preventDefault(); close(); return true; }
      }
      if (event.key === "Escape") endFields();
      if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (nextField() || tabComplete())) { event.preventDefault(); return true; }
      return false;
    },
  };
}
