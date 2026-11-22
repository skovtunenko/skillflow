# SkillFlow grammar, format 1.0

A flow file is a KDL v2 document. Its nodes form the skeleton, which
`scripts/skillflow.mjs validate` checks. Quoted strings are prose: intent,
requirements, and nuances that you compare with the skill by reading.
[example.md](example.md) shows a complete file, and
[authoring.md](authoring.md) gives the intent test and the rules for writing
a flow.

## Nodes

| Node | Allowed in | Form | Meaning |
| --- | --- | --- | --- |
| `skillflow` | first node | `skillflow 1.0 [skill-version="…"] [skillflow-version="…"] [skill="…"]` | Format version, written exactly `1.0`; optional version stamps and path to the target skill (rule 11) |
| `context` | right after `skillflow 1.0`, optional | `context ["purpose"] { … }` | Facts about the whole skill |
| `input` | `context`, `step`, `decide`, `gate` | `input <name> "description"` | In `context`, what the skill takes at the start; in a node, what the skill asks the user for there (rule 5) |
| `output` | `context` | `output [<name>] "description"` | What the skill produces; a named output must exist at the end of the flow |
| `invariant` | `context` | `invariant [by=<who>] "rule"` | A rule that must hold during the flow; `by` says who keeps it (rule 10) |
| `phase` | top level, `phase`, `when` | `phase <name> ["prose"] { … }` | A group of steps |
| `step` | top level, `phase`, `when`, `on-fail` | `step <name> by=<who> ["prose"] [{ … }]` | One action |
| `decide` | top level, `phase`, `when`, `on-fail` | `decide <name> "question?" by=<who> ["prose"] { … }` | A fork of the path: at least one `when` holds a node or an `end` (rule 3) |
| `gate` | top level, `phase`, `when`, `on-fail` | `gate <name> "question?" ["prose"] [{ … }]` | A human approval checkpoint; `approved` and `revise` are implied |
| `when` | `decide`, `gate` | `when <outcome> "prose"` or `when <outcome> ["prose"] { … }` | One outcome of a branch; a bare `when <outcome>` is an error |
| `on-fail` | `step` | `on-fail ["prose"] [{ … }]` | What happens when the step fails |
| `end` | top level, `phase`, `when`, `on-fail` | `end ["reason"]` | Early exit where the flow stops; omit a closing top-level `end` (rule 3) |
| `tools` | `step`, `decide`, `gate` | `tools [(kind)]<tool> …` | Tools the node uses: MCP, CLI, web, and agent tools the skill names, such as a question tool; a kind is `(agent)` or `(mcp)` (rule 15) |
| `output` | `step`, `decide`, `gate`, `when`, `on-fail` | `output <data> "description"` | Data the node makes, written once where it first appears |

### Properties

A property is `key=value` after a node's arguments. No other properties exist;
`gate` takes only `ref`.

| Key | On | Value | Required |
| --- | --- | --- | --- |
| `skill-version` | `skillflow` | quoted string: the target skill's `metadata.version` at the last reverse or sync | no |
| `skillflow-version` | `skillflow` | quoted string: the SkillFlow version that did the last reverse or sync | no |
| `skill` | `skillflow` | quoted path from the flow file to the target skill folder; `--skill` overrides it | no |
| `by` | `step`, `decide`, `invariant` | `llm`, `code`, or `human` | yes on `step` and `decide`; no on `invariant` |
| `file` | `step` with `by=code` | quoted path to a script, relative to the target skill folder | no |
| `skill` | `step` | name of another skill that the step runs as a whole | no |
| `ref` | `phase`, `step`, `decide`, `gate`, `when`, `invariant`, `input`, `output` | quoted label that the target skill writes, such as `"S3"` or `"Checkpoint-2"` (rule 14) | no |

## Rules

