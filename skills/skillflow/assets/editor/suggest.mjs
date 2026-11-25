// The list of what fits at the cursor of the text field: when it opens, its keys, the insert, and the fields of an inserted template.
// With "As you type" on, no key is needed to open it:
// - a typed word or `key=` opens the list with the first item selected, so Enter or Tab inserts it;
// - an empty place (a new line, a space after a node's arguments) opens it with nothing selected, so Enter and Tab still edit the text
//   and only the Down arrow goes into the list.
// Alt+Down, Ctrl+Space, the Suggest button, and Tab right after a word always open it with the first item selected.
// Inside a string or a comment the list never opens.
// The fields of an inserted template are marked in the text: the one to fill now, and the others. Tab and Shift+Tab go round them;
// Enter ends a one-line field, and Shift+Enter any field: the cursor goes to the next field, or after the last one to the end of its line.
import {candidates, context, expand, rank} from "./complete.mjs";
import {escapeHtml} from "./highlight.mjs";

const LINE = 20, PAD_TOP = 10, PAD_LEFT = 14; // the line height and the padding of the text field, as editor.css sets them

/**
 * `area` is the text field, `pop` the list (a child of the field's box), `say` a live region. `tokenize` is the page's KDL highlighter,
 * `grammar` what `candidates` reads, `auto()` whether the list may open by itself while the person types.
 */
