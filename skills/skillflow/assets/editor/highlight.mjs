// Flow text as HTML lines: the tokens of the page's KDL highlighter, each in a span with its class.
export const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[char]);

/** One HTML string for each line of `text`; `tokenize` gives [{text, cls}] whose texts join back to `text`; `show` makes the HTML of a piece of text. */
export function htmlLines(text, tokenize, show = escapeHtml) {
  const lines = [""];
  for (const token of tokenize(text)) token.text.split("\n").forEach((part, index) => {
    if (index) lines.push("");
    if (part) lines[lines.length - 1] += token.cls ? `<span class="${token.cls}">${show(part)}</span>` : show(part);
  });
  return lines;
}
