// SkillFlow formatter: one layout for every flow file.
// It changes the space at the start and the end of a line and the blank lines between lines. It never changes,
// moves, or joins a token: prose, names, comments, and the order of the lines stay as written.
// The layout rules are in emit() and gap(); formatFlow() proves each result before it returns it.
import {resolveFlags} from "./_vendor/bgotink-kdl/flags.js";
import {T_BOM, T_CLOSE_BRACE, T_COMMENT_MULTI, T_COMMENT_SINGLE, T_EOF, T_ESCLINE, T_IDENTIFIER_STRING, T_INLINE_WHITESPACE, T_MULTILINE_QUOTED_STRING,
  T_MULTILINE_RAW_STRING, T_NEWLINE, T_OPEN_BRACE, T_QUOTED_STRING, T_SLASHDASH, tokenize} from "./_vendor/bgotink-kdl/parser/tokenize.js";
import {kids, KDL_LINES, parseFlow} from "./validate.mjs";

const TAB = "\t";

/** A flow that parses, but that fmt will not lay out. `line` is null when the fault is in fmt itself. */
export class FormatError extends Error {
  constructor(line, message, hint) { super(message); this.line = line; this.hint = hint; }
}

const tokens = (text) => [...tokenize(text, {flags: resolveFlags()})].filter((token) => token.type !== T_BOM && token.type !== T_EOF);
const isSpace = (token) => token.type === T_INLINE_WHITESPACE;
const isComment = (token) => token.type === T_COMMENT_SINGLE || token.type === T_COMMENT_MULTI;
const isLongString = (token) => token.type === T_MULTILINE_QUOTED_STRING || token.type === T_MULTILINE_RAW_STRING;
const count = (line, type) => line.filter((token) => token.type === type).length;

/** The tokens of each line. A `\` joins the next line to its own, so one node is one line; a blank line is an empty list. */
function splitLines(text) {
  const lines = [[]];
  let continued = false; // the last token that is not space or a comment is `\`
  for (const token of tokens(text)) {
    if (token.type === T_NEWLINE && !continued) { lines.push([]); continue; }
    lines.at(-1).push(token);
    if (token.type === T_ESCLINE) continued = true;
    else if (!isSpace(token) && !isComment(token)) continued = false;
  }
  return lines;
}

/** What the layout needs to know of one line, or null for a blank line. Throws for a line with no place in the layout. */
function describe(line) {
  const body = line.slice(line.findIndex((token) => !isSpace(token)), line.findLastIndex((token) => !isSpace(token) && token.type !== T_NEWLINE) + 1);
  if (!body.length) return null;
  const words = body.filter((token) => !isSpace(token) && !isComment(token) && token.type !== T_NEWLINE);
  const net = count(body, T_OPEN_BRACE) - count(body, T_CLOSE_BRACE);
  const closer = body[0].type === T_CLOSE_BRACE, opener = net === 1 && words.at(-1).type === T_OPEN_BRACE;
  const stray = "a `\\` at the end of a line joins the next line to this node: remove it, or write the rest of the node after it";
  if (words.at(-1)?.type === T_ESCLINE) throw new FormatError(body[0].start.line, "`fmt` cannot place this line: nothing follows its last `\\`", stray);
  // a line is a whole node, the head of a block, or the `}` of a block: only then does each line have one level
  if (!(net === 0 && !closer) && !opener && !(closer && net === -1 && words.length === 1))
    throw new FormatError(body[0].start.line, "`fmt` cannot place this line: it opens or closes more than one block, or a `}` shares its line with other text",
      words.some((token, index) => token.type === T_ESCLINE && words[index + 1].type === T_CLOSE_BRACE) ? stray : "write `{` at the end of its node's line and each `}` on its own line");
  const first = words.find((token) => token.type !== T_SLASHDASH);
  // a `/-` alone on its line removes the node below it: like a comment, it stays with that node
  return {body, closer, opener, comment: !first,
    name: first && (first.type === T_IDENTIFIER_STRING || first.type === T_QUOTED_STRING) ? first.text : null,
    spans: body.some((token) => token.type === T_NEWLINE || KDL_LINES.test(token.text))};
}

/**
 * The units of one block. A unit is a node with the comment lines directly above it, its block, and its `}` line.
 * A comment that a blank line or a `}` follows is a unit with no node: the author set it apart, and it stays apart.
 */
