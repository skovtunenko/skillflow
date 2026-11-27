# SkillFlow help

Use this page to answer "how do I use SkillFlow", "what can it do", or "how do
I write a flow file". Explain in the user's conversation language; keep code,
node names, and commands as written here. Answer the question asked: give the
overview for a general question, the lesson for "how do I write one", and the
error table for a validator message.

## Contents

- [What it is](#what-it-is)
- [Modes and phrases](#modes-and-phrases)
- [Run it yourself](#run-it-yourself): `skillflowctl` for a person, and the browser editor
- [Script commands](#script-commands): what each command and the rendered page do
- [Lesson: write your first flow](#lesson-write-your-first-flow)
- [Patterns](#patterns)
- [What goes into the skeleton](#what-goes-into-the-skeleton)
- [Common validator messages](#common-validator-messages)

## What it is

SkillFlow keeps one flow file (`<skill>.kdl`) per skill: a short, checkable description of the
skill's workflow that a developer and a domain expert can review in minutes.
The flow file is the specification; the skill implements it.

## Modes and phrases

| Say | SkillFlow does | You get |
| --- | --- | --- |
| `skillflow reverse` | reads an existing skill and writes its flow as it works now | the flow file, a list of unclear places, improvement ideas |
| `skillflow author` | drafts or edits a flow with you from documents and answers | the flow file you accepted |
| `skillflow check` | compares the flow with the skill; changes nothing | ✅ / ❌ / ❓ report with evidence |
| `skillflow sync` | applies check results; asks which side wins per item | edits to the flow file or the skill |
| `skillflow explain` | explains the flow; renders it as a page; compares versions | explanation, HTML page, semantic diff |
| `skillflow help` | this page | — |

After an agent changes a skill that has a flow file, it runs check on its own
and offers sync.

## Run it yourself

The file `skillflowctl` next to SkillFlow's `SKILL.md` runs the script for a
person at a terminal, with no agent. Give the user its full path, for example
`<skills-folder>/skillflow/skillflowctl`.

```bash
<skillflow-dir>/skillflowctl page <skill>   # format, validate, write the page; prints its path
<skillflow-dir>/skillflowctl lint <skill>   # check the format and validate; writes nothing
<skillflow-dir>/skillflowctl edit <skill>   # edit the flow in the browser; the graph follows the text
<skillflow-dir>/skillflowctl                # in a terminal: a menu of the flows, then page, lint, or edit
<skillflow-dir>/skillflowctl help           # every command, with examples from this repository
```

`<skill>` is a flow file, a folder with one flow file, or a skill name. A flow
file is a `.kdl` file whose first line starts with `skillflow`; its file name
is free. For a name, the script searches from the git root the files that git
does not ignore, and finds the skill folder with the same name. When a name
matches two flows, it lists them: pass one path. The menu shows each flow
with its status and remembers the last choice; Enter takes it. To quit the
menu, type `q` or press Ctrl+C or Ctrl+D. An unknown
command gets the nearest command name. On "permission denied", run
`sh <skillflow-dir>/skillflowctl`. On Windows, run `skillflowctl.cmd` from the same
folder with the same commands.

### Edit a flow in the browser

`edit <skill>` starts a server on this computer only (`127.0.0.1`, a free
port, a secret token in the address), prints the address, and opens it when
it runs in a terminal. It serves until Ctrl+C.

The page is the same page that `page` writes, with one more part: the Source
view has two modes.

- **Read and Edit.** `Edit` shows the editor of the flow file. `Read` shows
  the flow as the graph shows it, with line comments as in a rendered page.
  The page opens in `Edit`. In `Read`, a note says when the text is not
  saved, or when the editor's text has errors and the view shows the last
  valid text; a press on the note goes to the editor.
- **Layout.** The header has the tabs Graph, Source, and Help, and the
  **Layout** button, as on a rendered page. The page opens with Graph beside
  Source. The browser remembers the layout for the next editor.
- **Live check.** The page runs SkillFlow's own validator, renderer, and
  formatter on each change, and draws each valid text in place: the zoom,
  the selected card, and the comments stay. Each problem shows at its line
  and in the Problems list. While the text has errors, the graph shows the
  last valid text with a notice, and the header shows the error count. A
  press on the notice or on the count goes to the next problem.
- **Problems.** F8 goes to the next problem and Shift+F8 to the one before
  it (Alt+. and Alt+, do the same), and so do the two arrow buttons of the
  Problems bar. The list marks the problem at the cursor and shows its
  place (`3 of 15`). In the list, the arrow keys move from row to row and
  the text follows. The ruler at the right of the text is a map of the whole
  text: a mark for each problem line, with its messages as a tooltip, and a
  shade for the part in view. A click on a mark goes to that line. The
  `Problems` button folds the list to its bar.
- **Save.** Save (Ctrl+S or ⌘S) writes the flow file. The server writes no
  other file. `Export review page` in the header saves the page of the last
  valid text, without the editor.
- **Changes from another program.** Without unsaved edits, the page loads the
  new text. With unsaved edits, Save is refused: the page shows both versions
  with the lines that differ, and the person keeps one.
- **Links.** The cursor line rings its card, and a click on a card moves the
  cursor to its line. After a redraw, a new card flashes green and a changed
  card amber.
- **Details panel.** On a wide screen the button at the end of the panel's
  head hides it, and the same button in the top corner of the graph brings
  it back; a rendered page has the same two buttons. Beside the editor the
  panel starts hidden.
- **Tooltips.** Each control says what it does when the pointer rests on
  it, and on keyboard focus. Escape closes the tooltip.
- **Suggestions.** The editor shows a list of what fits at the cursor: the
  nodes of the parent, the properties of the node, the values of `by=`, the
  skill's files for `file=`, and the tool names of the text. A typed word
  opens the list with its first item selected: Enter or Tab inserts it, and
  Tab then goes from field to field of an inserted node. An empty place
  opens the list with nothing selected: Enter and Tab edit the text, and the
  Down arrow goes into the list. Tab after a word completes it. Alt+Down,
  Ctrl+Space, and `Suggest` open the list; Escape closes it. `As you type`
  off: the list opens only by these keys and by `Suggest`. The fields of an
  inserted node are marked in the text: a frame on the field to fill, a
  dashed frame on each next one, and a count such as `1/2` where Tab goes on.
  Escape or a press in the text ends the fields.
- **Indent.** Enter keeps the indent of its line and adds one level after
  `{`. A `}` on a line of its own takes one level back. The `·→` button
  shows each space as a dot and each tab as an arrow.
- **Draft.** A text that only lacks parts which a finished flow needs (for
  example `by=` of a step) is drawn as a draft, as `--draft` does: the graph
  shows it, and each missing part is a to-do in the Problems list.
- **History.** The editor's bar holds the edits of this visit: a slider, and
  a button for the edit before and the edit after. A run of typing with
  pauses under one second is one edit. The history is an undo line: a new
  edit at an earlier place replaces the later edits, and a message says how
  many. The browser's Undo takes a step of the history back and replaces
  none. A text that comes from the disk goes after the last edit and
  replaces none. The history holds 400 edits and ends with the visit.
- **Also.** Format (the `fmt` command). The browser's Undo and Redo work in
  the text.

When the server stops, the text stays in the page. Then Save writes to a file
that the person links in the browser's file dialog (Chrome and Edge), or
downloads the flow (other browsers). `edit <skill> --offline <page.html>`
writes the same editor as one offline page with no server; the page must be
outside the skill folder, because it holds a copy of the skill's files.

## Script commands

```bash
node <skillflow-dir>/scripts/skillflow.mjs validate <flow.kdl> [--skill <target-skill-dir>] [--draft]
node <skillflow-dir>/scripts/skillflow.mjs render <flow.kdl> [-o <page.html>] [--skill <target-skill-dir>] [--draft]
node <skillflow-dir>/scripts/skillflow.mjs fmt <flow.kdl> [--check]
node <skillflow-dir>/scripts/skillflow.mjs map <target-skill-dir>
node <skillflow-dir>/scripts/skillflow.mjs rules <target-skill-dir>
```

`node <skillflow-dir>/scripts/skillflow.mjs --help` lists the commands, flags,
and exit codes; `<command> --help` shows one command.
`validate` checks the file and prints each problem with its line and a hint.
Its first line is `OK` or `FAIL`, the flow file, and the counts of errors,
`todo` items, and warnings; its summary line ends with `refs <found>/<total>`
when the flow has `ref=` labels. Its `invariants:` line counts the invariants
by who keeps them; `unstated` ones have no `by`.
`fmt` rewrites the flow file in the one SkillFlow layout: one tab for each
level, and the same blank lines in every flow (grammar.md, Layout). It changes
no word. `fmt --check` writes nothing and exits 1 when the file is not
formatted.
When the flow file does not sit next to the skill's `SKILL.md` or one folder
below it, pass `--skill` or write `skill="<path>"` on its first line, so
`file=` paths and `ref=` labels can be checked.
`--draft` is for a sketch: what a finished flow needs and a draft may leave
out (an executor, a question, prose, a sentence, a script, a data path) is a
`todo` line instead of an error, and the last line, `next:`, says what is left.
`render --draft` then draws the page, with the gaps in its header. Run
`validate` without `--draft` before check or sync.
`render` writes one offline interactive HTML page: graph, source with a Copy
button, and help. A reviewer can open a card or an invariant on the page and
add, edit, resolve, reopen, or delete comments: a tag (Wrong, Confusing,
Missing, Simplify, Remove), words, or both. Each comment keeps the UTC times
when it was added, last changed, and resolved; the page shows them in local
time. In the Source view, a click on a line number (a drag or Shift+click for
a range), the button at a text selection, or the key C comments on lines of
the flow file; the comment also shows on the card that owns the first line.
The Source toolbar shows the blocks around the top line and steps through the
commented lines (N and P); a folded block says how many lines and comments it
hides. After a new render, the page finds each
line comment again inside that card and marks it moved, changed, or lost; it
never moves a comment to the same text in another card while its card exists. **Save** writes the
page with its comments to an HTML file; after the first save, it saves to the
same file after each change while the tab stays open, and the status beside
the button always shows whether the file is current. A saved page opens with
exactly the comments saved in it, on any computer; comments that only the
browser keeps are offered, never shown on their own. **Review** in the
header lists the comments, grouped by place, with an Open / Resolved / All
switch and a tag filter; its copy button copies one instruction that lists
each open comment with its node or lines, tags, status, and creation time; the toast offers **Show text**. Paste it to the agent: it runs
`skillflow check` for those places and offers `skillflow sync`. **Delete all**
clears the comments after a confirmation. The page does not change the flow
file, and `render` does not overwrite a page that holds saved comments.
**Route**, the line above the graph, shows each top-level phase, and each
run of cards between phases, as a numbered stop with its executor mix, the
times it asks the user, whether the flow can stop there, and its open
comments. The stop in view is filled. A click on a stop moves the graph to
it, lights its cards, and lists its cards, data, ends, and rules. The page
builds the route from the flow file alone. When stops are past an edge, an
arrow at that edge moves the line.
**Layout**, the button beside the Graph, Source, and Help tabs, shows a picture
of the layout and opens a picker: Graph, Source, or both, side by side or one
above the other, in either order. A tab shows its view alone. With both views
in view, a drag moves the divider with the pointer; the arrow keys, Home, and
End move it too, and a double click gives the first sizes back. Its two buttons
show while the pointer is on the divider or the divider has focus; they swap the
views (⇅) and turn the split (↻). Only a click acts. On a phone the picker is a sheet at the bottom,
and the two views are one above the other. The browser remembers the layout.
**Scenario**, first in the graph toolbar and at the top of the overview,
shows one run of the flow as a numbered list, grouped by Route stop under the
stop number and name. Each decision, gate, and step
with a `catch` on the run offers its outcomes; the default is the first
outcome that goes on. Each outcome names the next card of its run and says
how the run changes, for example `−2, ends early`. Only a click
acts: a pick says the new count in a toast with Undo, and **Reset answers**
goes back to the default answers. A click on a card off the run opens its
panel, which names the answers that lead to the card; **Run through this
card** picks them. Above the list, a strip shows each step of the run as
one segment coloured by who acts, with a gap between Route stops; one line
counts the steps, the times the skill asks the user, and the repeats from
`revise`, and says where the run ends. The arrows beside it, a segment, or the
keys N and P move to the next or the previous step, and the graph centers on
its card. The graph
numbers the run, draws its edges in the accent colour, and dims the rest; a
click on an outcome label in the graph picks it. The address keeps the picks:
`page.html#scenario=mode=build,approve=revise` opens Scenario with `build` at
`mode` and `revise` at `approve`, so you can send one run.
The graph toolbar keeps one row: the groups that do not fit move, from the
end, into **⋯** (More). The zoom controls sit under the minimap in the
bottom-right corner of the canvas, and stay there on a phone.
A click on a data item highlights the cards that make it (`output`), that ask
for it (`input`), and, with a dashed ring, the cards whose prose names it
(`mentions`). A card names a data item when its prose holds the name as a
whole word, in any case, with an English plural `s` or `es`; a `-` in the name
also matches a space. A match inside a longer word, a path, or a file name
does not count. The render finds these with a fixed rule, with no model, so
the same flow file always gives the same page. The data panel lists the cards
in flow order with their role, and quotes the place where a card names the
data. The chip under the toolbar counts the cards for each role; its arrows
center the next or the previous card. **Trace** in the toolbar searches the
data, the tools, and the rules in one list. Overview says under each input and output which cards
make it, ask for it, and name it, and numbers the invariants with the cards
they name. A card's panel lists the invariants that name it and the data its
prose names. On a screen with a pointer, a pointer on a row or chip in the
panel previews its highlight in the graph. The keyboard button at the top
right, or the key `?`, opens the keyboard shortcuts, with the group of the
current view first; while the card is open, a key lights its row and runs
nothing. **Failures** shows how many
short `catch` lines it can draw as cards of their own: one with prose only,
or one whose only card is an `end`, which the step's card shows as a stop.
In Source, a string or a comment of several lines, and a run of three or more
`//` lines, folds to its first line; **Fold prose** folds all of them, so the
flow reads as its nodes alone. **Fold** and **Unfold** move one nesting level,
as a step of **Depth** does in the graph; Shift-click folds or unfolds all.
**Depth** in the graph toolbar has a button for each fold depth: 1 folds every
phase and branch, and the last one opens all.
**Save as PDF** in the graph toolbar opens the print dialog; the print holds
the whole graph on one page in the light theme, folded and highlighted as on
the screen. One page needs a browser that honours the CSS page size, such as
Chrome.
`map` lists a skill's files for reading.
`rules` lists rule lines, script failure messages with their conditions, and script file writes for the reverse inventory.

## Lesson: write your first flow

Build a flow for an imagined skill `release-notes` in seven small steps. Run
`validate` after each one. The finished file is in [example.md](example.md);
every construct is defined in [grammar.md](grammar.md).

1. **Header.** The first line names the format version.

   ```kdl
   skillflow 1.0
   ```

2. **Context.** Say what the skill takes, what it gives, and the rules that
   hold for the whole flow. Inputs get names so steps can use them. `by=` on
   an invariant says who keeps the rule: a script (`code`), a person
   (`human`), or only the model's instructions (`llm`).

   ```kdl
   context {
       input tag "the git tag to describe"
       output "a new section in CHANGELOG.md"
       invariant by=human "nothing is published without the user's approval"
   }
   ```

3. **Phases and steps.** A phase groups steps; order is the order of
   execution. Every step says who acts: `by=llm`, `by=code`, or `by=human`.

   ```kdl
   phase gather {
       step collect-changes by=code
   }
   phase write {
       step draft by=llm "Group the changes by type."
   }
   ```

4. **Data.** Name only the data a reviewer cares about. Data is born once:
   write `output <name> "what it is"` at the node where it first appears.
   When the skill asks the user for material mid-flow, the node that asks
   names it: `input <name> "what it is"`. What a node reads is in its prose.

   ```kdl
   step collect-changes by=code "Collect the changes since the tag." {
       output changes "the commits and pull requests since the last tag"
   }
   step draft by=llm "Group the changes by type." {
       output draft "the release notes before approval"
   }
   ```

   A later change to the data is prose of the node that changes it. Name a
   final result with `output <name> "…"` in the context, and produce it on
   every path that reaches the end of the flow.

5. **Decisions and gates.** A branch is a `decide` with a name, a question,
   who decides, and one `when` per answer. Outcomes are any short words
   (`when keepalive`, `when resume-only`). After the branch the flow
   continues, unless the answer leads to `end`. With one `when`, the other
   answer is implied and continues after the branch; the page labels it
   (`no` for `when yes`, `else` for `when other`, otherwise `other`). An outcome that does nothing
   among several gets prose: `when skip "nothing to fix"`.

   ```kdl
   decide kind "Is the change a feature?" by=llm {
       when yes {
           end "features go through another process"
       }
   }
   ```

   An approval checkpoint for a person is a `gate`: a name, a question, no
   `by=`. Its outcomes `approved` (continue) and `revise` (redo the work
   before it, then ask again) are implied. Add `when` only for other outcomes.

   ```kdl
   gate approved "Did the user approve the draft?" {
       when rejected {
           end "the user stopped without approval"
       }
   }
   ```

6. **Failures.** `catch` sits inside the step that can fail.

   ```kdl
   step publish by=code {
       catch {
           end "show the error; CHANGELOG.md stays unchanged"
       }
   }
   ```

   A retry is prose only: `catch "fix the reported lines and run again"`.
   When the recovery restores the step's data, say so with `output`:
   `catch "retry twice, then use the cached report" { output report }`.

7. **Unclear places.** When the skill is ambiguous, say so on the line before
   the node: `// ? how many revision rounds are allowed (SKILL.md:24)`.
   Write a plain `?`: the page draws it as ❓, and a copy keeps the `?`.

Then render the page and read it as a reviewer would.

## Patterns

- **Several entry points or modes.** Start the flow with one top-level
  `decide` and put each entry's steps in its `when`; when a later branch needs
  the choice, the decision has `output mode "…"`.
  SkillFlow's own `flow.kdl` works this way.
- **A recurring run** (cron, a scheduled turn) is one phase whose prose says
  when it runs; an `end` inside it ends that run.
- **A gate that repeats until the user agrees** is a `gate`; its implied
  `revise` outcome is the repeat. A user's answer that changes the path is `decide by=human`; an answer that is only a value is an `input`.
- **A skill that names its parts** (`S3`, `Checkpoint-2`, a rule ID, a mode):
  add `ref="<label>"` to the element for that part, such as
  `gate match-review ref="Checkpoint-2" "…?"`. The node keeps a readable name;
  validate and check find the label in the skill.

## What goes into the skeleton

A fact becomes a node only when a reviewer or the skill's user would notice
its change in the result or in the dialogue. Loops and retries stay in prose.
Keep each node's prose to its intent: one sentence, two at most (200
characters), or one list of at most five items.

## Common validator messages

| Message starts with | Fix |
| --- | --- |
| `Invalid keyword` | KDL v2 writes `#true`, `#false`, `#null` |
| `Unexpected token` at a `{` or `}` | a `{` stays on its node's line, also after a closing `"""`; a `}` needs its `{` |
| `the file must start with` / `format version` | first line exactly `skillflow 1.0` |
| `… needs a name` / `contains spaces` | add a bare-word name: `step draft-notes`, `decide approved "…?"` |
| `… is not allowed` | move the node; the hint lists what fits there |
| `flow output … is not produced on every path` | add `output` on every path that reaches the end, or drop the name |
| `the description of …` / `a flow input needs` | write `input <name> "description"` with quotes |
| `when … has no prose and no block` | delete the second outcome of a yes/no `decide` (it is implied), or add prose saying why the outcome does nothing |
| `… never runs` | a node follows `end` in the same block; move it or the `end` |
| `closing top-level end is unnecessary` (warning) | drop the trailing `end`: the flow ends after its last node anyway; keep `end` for early exits |
| `… is not a tool kind` | a name in `tools` takes `(agent)` for a subagent or `(mcp)` for a tool of an MCP server; any other tool takes none |
| `tool … has another kind here than at its first use` | write the same kind before every use of that tool |
| `… in tools is an interpreter, not a tool` (warning) | remove it from `tools`; name the script in the step's prose, or write a fixed command as `step by=code file="scripts/x.py"` |
| `tools … and … differ only in letter case` (warning) | write one spelling at every use of the tool |
| `type annotation … is not part of SkillFlow` | remove the `( )`; only a name in `tools` takes one |
| `file= is only for code steps` | name reference files in the step's prose |
| `… needs an executor` | add `by=llm`, `by=code`, or `by=human` |
| `invariant has by=…` | write `by=code`, `by=human`, or `by=llm`: who keeps the rule; or drop `by` |
| `invariant has by=code, but its sentence names no script` (warning) | name the script that fails or blocks on the broken rule, such as `scripts/check.py`; or write `by=llm` or `by=human` |
| `invariant has by=human, but the flow has no gate and no by=human node` (warning) | add the gate or the `by=human` step where a person checks the rule; or write `by=llm` |
| `fmt cannot place this line` | write `{` at the end of its node's line and each `}` on its own line, or remove a `\` that nothing follows; then run `fmt` again |
| `use-when is no longer part of SkillFlow` | delete the line: the target skill's description says when the skill runs |
| `next: … todo item` (with `--draft`) | each `todo` line is a gap that is an error without `--draft`: fill each one, then run `validate` without `--draft` |
| `… does not exist in` | fix the `file=` path or add the script |
| `cannot check file= paths` / `next: the target skill folder is unknown` | pass `--skill <skill folder>`, or write `skill="<path>"` on the first line |
| `… names no folder with SKILL.md` | write the path from the flow file to the target skill folder, or pass `--skill` |
| `the flow has no skill-version` (warning) | run check, then sync: sync writes the stamps |
| `cannot compare skill-version` (warning) | pass `--skill`, or write `skill="<path>"` on the first line |
| `the flow was checked with SkillFlow … newer than the installed` (warning) | update SkillFlow to that version or later |
| `… has no description` (warning) | say what the data is where it first appears: `output <name> "…"` or `input <name> "…"` |
| `output … exists already: an update is not written` (warning) | drop the line and say the change in the node's prose |
| `decide forks no path: no when holds a node or an end` (warning) | a `decide` is a fork of the path; write a user's answer as `input <name> "…"` on the node that asks, and a choice of the model or a script as prose of a step |
| `input … exists already: reading is prose` (warning) | drop the line and say in the node's prose what it reads; a node `input` names only what the skill asks the user for |
| `the flow without its` … `lines has` … `characters; the limit is` (warning) | cut about the number of characters it gives, starting with the longest prose its hint names; keep each node's intent, details stay in the skill |
| `prose of … is long` (warning) | keep the intent; leave details and result rules in the skill |
| `… has failure messages, but the step has no catch` (warning) | add a `catch` item for each failure the skill handles, with its next node or `end`; a failure that several steps share is one `invariant` that names the script |
| `… catch blocks … end the flow with the same reason` (warning) | write one `invariant` that says where this failure goes and names the scripts in the hint, then delete those `catch` blocks |
| `catch holds an end, but its prose says the flow continues` (warning) | put the `end` in a `decide` on the condition that separates stopping items from continuing ones |
| `every item of catch stops the flow, but it holds no end` (warning) | add `end "reason"` inside the `catch` |
| `… exists only when step … succeeds` (warning) | the `catch` continues without that data: add `output <name>` to it when the recovery restores the data, or `end` it |
| `ref … is already used` | one skill label links one element: keep it on the element that matches the label |
| `ref must be a quoted label` | write `ref="S3"` with quotes, on one line |
| `ref … has no defining place in the skill` (warning) | copy the label as the skill writes it at a heading, a first table cell, a list item, or a bold label; or drop the ref |
| `ref … is long` (warning) | use the label's leading part, such as the ID before ` — ` |
| ``a `// ?` mark after a node on the same line is not counted`` (warning) | move the mark to its own line directly above the node |
