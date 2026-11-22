// The history of one visit to the editor, as an undo line. Each function is pure: it takes a history and returns a new one.
// A history is {edits, at}. `edits` is a list of {text, ok, time, open}; `at` is the index of the edit now shown, -1 for none.
// `open` marks an edit that the next typed text may join: a run of typing with short pauses is one edit, not one edit for each key.

export const LIMIT = 400; // edits kept; the oldest go first
export const PAUSE = 1000; // ms without a key that end a run of typing

export const noEdits = () => ({edits: [], at: -1});

const closed = (edit) => (edit.open ? {...edit, open: false} : edit);

/**
 * The history after `text` came. `how` says where the text is from:
 * - "typed": the keyboard. Within PAUSE after the open edit at the end, the text joins that edit;
 * - "undo": the browser's Undo or Redo. A text that an edit already holds shows that edit, and replaces none;
 * - "set": Format, the file on disk, the start of the page. Always an edit of its own.
 * A text that is no edit yet becomes a new edit after the one shown, and takes the place of the later edits.
 * `time` is the moment of the text, a Date or a number of ms. Returns {history, replaced}: the count of the edits that the text replaced.
 */
export function record({edits, at}, text, ok, time, how = "set") {
  const shown = edits[at], keep = (history) => ({history, replaced: 0});
  if (shown?.text === text) return keep({edits: edits.with(at, {...shown, ok}), at});
  if (how === "undo") {
    // the nearest edit with this text: after a step back, Undo gives the text before the step, which is a later edit
    const same = edits.map((edit, index) => (edit.text === text ? index : -1)).filter((index) => index >= 0).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
    if (same !== undefined) return keep({edits: edits.map(closed).with(same, {...closed(edits[same]), ok}), at: same});
  }
  if (how !== "set" && shown?.open && at === edits.length - 1 && time - shown.time < PAUSE) return keep({edits: edits.with(at, {text, ok, time, open: true}), at});
  const next = [...edits.slice(0, at + 1).map(closed), {text, ok, time, open: how !== "set"}].slice(-LIMIT);
  return {history: {edits: next, at: next.length - 1}, replaced: edits.length - at - 1};
}

/** The history with the edit at `index` shown, or null when it has no such edit. No edit stays open: a text typed there is a new edit. */
export const goTo = ({edits}, index) => (edits[index] ? {edits: edits.map(closed), at: index} : null);

/** The history with its last edit shown: a text from outside the editor then goes after it and replaces none. */
export const atLast = ({edits}) => ({edits, at: edits.length - 1});