1. **Executor.** `by=llm` is the model, subagents included. Use `by=llm`
   with `tools` for external tools (CLI, MCP, web, agent tools, or a named
   subagent `(agent)<name>`, rule 15). When the model runs a bundled script
   of the skill with chosen arguments or judges its output, write `by=llm`
   and name the script in the step's prose; omit `tools` unless an external
   tool is also used (never put an interpreter such as `node`, `bash`, or
   Python in `tools`). `by=code` is a bundled script (`file=`) or a fixed command whose
   result needs no judgment. `by=human` is the user deciding or acting.
2. **Order.** Sibling order is normative. Actions whose order does not matter
   go into the prose of one step.
3. **After a branch or a failure.** The flow continues with the node after
   the `decide` or `gate`, or after the failed step, unless the chosen `when` or the
   `on-fail` reaches `end`. The flow ends after its last top-level node
   automatically, so use `end` for early exits only; a closing top-level `end`
   gives a warning. A node after `end` in the same block never runs
   and is an error. A `decide` with exactly one `when` has an implied second
   outcome that continues after the `decide`, as a gate's implied `approved`
   does; the page labels it `no` for `when yes`, `yes` for `when no`, and
   `else` for `when other`, and `other` for any other word. A `decide` with two or more `when` has no
   implied outcome: its outcomes are all the answers. A `decide` is a fork of
   the path, whoever decides: at least one `when` holds a node or an `end`.
   No fork, no `decide`. When every answer continues the same way, an answer
   of the user is an `input` on the node that asks (rule 5), and a choice of
   the model or a script is prose of a step, with an `output` when a later
   node needs it. The validator warns on a `decide` that forks no path.
4. **Loops and retries** are prose inside a node.
5. **Data.** `input` and `output` have two forms. In `context`,
   `input <name> "description"` is data the flow takes and
   `output [<name>] "description"` is a result it gives; the description is a
   quoted string. A flow `input` is what the user gives when the skill
   starts. In a `step`, `decide`, `gate`, `when`, or `on-fail`,
   `output <name> "description"` is data that the skill produces there. In a
   `step`, `decide`, or `gate`, `input <name> "description"` is material that
   the skill asks the user for there (files, answers, facts): the skill acts,
   and the user's reply is new data from that node on. Both take one name per
   line, with only a `ref=` after it. Data is born once. Write the `output`
   or the node `input` only at the node where the data first appears, name it
   with the skill's own term, and say in the description what it is. Data
   that arrives in the middle of the flow is born at the node that gets it:
   an `input` where the skill asks the user for it, an `output` of a step
   with `tools` for data from a connector or an MCP server. A later change to that data,
   and what a node reads, are prose of that node, not data lines; only the
   node that delivers a named flow `output` writes that name again. Data
   produced inside one
   `when` reaches the nodes after the `decide` or `gate` only when every
   branch that continues produces it. An `on-fail` that continues counts as
   recovered: the step's data stays available, and data made only inside the
   `on-fail` stays there. An `output` in an `on-fail` names a named flow
   `output` that the recovery restores or replaces (a retry, a fallback, a
   backup); a step in the `on-fail` that outputs it restores it too. When a
   continuing `on-fail` does not restore a named flow `output` of its step,
   the validator warns: that result exists only when the step succeeds.
   Restore it with an `output`, or let the `on-fail` reach `end`. A named
   flow `output` must be available on every path that reaches
   the end of the flow; a path that stops at `end` needs
   none. A closing top-level `end` stops every path, so no named flow
   `output` leaves the flow: leave it out. A flow `input` of the same name is the state before the flow, so it
   does not count: a node must produce the result. List only data a reviewer would notice: a flow is read by a person,
   not run, so a data line that tells the reader nothing new is noise. The
   validator warns on a node `output` or `input` without a description, on
   an `output` of a name that exists already, and on a node `input` of a name
   that every path already has: that is a read, and reads are prose. A choice that a
   later branch needs is data of the decision: `decide mode … { output mode
   "the chosen mode" }`. An `output` inside a `when` is data that this
   outcome makes, available to the nodes in it and after it.
