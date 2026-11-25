// The edit page's layout choices, kept per viewer as one cookie pair: the view, Graph and Source together or not,
// the graph's share of the room, the mode of the Source view, the details panel, and the way the split was last turned.
const KEY = "skillflow-editor", VIEWS = ["graph", "source"], SPLITS = ["one", "cols", "rows"], MODES = ["edit", "read"];

/** The graph's share of the page in percent, kept inside 20–80 so neither side closes. */
export const clampRatio = (percent) => Math.min(80, Math.max(20, Math.round(Number(percent)) || 55)); // 55: the default share, a little more than half for the graph, as in viewer/model.js

/** `name=value` of the choices, for a cookie or for readPrefs. */
export const prefsPair = ({view, split, ratio, srcMode, panelShut, dir}) => `${KEY}=${view}.${split || "one"}.${clampRatio(ratio)}.${srcMode}.${panelShut ? "shut" : "open"}.${split || dir || "cols"}`;

/**
 * The choices that `saved` holds (a cookie string). With nothing saved, or a pair this version does not know, the page starts as an editor:
 * the text in Edit mode, with the graph beside it on a wide window, and the details panel hidden.
 */
export function readPrefs(saved, narrow = false) {
  const [view, split, ratio, mode, panel, dir] = new RegExp(`(?:^|;\\s*)${KEY}=([^;]*)`).exec(saved ?? "")?.[1].split(".") ?? [];
  // ratio 55: the default share, a little more than half for the graph, as in viewer/model.js
  if (!VIEWS.includes(view) || !SPLITS.includes(split) || !MODES.includes(mode)) return {view: "source", split: narrow ? "" : "cols", ratio: 55, srcMode: "edit", panelShut: true, dir: "cols"};
  // a pair of an earlier version has no turn: the split it names, else side by side
  return {view, split: split === "one" ? "" : split, ratio: clampRatio(ratio), srcMode: mode, panelShut: panel !== "open", dir: split !== "one" ? split : dir === "rows" ? "rows" : "cols"};
}
