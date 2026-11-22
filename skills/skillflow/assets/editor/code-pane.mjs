// The text side: a transparent textarea over a highlighted copy of its text, with line numbers, a mark at each problem line,
// and a ruler that shows where the problem lines are in the whole text. It keeps the indent on Enter and on `}`, shows spaces and tabs
// on request, and has the list of what fits at the cursor (suggest.mjs).
import {closesBlock, newLine} from "./complete.mjs";
import {escapeHtml, htmlLines} from "./highlight.mjs";
import {suggester} from "./suggest.mjs";
import {differingLines} from "./sync.mjs";

const LINE = 20; // the editor's line height in px; --lh in editor.css is the same

// a space or a tab in a span of its own: CSS draws a mark over the real character, so the text and its widths stay as they are
const marked = (text) => escapeHtml(text).replace(/[ \t]/g, (char) => `<span class="${char === " " ? "wsp" : "wtab"}">${char}</span>`);

/**
 * `tokenize` is the page's KDL highlighter; `onInput(event)` runs after an edit, `onLine(line)` when the cursor reaches another line.
 * `grammar` and `auto` are for the list of what fits at the cursor (suggest.mjs).
 */
export function codePane(tokenize, {onInput, onLine, grammar, auto}) {
  const area = document.getElementById("src"), layer = document.getElementById("hl"), gutter = document.getElementById("gutter"), ruler = document.getElementById("ruler");
  const state = {problems: new Map(), line: 0, leaving: false, marks: false, loading: false};
  const aid = suggester(area, document.getElementById("pop"), document.getElementById("pop-say"), {tokenize, grammar, auto});
  const insert = (text) => document.execCommand("insertText", false, text); // the browser's Undo takes it back
  const cursorLine = () => area.value.slice(0, area.selectionStart).split("\n").length;
  // the ruler's shade is the part of the text now in view
  const follow = () => {
    layer.scrollTop = gutter.scrollTop = area.scrollTop; layer.scrollLeft = area.scrollLeft;
    const shade = ruler.firstElementChild, all = area.scrollHeight || 1;
    if (shade) Object.assign(shade.style, {top: `${(area.scrollTop / all) * 100}%`, height: `${Math.min(1, area.clientHeight / all) * 100}%`});
  };
  const tipOf = (line, problem) => escapeHtml(`Line ${line}\n` + problem.items.map((item) => `${item.kind}: ${item.message}`).join("\n"));

  function paint() {
    const lines = htmlLines(area.value, tokenize, state.marks ? marked : escapeHtml), current = cursorLine();
    layer.innerHTML = lines.map((html, index) => {
      const problem = state.problems.get(index + 1);
      return `<div class="l${problem ? " sq-" + problem.kind : ""}${index + 1 === current ? " cur" : ""}">${html || " "}</div>`;
    }).join("") + '<div class="l"> </div><div id="flash"></div>';
    gutter.innerHTML = lines.map((_, index) => {
      const problem = state.problems.get(index + 1);
      const title = problem ? ` data-tip="${tipOf(index + 1, problem)}"` : "";
      return `<div class="gl${index + 1 === current ? " cur" : ""}"${title}>${problem ? `<i class="mk mk-${problem.kind}" data-line="${index + 1}"></i>` : ""}${index + 1}</div>`;
    }).join("") + '<div class="gl"> </div>';
    ruler.innerHTML = '<b class="rshade"></b>' + [...state.problems].filter(([line]) => line > 0 && line <= lines.length)
      .map(([line, problem]) => `<i class="rk-${problem.kind}${line === current ? " on" : ""}" data-line="${line}" data-tip="${tipOf(line, problem)}" style="top:${(((line - 0.5) / lines.length) * 100).toFixed(2)}%"></i>`).join("");
    follow();
  }

  /** Select `line`, bring it into view, and flash it. */
  function jumpTo(line, focus = true) {
    const lines = area.value.split("\n"), start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0), top = (line - 1) * LINE;
    area.setSelectionRange(start, start + (lines[line - 1] ?? "").length);
    if (top < area.scrollTop || top > area.scrollTop + area.clientHeight - 3 * LINE) area.scrollTop = Math.max(0, top - area.clientHeight / 3);
    if (focus) area.focus({preventScroll: true});
    state.line = line;
    paint();
    const flash = document.getElementById("flash");
    flash.style.top = `${10 + top}px`;
    flash.classList.add("go");
    onLine(line);
  }

  area.addEventListener("scroll", () => { follow(); aid.scrolled(); });
  // a whole new text (Format, the version on disk) opens no list
  area.addEventListener("input", (event) => {
    // the browser's Undo of a new text (Format, a step of the history) selects the lines it brings back, and the next key would replace them:
    // the cursor goes to the end of those lines, or to the first line in view when they are the whole text
    if (/^history/.test(event.inputType ?? "") && area.selectionStart !== area.selectionEnd) {
      const top = area.scrollTop, whole = area.selectionStart === 0 && area.selectionEnd === area.value.length;
      const at = whole ? area.value.split("\n").slice(0, Math.round(top / LINE)).join("\n").length : area.selectionEnd;
      area.setSelectionRange(at, at);
      area.scrollTop = top;
    }
    paint(); onInput(event); if (!state.loading) aid.input();
  });
  // `}` on a line of its own takes one level back; beforeinput also sees a phone keyboard, which sends no key name
  area.addEventListener("beforeinput", (event) => {
    const start = area.selectionStart;
    if (event.data !== "}" || start !== area.selectionEnd || !closesBlock(area.value.slice(0, start))) return;
    event.preventDefault();
    area.setSelectionRange(start - 1, start);
    insert("}");
  });
  area.addEventListener("keydown", (event) => {
    // after Escape the next Tab moves the focus, so the keyboard can leave the field; an Escape that closes the list does not count
    const leaving = state.leaving && event.key === "Tab";
    state.leaving = event.key === "Escape" && !aid.open;
    if (leaving || aid.key(event) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
    const before = area.value.slice(0, area.selectionStart);
    // Enter keeps the indent of its line, and adds a level after `{`; Tab indents, as fmt writes it
    const text = event.key === "Enter" ? newLine(before.slice(before.lastIndexOf("\n") + 1)) : event.key === "Tab" ? "\t" : null;
    if (text === null) return;
    event.preventDefault();
    insert(text);
  });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === area) aid.moved();
    if (document.activeElement !== area || cursorLine() === state.line) return;
    state.line = cursorLine();
    paint();
    onLine(state.line);
  });
  for (const marks of [gutter, ruler]) marks.addEventListener("click", (event) => {
    const mark = event.target.closest("[data-line]");
    if (mark) return jumpTo(Number(mark.dataset.line));
    // a press on the ruler between its marks brings that part of the text into view
    if (marks === ruler) area.scrollTop = ((event.clientY - ruler.getBoundingClientRect().top) / ruler.clientHeight) * area.scrollHeight - area.clientHeight / 2;
  });

  return {
    area, paint, jumpTo, cursorLine,
    /** The line at the top of the view; with `line`, that line comes to the top. */
    topLine(line) { if (line) area.scrollTop = (line - 1) * LINE; return Math.round(area.scrollTop / LINE) + 1; },
    /** Open the list of what fits at the cursor. */
    suggest: () => aid.ask(),
    /** Show or hide the marks of spaces and tabs. */
    showSpaces(on) { state.marks = on; paint(); },
    /** Show the problems of a check: Map of line -> {kind, items}. */
    mark(problems) { state.problems = problems; paint(); },
    /** Put `text` in the place of the whole text. `undoable`: the browser's Undo brings the old text back. */
    setText(text, undoable = false) {
      if (area.value !== text) {
        // a new text puts the cursor at the end: keep the reader's place
        const at = Math.min(area.selectionStart, text.length), top = area.scrollTop;
        if (undoable) {
          const {start, end} = differingLines(area.value, text);
          area.focus({preventScroll: true});
          area.setSelectionRange(start, area.value.length - end);
          state.loading = true; insert(text.slice(start, text.length - end)); state.loading = false;
        }
        if (area.value !== text) area.value = text;
        area.setSelectionRange(at, at);
        area.scrollTop = top;
      }
      paint();
    },
  };
}
