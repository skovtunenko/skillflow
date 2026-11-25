// What fits at the cursor of a flow text: pure functions of the text, the cursor, the page's KDL tokenizer, and the validator's tables.
// node -> [template, hint]; ${text} is a field that Tab stops at. The forms are those of references/grammar.md
const NODES = {
  skillflow: ["skillflow 1.0", "the format version, the first line"],
  context: ["context {\n\t${}\n}", "facts about the whole skill"],
  input: ['input ${name} "${description}"', "what the skill gets or asks for"],
  output: ['output ${name} "${description}"', "what is produced"],
  invariant: ['invariant by=${llm} "${rule}"', "a rule for the whole flow"],
  phase: ["phase ${name} {\n\t${}\n}", "a group of steps"],
  step: ['step ${name} by=${llm} "${what the step does}"', "one action"],
  decide: ['decide ${name} "${question?}" by=${llm} {\n\twhen ${yes} {\n\t\t${}\n\t}\n}', "a fork with a when for each answer"],
  gate: ['gate ${name} "${question?}"', "an approval by the user"],
  when: ["when ${outcome} {\n\t${}\n}", "one answer of the fork"],
  "on-fail": ['on-fail "${what happens}"', "what happens when the step fails"],
  end: ['end "${reason}"', "the flow ends here"],
  tools: ["tools ${tool}", "the tools of the node"],
};
const KEYS = {
  by: ["by=", "who acts: llm, code, human"],
  file: ["file=", "the path of the script, for by=code"],
  ref: ['ref="${label}"', "a label from the skill's text"],
  skill: ['skill="${name}"', "another skill, or the path of the skill"],
  "skill-version": ['skill-version="${version}"', "the skill's version at the last check"],
  "skillflow-version": ['skillflow-version="${version}"', "the SkillFlow version at the last check"],
};
const BY = {llm: "the model acts", code: "a script acts", human: "the person acts"};
const NAMED = new Set(["skillflow", "phase", "step", "decide", "gate", "when", "input"]); // the first argument is a name that the author makes
const WORD = /[^\s{}()\[\];="\\\/]*$/; // the same word characters as the tokenizer
const closed = (text) => {
  const open = /^(#*)("""|")/.exec(text), end = open[2] + open[1];
  if (text.length < open[0].length + end.length || !text.endsWith(end)) return false;
  // in a plain string a `\` escapes the quote: an odd count of them before the last quote leaves the string open
  return Boolean(open[1]) || open[2] !== '"' || /(^|[^\\])(\\\\)*"$/.test(text.slice(1));
};

/**
 * Where the cursor is: {path, parent, node, kind, key, word, keys, argv, by, from}. `kind` is the place: node (a line's first word), prop, value
 * (after `key=`), name (an argument that is a name), prose (in a string), or comment. `from` is where `word`, the text to complete, starts.
 */
export function context(text, pos, tokenize) {
  const before = text.slice(0, pos), tokens = tokenize(before), path = [];
  let node = null, keys = [], argv = [], prev = "", by = null;
  // shortcut: a node that goes on after `\` is read line by line; rare in flow files, upgrade if authors write it
  for (const token of tokens) {
    if (token.text === "\n" || token.cls === "tk-br") {
      if (token.text === "{") path.push(node ?? "?");
      if (token.text === "}") path.pop();
      node = null; keys = []; argv = []; by = null;
    } else if (token.cls === "tk-node") node = token.text;
    else if (token.cls === "tk-key") keys.push(token.text);
    else if (token.cls === "tk-val" && keys.at(-1) === "by") by = token.text;
    else if (/^tk-(arg|str|num|kw)$/.test(token.cls) && prev !== "(") argv.push(token.text); // `(agent)` before a tool is its kind, not a name
    if (token.cls) prev = token.text;
  }
  const last = tokens.at(-1) ?? {text: "", cls: ""}, quoted = /^#*"/.test(last.text) && !closed(last.text);
  let word = WORD.exec(before)[0], kind, key = null;
  if (/tk-(com|ask)/.test(last.cls)) kind = "comment";
  else if (quoted && last.cls.includes("tk-val")) { kind = "value"; key = keys.at(-1); word = last.text; } // file="scr
  else if (quoted) kind = "prose";
  else if (!node || (last.cls === "tk-node" && word)) kind = "node";
  else if (keys.length && before.endsWith("=" + word)) { kind = "value"; key = keys.at(-1); }
  else {
    if (word && argv.at(-1) === word) argv.pop();
    kind = node === "tools" || (NAMED.has(node) && !argv.length) ? "name" : "prop";
  }
  return {path, parent: path.at(-1) ?? "", node: kind === "node" ? null : node, kind, key, word, keys, argv, by, from: pos - word.length};
}

/** The tool names that the text already has. */
export function toolNames(text, tokenize) {
  const names = new Set();
  let node = null, prev = "";
  for (const token of tokenize(text)) {
    if (token.text === "\n" || token.cls === "tk-br") node = null;
    else if (token.cls === "tk-node") node = token.text;
    else if (node === "tools" && token.cls === "tk-arg" && prev !== "(") names.add(token.text);
    if (token.cls) prev = token.text;
  }
  return [...names];
}

/**
 * What fits at the place `at` (from `context`): [{label, hint, insert}]. `grammar` is {children, props, by, files}: the validator's CHILDREN, PROPS
 * and EXECUTORS, and the paths of the skill's files.
 */
export function candidates(at, text, grammar, tokenize) {
  const item = (label, hint, insert = label) => ({label, hint, insert});
  if (at.kind === "node") return (grammar.children[at.parent] ?? []).map((name) => item(name, NODES[name]?.[1] ?? "", NODES[name]?.[0] ?? name));
  // `file=` is only for a code step: after another `by=` the validator rejects it
  if (at.kind === "prop") return (grammar.props[at.node] ?? []).filter((key) => !at.keys.includes(key) && !(key === "file" && at.by && at.by !== "code")).map((key) => item(key + "=", KEYS[key]?.[1] ?? "", KEYS[key]?.[0] ?? key + "="));
  if (at.kind === "value" && at.key === "by") return grammar.by.map((value) => item(value, BY[value] ?? ""));
  if (at.kind === "value" && at.key === "file") return grammar.files.map((file) => item(`"${file}"`, "a file of the skill"));
  if (at.kind === "name" && at.node === "when") return at.parent === "gate"
    ? [item("rejected", "the person refuses"), item("approved", "override implied continue"), item("revise", "override implied repeat")]
    : [item("yes", "a usual answer"), item("no", "a usual answer")];
  if (at.kind === "name" && at.node === "tools") return toolNames(text.slice(0, at.from) + text.slice(at.from + at.word.length), tokenize).filter((name) => !at.argv.includes(name)).map((name) => item(name, "already in this file"));
  return [];
}

/** The items that `word` selects: those that start with it, then those that have its letters in order. */
export function rank(items, word) {
  const typed = word.toLowerCase();
  const score = (label) => {
    const text = label.toLowerCase();
    if (text.startsWith(typed)) return 0;
    let hit = 0;
    for (const char of text) if (char === typed[hit]) hit++;
    return hit === typed.length ? 1 : -1;
  };
  return items.map((item) => [score(item.label), item]).filter(([points]) => points >= 0).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

/** A template as text at `indent`, with the [start, end] of each `${field}`. */
export function expand(template, indent) {
  let text = "";
  const stops = [];
  template.replaceAll("\n", "\n" + indent).split(/\$\{([^}]*)\}/).forEach((part, index) => {
    if (index % 2) stops.push([text.length, text.length + part.length]);
    text += part;
  });
  return {text, stops};
}

/** The text that Enter puts in after `line`, the text of the cursor's line before the cursor: the line's indent, and one level more after `{`. */
export const newLine = (line) => "\n" + /^[\t ]*/.exec(line)[0] + (/\{\s*$/.test(line) ? "\t" : "");

/**
 * The quote that closes a one-line string open at the end of `before`, the text before the cursor: `"`, or `"#` for a raw string;
 * "" when no string is open there, or the open one is a `"""` string, which may hold line breaks.
 */
export function openQuote(before, tokenize) {
  const last = tokenize(before).at(-1), open = last && /^(#*)("""|")/.exec(last.text);
  return open && open[2] === '"' && !closed(last.text) && !last.text.includes("\n") ? '"' + open[1] : "";
}

/** True when a `}` typed after `before`, the text before the cursor, closes a block on a line of its own: it then takes one level back. */
export const closesBlock = (before) => /(^|\n)[\t ]*\t$/.test(before);
