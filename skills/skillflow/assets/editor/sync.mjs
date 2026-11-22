// The editor's text against the flow file: what the file holds, whether the text differs, and what a change from outside means.
// A sync is {base, ending}: `base` is the file's text as the page last saw it (null: no file), `ending` the file's line ending.

/** A textarea holds \n line ends; the file keeps its own. */
export const toEditor = (text) => text.replace(/\r\n?/g, "\n");
export const toDisk = (text, ending) => (ending === "\n" ? text : text.replaceAll("\n", ending));

/** The sync after the page loaded or saved `disk`. */
export const opened = (disk) => ({base: disk, ending: disk.includes("\r\n") ? "\r\n" : "\n"});

/** True when the editor text differs from the file. */
export const isDirty = (sync, text) => toDisk(text, sync.ending) !== sync.base;

/**
 * The file changed to `disk` (null: removed) while the editor holds `text`. Returns {sync, action}:
 * "load" (no unsaved edits: show the new text), "conflict" (unsaved edits: the next save is refused),
 * "removed" (the next save writes the file again), or "none".
 */
export function outside(sync, text, disk) {
  if (disk === null) return {sync: {...sync, base: null}, action: sync.base === null ? "none" : "removed"};
  if (disk === sync.base) return {sync, action: "none"};
  // the file now holds what the editor holds: this page's own save, or the same edit made twice
  if (toDisk(text, sync.ending) === disk) return {sync: opened(disk), action: "none"};
  return isDirty(sync, text) ? {sync, action: "conflict"} : {sync: opened(disk), action: "load"};
}

/**
 * The whole lines where `before` and `after` differ: {start, end}, where `after` is before.slice(0, start) + a middle + before.slice(before.length - end).
 * A whole new text goes into the text field as these lines only: Chrome takes about half a second to insert 150 lines as typing.
 */
export function differingLines(before, after) {
  const most = Math.min(before.length, after.length);
  let start = 0, end = 0;
  while (start < most && before[start] === after[start]) start++;
  start = before.lastIndexOf("\n", start - 1) + 1;
  while (end < most - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  // the kept end starts a line
  if (end && before[before.length - end - 1] !== "\n") { const cut = before.slice(before.length - end).indexOf("\n"); end = cut < 0 ? 0 : end - cut - 1; }
  return {start, end};
}

/** [lines only in `left`, lines only in `right`] as sets of 1-based line numbers, by the longest common run of lines. */
export function changedLines(left, right) {
  const a = left.split("\n"), b = right.split("\n");
  // common[i][j]: the most lines that a from i and b from j share, in order
  const common = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const only = [new Set(), new Set()];
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j === b.length || (i < a.length && common[i + 1][j] >= common[i][j + 1])) only[0].add(++i);
    else only[1].add(++j);
  }
  return only;
}