export function suggester(area, pop, say, {tokenize, grammar, auto}) {
  // at: the place of the cursor (complete.mjs context); list: the items shown; active: the selected one, -1 for none;
  // fields: the [start, end] of each template field; now: the field to fill, {index, fresh}; length: the text's length at the last edit;
  // seen: the cursor's place at the last look; quiet: the list's own insert is on its way
  const state = {at: null, list: [], active: 0, fields: [], now: null, length: 0, seen: -1, quiet: false, char: 0};
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

  /** Mark the fields of the inserted template: a frame on the one to fill, a dashed frame on each other one, and the field's keys. */
  function drawFields() {
    const {now, fields} = state, field = here();
    // the marks show only while the cursor is in the field to fill: after a move away their places are not sure
    if (!field) { marks.innerHTML = ""; return; }
    const frame = ([start, end], kind) => { const from = spot(start), to = spot(end); return `<i class="fld ${kind}" style="left:${from.x - 3}px;top:${from.y}px;width:${Math.max(to.x - from.x, 2) + 6}px"></i>`; };
    let html = fields.map((other) => (other === field ? frame(field, now.fresh ? "now in" : "now") : frame(other, "next"))).join("");
    const {x, y} = spot(field[0]), last = now.index === fields.length - 1, enter = block(field) ? "Shift+Enter" : "Enter";
    // above the line; under it on the first line, where no room is above
    if (fields.length > 1) html += `<b class="fld-tip" style="left:${Math.max(0, x - 3)}px;top:${y >= 22 ? y - 22 : y + LINE + 2}px">${now.index + 1}/${fields.length} · ${last ? `${enter}: done` : `Tab or ${enter}: next`}</b>`;
    marks.innerHTML = html;
  }
  const endFields = () => { state.fields = []; state.now = null; drawFields(); };
  /** The [start, end] of the field to fill while the cursor is in it; else null. */
  function here() {
    const field = state.now && state.fields[state.now.index];
    return field && area.selectionStart >= field[0] && area.selectionEnd <= field[1] ? field : null;
  }
  // a field on a line of its own is a block's body, where Enter adds a line; every other field is one line (no template has a `"""` field)
  const block = ([start]) => !area.value.slice(area.value.lastIndexOf("\n", start - 1) + 1, start).trim();
  /** The text changed: the field to fill grows or shrinks, and the fields after it move. An edit outside it ends the fields. */
  function follow(event) {
    const {now, fields} = state, change = area.value.length - state.length;
    state.length = area.value.length;
    if (!now) return;
    // Undo and Redo put back text whose places the fields cannot follow, even at the same length: the fields end
    if (/^history/.test(event?.inputType ?? "")) return endFields();
    if (!change) return;
    const field = fields[now.index];
    if (area.selectionStart < field[0] || area.selectionStart > field[1] + change) return endFields();
    field[1] += change;
    for (const after of fields.slice(now.index + 1)) { after[0] += change; after[1] += change; }
  }

  function draw() {
    const {list, active} = state;
    pop.hidden = !list.length;
    // the selected item is the text field's active one for a screen reader; the live region below says it too
    if (list.length && active >= 0) area.setAttribute("aria-activedescendant", `pop-${active}`); else area.removeAttribute("aria-activedescendant");
    pop.innerHTML = list.map((item, index) => `<li role="option" id="pop-${index}" aria-selected="${index === active}" data-index="${index}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.hint)}</span></li>`).join("")
      + `<li class="pop-tip" role="presentation">${active < 0 ? "↓ goes into the list · Enter and Tab edit the text · Esc closes" : "Enter or Tab inserts · Esc closes"}</li>`;
    // a new field is said once, before what the list says
    // the marks of the fields are hidden from a screen reader, so the region says the field's value and its keys
    const {now, fields} = state, enter = now && block(fields[now.index]) ? "Shift+Enter" : "Enter";
    const field = now?.fresh && fields.length > 1 ? `Field ${now.index + 1} of ${fields.length}, ${area.value.slice(...fields[now.index])}. ${now.index === fields.length - 1 ? `${enter}: done` : `Tab or ${enter}: next`}, Escape: end. ` : "";
    const count = `${list.length} suggestion${list.length === 1 ? "" : "s"}.`;
    say.textContent = field + (!list.length ? "" : active < 0 ? `${count} The Down arrow goes into the list.` : `${count} ${list[active].label}, ${list[active].hint}`);
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
    // a field that already has a value selects it, so that Tab or Enter keeps it
    const value = area.value.slice(state.seen, area.selectionEnd);
    state.active = force || choosing ? Math.max(0, state.list.findIndex((item) => item.insert === value)) : -1;
    draw();
  }
  const close = () => { state.list = []; draw(); };

  function accept(item) {
    const text = area.value, from = state.at.from, indent = /^[\t ]*/.exec(text.slice(text.lastIndexOf("\n", from - 1) + 1))[0], made = expand(item.insert, indent);
    state.quiet = true;
    area.setSelectionRange(from, area.selectionEnd);
    document.execCommand("insertText", false, made.text); // the browser's Undo takes the insert back
    state.quiet = false;
    // a new template's fields take the place of the old ones; a value picked in a field goes on to the next field
    if (made.stops.length) { state.fields = made.stops.map(([start, end]) => [from + start, from + end]); state.now = null; return go(1); }
    if (!here() || !done()) look(); // after `by=` the values open at once
  }
  /** Select the field `step` places from the one to fill, round the ends; the first field when none is to fill. */
  function go(step) {
    const count = state.fields.length, index = state.now ? (state.now.index + step + count) % count : 0;
    state.now = {index, fresh: true};
    area.setSelectionRange(...state.fields[index]);
    look();
    return true;
  }
  /** End the field to fill: the cursor goes to the next field; after the last one, to the end of its line, and the fields end. */
  function done() {
    if (state.now.index < state.fields.length - 1) return go(1);
    const end = state.fields[state.now.index][1], line = area.value.indexOf("\n", end), at = line < 0 ? area.value.length : line;
    endFields();
    area.setSelectionRange(at, at);
    return false;
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
    /** True while a template's fields are to fill: Escape ends them and does not let the next Tab leave the text. */
    get filling() { return Boolean(state.now); },
    /** The text changed by `event`, an input event. */
    input(event) { follow(event); if (!state.quiet) look(); },
    /** The cursor moved without typing: the list closes. */
    moved() { if (area.selectionStart !== state.seen) look(false, true); },
    /** The text field scrolled. */
    scrolled() { if (state.list.length) place(); drawFields(); },
    /** Open the list by hand. */
    ask() { area.focus(); look(true); },
    /** A key of the text field; true when the list or a field took it. Tab: a template field, then a completion; false leaves Tab to the indent. */
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
        if (event.key === "Escape") { event.preventDefault(); close(); endFields(); return true; }
      }
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey, field = here();
      if (field && plain && (event.key === "Tab" || (event.key === "Enter" && (event.shiftKey || !block(field))))) {
        event.preventDefault();
        // one field alone has nowhere to go round: Tab ends it, as Enter does
        if (event.key === "Tab" && state.fields.length > 1) go(event.shiftKey ? -1 : 1); else done();
        return true;
      }
      if (event.key === "Escape") endFields();
      // the cursor left the fields: Tab ends them and completes or indents
      if (event.key === "Tab" && plain && !event.shiftKey) { if (state.now) endFields(); if (tabComplete()) { event.preventDefault(); return true; } }
      return false;
    },
  };
}