6. **Names** of `phase`, `step`, `decide`, and `gate` are bare words without spaces,
   unique in the file, in the target skill's language. People give names:
   keep every name they gave and propose names only for new nodes. When a
   name no longer fits its node, recommend a new one; the user decides.
7. **Nesting.** `step`, `decide`, `gate`, and any nested `phase` each add a
   level; a top-level `phase`, `when`, and `on-fail` do not, so top-level
   phases organize the flow without eating into the 3-level limit, and a
   step inside `on-fail` sits on its step's level. More than 3 levels gives
   a warning outside an `on-fail`. To stay shallow, leave the branch that
   continues out of a yes/no `decide` and put its nodes after the `decide`
   (rule 3).
8. **Files.** `file=` belongs only on a `by=code` step; its path is relative
   to the target skill folder and must exist. Name reference files that an
   LLM step reads, and scripts that it runs, in its prose.
9. **Other skills.** `skill=<name>` runs another skill in the same session.
   The flow does not describe that skill's steps; its instructions stay
   loaded for every node after it.
10. **Invariants.** An `invariant` says what may or may not happen during
    the flow, and when. A property of the result is not an invariant. `by=`
    says who keeps the rule: `by=code` when a script of the skill fails or
    blocks each time the rule is broken; `by=human` when a person checks the
    rule at a gate or in a step of their own; `by=llm` when the model's
    instructions alone keep the rule or a part of it. An invariant without
    `by` does not say who keeps it. The sentence of a `by=code` invariant
    names its script, and a flow with a `by=human` invariant has a gate or a
    `by=human` node: the validator warns when either is missing.
11. **Stamps.** Reverse and sync write the target skill's `metadata.version`
    as `skill-version`, when the skill has one, and the SkillFlow version
    that `validate` prints as `skillflow-version`. A hand edit changes
    neither. The validator warns when `skill-version` differs from the
    skill or has no skill folder to compare with, when it is missing although
    the skill has a version (except with `--draft`), and when
    `skillflow-version` is newer than the installed SkillFlow. A flow that
    is not next to its `SKILL.md` or one folder below it names the skill
    folder with `skill=`.
12. **Gate.** A `gate` is a human approval checkpoint, always `by=human`;
    `by=` on a gate is an error. Two outcomes are implied and never written:
    `approved` means the flow continues after the gate; `revise` means the
    person asks for changes, the work before the gate is redone, and the gate
    asks again (a loop, so prose by rule 4). When nobody can answer (a batch or
    subagent run), the flow stops and reports. `when <outcome>` adds outcomes,
    such as `when rejected { end "…" }`; a `when approved` or `when revise`
    overrides the implied one. A gate needs no `when`. It counts as a decision
    with executor human. Use `gate` to approve, `decide by=human` when
    the user's answer changes the path, and `input` when the answer is only a
    value (rule 3).
13. **Unclear places.** Mark each with a comment on its own line before the
    node it concerns: `// ? <what is unclear> (<file>:<line>, …)`. The
    validator counts these lines and the page shows them on the node.
14. **Skill labels.** `ref="<label>"` links an element to a label that the
    target skill writes, such as a step ID, a checkpoint, a rule ID, a mode, or
    a heading: `phase match ref="S3" "…" { … }`,
    `invariant ref="no_silent_drop" "…"`, `output matches ref="Match output"`.
    The element keeps its own name, and a ref is never a data name. A label is
    at a defining place when it starts a heading, the first cell of a table
    row, a list item, or a bold label at the start of a line; a quote marker,
    a list number such as `5.` or `3b.`, a checkbox, and emphasis may come
    before it. A list number alone (`13.`, "step 13") is never a label. The
    validator searches every Markdown file of the skill, in any folder, outside
    code fences (a fence tagged `markdown` or `md` counts). It ignores case
    and treats a space and a hyphen as equal, so `ref="S3"` matches neither
    `S30` nor `S3-B`. A ref may be the leading part of a long label, such as
    `"Opening a session"` for `## Opening a session — orient first`. The
    validator warns about a ref with no defining place and about a ref longer
    than 40 characters; one ref on two elements is an error. A label with
    several defining places is valid.