function readUnits(lines, state) {
  const units = [];
  for (;;) {
    while (state.at < lines.length && lines[state.at] === null) state.at += 1;
    if (state.at >= lines.length || lines[state.at].closer) return units;
    const unit = {comments: [], head: null, children: [], close: null};
    while (lines[state.at]?.comment) unit.comments.push(lines[state.at++]);
    const next = lines[state.at];
    if (!unit.comments.length || (next && !next.closer)) {
      unit.head = lines[state.at++];
      if (unit.head.opener) { unit.children = readUnits(lines, state); unit.close = lines[state.at++]; }
    }
    units.push(unit);
  }
}

/** Every line of a `"""` string starts with the space before its closing `"""`; that space moves with the node. */
function moveString(text, indent) {
  const rows = text.split(KDL_LINES), old = /^\s*/u.exec(rows.at(-1))[0];
  // a row of only space is an empty row of the string, whatever its length
  return [rows[0], ...rows.slice(1).map((row) => (row.trim() === "" ? "" : row.startsWith(old) ? indent + row.slice(old.length) : row))].join("\n");
}

/** One line as text at `depth`. What follows a `\` or sits inside a `"""` string is one level deeper. */
function write(line, depth) {
  const indent = TAB.repeat(depth), deeper = indent + TAB;
  return indent + line.body.map((token, index) => {
    const before = line.body[index - 1], after = line.body[index + 1];
    if (isSpace(token)) return before.type === T_NEWLINE || after.type === T_NEWLINE ? "" : token.text;
    if (token.type === T_NEWLINE) return "\n" + deeper;
    if (isLongString(token)) return moveString(token.text, deeper);
    return token.type === T_COMMENT_SINGLE ? token.text.trimEnd() : token.text;
  }).join("");
}

const tall = (unit) => unit.comments.length > 0 || unit.close !== null || unit.head.spans;
/**
 * The blank-line rules: true when a blank line goes between two units of one block, `above` and `below`.
 * `parent` is the name of the node that owns the block, or null at the top of the file.
 */
const gap = (above, below, parent) => !above.head || !below.head // a comment that stands apart
  || tall(above) || tall(below) // a unit of more than one line
  || (parent === "context" && above.head.name !== below.head.name) // the inputs, the outputs, the invariants
  || (parent === null && above.head.name === "skillflow"); // the first line

function emit(units, depth, parent, out) {
  units.forEach((unit, index) => {
    if (index && gap(units[index - 1], unit, parent)) out.push("");
    for (const line of unit.comments) out.push(write(line, depth));
    if (unit.head) out.push(write(unit.head, depth));
    if (unit.close) { emit(unit.children, depth + 1, unit.head.name, out); out.push(write(unit.close, depth)); }
  });
}

function layout(text) {
  const out = [];
  emit(readUnits(splitLines(text).map(describe), {at: 0}), 0, null, out);
  return out.length ? out.join("\n") + "\n" : "";
}

// what must not change: every token outside the layout, in order. A `"""` string is compared by the value the parser
// gives it alone, so a string behind a `/-`, which shape() does not see, is checked too.
const valueOf = (string) => parseFlow("x " + string).nodes[0].entries[0].getValue();
const signature = (text) => JSON.stringify(tokens(text).filter((token) => !isSpace(token) && token.type !== T_NEWLINE)
  .map((token) => [token.type, isLongString(token) ? valueOf(token.text) : token.type === T_COMMENT_SINGLE ? token.text.trimEnd() : token.text]));
const shapeOf = (node) => [node.getTag(), node.getName(), node.entries.map((entry) => [entry.getName(), entry.getTag(), typeof entry.getValue(), entry.getValue()]), kids(node).map(shapeOf)];
const shape = (doc) => JSON.stringify(doc.nodes.map(shapeOf));

/**
 * The flow `text` in the SkillFlow layout. Throws InvalidKdlError for a text that does not parse, and FormatError
 * for a line it cannot place. It returns a text only when that text has the same tokens and is the same document,
 * and when a second run leaves it as it is.
 */
export function formatFlow(text) {
  const doc = parseFlow(text), out = layout(text);
  let same;
  try { same = signature(out) === signature(text) && shape(parseFlow(out)) === shape(doc) && layout(out) === out; } catch { same = false; }
  if (!same) throw new FormatError(null, "`fmt` did not keep the flow as it was, so it wrote nothing", "this is a defect in SkillFlow: report it with this flow file");
  return out;
}