15. **Tool kinds.** A name in `tools` may carry its kind as a KDL type
    annotation: `tools (agent)reviewer (mcp)jira gh`. `(agent)` is a
    subagent: another model works in its own context, and only its result
    returns to the session. `(mcp)` is a tool of an MCP server or a
    connector: an external system. A CLI and a tool of the agent itself, such
    as a question tool, take no kind. An interpreter that runs a script of
    the skill, such as `node`, is not a tool. Write the kind at every use of the
    tool; the page shows each kind with its own glyph. No other type
    annotation exists. A brief that any subagent runs takes the brief's
    label: `tools (agent)D1`.

## Layout

`fmt` writes every flow file in one layout; run it, and do not lay out a flow
by hand. It changes the space at the start and the end of a line and the
blank lines. It never changes a word, a comment, or the order of the lines.

- Each level of nesting is one tab. A line that follows a `\` and the lines of
  a `"""` string are one tab deeper than their node.
- One blank line separates two nodes of a block when either of them has more
  than one line: a block, a `"""` string, or a comment above it. One-line
  nodes with no comment stay together.
- In `context`, one blank line separates the inputs, the outputs, and the
  invariants.
- One blank line follows the `skillflow` line.
- A comment directly above a node stays with that node. A comment with a blank
  line below it stays apart, with one blank line above and below it.
- No other blank line stays, and no line ends with a space. The text inside
  a `"""` string and inside a `/* */` comment stays as written, spaces at a
  line end included.
- Lines end with a line feed, and the file has no byte order mark.

`fmt` needs `{` at the end of its node's line and each `}` on its own line. A
block on one line, such as `{ on-fail { end "x" } }`, stays on its line. It
refuses a line that breaks this, and a `\` that nothing follows; the file
then stays as it is.

## KDL v2 primer

A flow file uses KDL 2.0.0 (<https://kdl.dev/spec/>, released 2024-12-21),
not KDL v1, YAML, or JSON. Write it from this primer, not from memory of v1.

- **Node.** A name, then arguments and `key=value` properties, then an
  optional `{ … }` block of child nodes:
  `step draft by=llm "Write the draft." { output draft "the first draft" }`.
- **End of node.** A newline, `;`, or the parent's `}` ends a node, so
  `phase p { step a by=llm; step b by=code }` is two children. A `\` at the end
  of a line continues the node on the next line.
- **Bare words.** A word without spaces or `(){}[]/\"#;=` is a string:
  `output draft`. It cannot start with a digit (`2nd-draft` is an error), and
  `true`, `false`, `null`, `inf`, `nan` must be quoted.
- **Type annotation.** `(word)` right before a value, with no space:
  `(agent)reviewer`. SkillFlow has it only on a name in `tools` (rule 15).
- **Keywords.** `#true`, `#false`, `#null`; a bare `true` is an error.
- **Quoted strings.** `"…"` for text with spaces. Escapes: `\n \t \\ \" \s`
  and `\u{…}`; any other `\x` is an error.
- **Multi-line strings.** Open with `"""` and a line break; close with `"""`
  on its own line. The closing line's indent is removed from every line.
  `"""text"""` on one line is an error.
- **Raw strings.** `#"text with "quotes""#`, with no escapes.
- **Indentation.** One tab for each level, never spaces; the page shows a
  tab 4 columns wide. Inside a multi-line string, the lines start with the
  same tabs as its closing `"""`.
- **Comments.** `//` to the end of the line, `/* … */` inline, and `/-` before
  a node comments out the whole node.
