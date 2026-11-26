# Writing a SkillFlow flow

This file holds the intent test and the rules for writing a flow. Reverse,
author, check, and sync use them. [grammar.md](grammar.md) defines every
construct; a rule number here, such as rule 3, is a rule of grammar.md.

## Contents

- [The intent test](#the-intent-test)
- [Writing a flow](#writing-a-flow): granularity, order, labels, coverage, what
  the human does, skipping a gate, an ask with no fixed place, rules with
  exceptions, prose

## The intent test

A fact belongs in the skeleton only when a reviewer or the skill's user would
notice its change in the result or in the dialogue. Every such fact must be in
the skeleton. Everything else is prose or stays only in the skill.

## Writing a flow

- **Granularity.** Add a node only where the executor changes, a dialogue
  point or a branch starts, or data a reviewer would notice appears. Data a
  reviewer would notice is data the user sees, a named `output`, or data that
  a later `decide` or `gate` reads. "LLM prepares, human confirms" is
  `step by=llm` and then a `gate`.
  A mapping table stays prose in the step that uses it; a rule list that sends
  each item to one of several places is a mapping table, not a `decide`. A
  `decide` is one choice per run; a flag set from facts already known is an
  `output` of the step that knows them. A step's fallback is its `catch`.
  Consecutive `by=llm` actions stay one step unless data a reviewer would
  notice lies between them. A script of the skill is a `step by=code
  file="scripts/x.py"` when it is a fixed command whose result needs no
  judgment, and a `step by=llm` whose prose names `scripts/x.py` when the
  model chooses its arguments or judges its result. `tools` names an external
  tool, never the interpreter (`node`, `bash`, Python) that runs the script.
  Small actions stay prose of the node they belong to:
  - a note that a gate or step was skipped is prose of its branch;
  - a content variant of one gate is the gate's prose;
  - one review round (show, take feedback, apply it, ask again) is the gate's
    prose, with its actions as a list; material taken inside the round stays
    there too;
  - a `when` holds a node only when that outcome does work of its own: it
    waits for the human, or makes data with its own step. An outcome that
    only marks data is `when <outcome> { output … }`. An outcome that does
    nothing is left out when it is the second outcome of a yes/no `decide`
    (rule 3); otherwise it is `when <outcome> "why nothing happens"`. A bare
    `when <outcome>` is an error.
- **Order.** Take node order from the step-by-step text the agent follows.
  Where the text gives no order, write one step with prose. Where it
  contradicts a contract, keep the text's order and add a ❓. A question the
  skill may ask at any time goes where its data first exists, with a ❓.
  A check that the skill runs "before the first X" is a step right before the
  first node that does X. When its failure stops the flow, what the user is
  told is the `end` reason, not a `step by=human`.
- **Labels.** Give an element a `ref` only when the skill writes a label for
  that same part at a defining place (rule 14). Copy the label; never make one
  up, and never use an ordinary word that only starts a line. For a long label,
  use its shortest leading part that names it, such as the ID before ` — `.
  One label goes on one element. Keep every ref that the flow already has.
- **Coverage.** Every parameter the skill takes from the user at the start is
  a flow `input`. Every point where the skill, or a file it sends the agent
  to, asks the user is a node; material it asks for there is that node's
  `input`. Every rule that limits what may happen during the flow and passes
  the intent test is an `invariant`; a rule about the result is not one: it
  stays in the skill, and the node that makes the result names its intent in a
  few words. Give each `invariant` its `by=` (rule 10): `by=code` rests
  on a script line that fails or blocks on the broken rule, and its sentence names that script; `by=human` rests on a
  gate or a human step that checks it; every other rule is `by=llm`. Every early exit is an `end`. A state the skill keeps
  between steps or runs (a flag, a record, a file) and never clears is an
  improvement for the skill, not a ❓. Every file that a script of the skill writes is an `output` of the step that
  first writes it. An instruction to copy a checklist into the task list is
  prose of the phase or step it covers, with the checklist's name.
  A condition that changes the form of the result (an empty or no-change
  result, a mode without a missing tool, a confirmed finding that stays
  against a failed check) is not a detail: name the condition and the form in
  the prose of the node that makes the result, or in the `catch` item when
  a failure is the cause.
- **What the human does.** The flow waits for the human in three shapes:
  - approval of content the flow has shown: a `gate`;
  - an answer that changes the path, so that at least one answer leads to
    other nodes or to `end`: a `decide by=human`. When a later node also
    needs the answer as a value, add an `output` to the `decide`;
  - material the skill asks the human for (answers, files, questions,
    missing facts), or a choice between values after which the flow
    continues the same way: an `input` with a description in the node where
    the skill asks, usually a `step by=llm`. For a choice, the description
    names the values and what each one means. The skill is the actor and the
    human replies, so this is not a `step by=human`.

  One test separates the last two: does any answer lead to other nodes or to
  `end`? Named values plus a value of the user's own follow the same test;
  the user's own text is an `input` in the same node.

  A `step by=human` is work the human does on their own, outside an ask of
  the skill, such as a commit and push by hand.

  An offer the user may take up later is prose. An ask inside a failure item
  ("ask for a path", "request a path", "have the user name it") stays an ask
  of the user, not the agent's choice; when the skill does not say who acts,
  add a ❓.
- **Skipping a gate.** The skill's general rule for when a gate may be
  skipped is one `invariant` and adds no node. A `decide by=llm` before a gate,
  with the gate in one `when`, appears only when the skill names a fact test
  for that gate, such as "the interviewer supplied the whole structure". A
  skip question that the skill gives only as an example, with no fixed place,
  stays in the gate's prose with a ❓.
- **An ask or a request with no fixed place.** The skill's rule on when it
  may ask the user is one `invariant` and adds no node. An ask or a user
  request that can happen at more than one point gets one node at the first
  point where it can happen, when the skill names its condition ("where the
  UI is unknown", "when the user requests a permanent fix"); the node's prose
  says that it can happen later too. That is not an unclear place. Add a ❓
  only when the skill does not name the condition, does not say what follows
  the answer, or allows an ask that its own rule on asking forbids.
- **Rules with exceptions.** A never, only, before, or except rule of the
  skill becomes an `invariant` only when it limits the flow as a whole and a
  reviewer needs it to judge the flow. Write it in one sentence, merge rules
  that say one thing, and leave the exceptions in the skill. A rule about one
  step is a few words of that step's prose. A step that guards a write (a
  registration, a check, a backup) comes before the step that writes.
  Each cause of failure that the skill handles differently gets its own
  `catch` prose; name where the flow goes next. A rule that the skill gives
  for every failure (what to report, what to stop, what to mark), and a
  failure that several steps handle the same way (one error of a script that
  many steps run), is one `invariant` with its conditions, such as "when the
  documented diagnostics do not resolve it"; name the script in it. Do not
  repeat that handling in the `catch` of each step: a `catch` holds only
  the failures that are its step's own, and a step with none has no
  `catch`. The validator warns when three or more `catch` blocks hold
  only an `end` with the same reason. A `step` inside `catch`
  appears only for work by another executor or an ask of the human, never to
  hold failure prose. The `rules` failure lines
  of a script that a step runs, and an unavailable tool the step uses, are
  covered by that step's `catch` or by such an `invariant`: one sentence for the failures that go to
  the same place, and an item for each one whose next node or `end` differs.
  "Report the blocker" alone names no target: add "then continue" or "then
  end"; when the skill does not say which, add a ❓. This covers each step that runs a
  script, whatever its executor and also when the script
  appears only in its prose. Copy every condition of an exit into its item. When
  every item stops the flow, the `catch` holds an `end`. When some items
  continue and others stop, the `catch` holds a `decide` on the condition
  that separates them, with an `end` in the `when` of each item that stops;
  the items that continue stay prose:
  `catch "Bun is missing." { decide sandbox "Is this a cloud sandbox?"
  by=llm { when no { end "ask the user to install Bun" } } }`. A failure of an action inside a gate's review round is an item of the
  gate's prose list instead.
- **Prose.** Write prose in ASD-STE100 with given-new flow (topic sentence
  first, every term defined before use, every logical link written as a
  word), unless the user named another style. A flow is a short view of the
  skill that a person reviews in minutes, not a second copy of it. Say the
  intent of a node in one sentence, two at most (200 characters), or in one
  list of at most five items when a node holds several small actions. A
  detail, a condition list, a file format, and a rule about the result stay
  in the skill; `ref=` points the reader to them. The validator warns above
  these limits, and also when the flow file without its `// ?` lines is more than half
  the size of `SKILL.md` plus the Markdown files it names. A person may write longer multi-line prose on purpose; the
  warning then stays as a note. A multi-line `"""` string takes a small Markdown subset that the page
  shows: paragraphs split by a blank line; list items that start with `-`,
  `*`, `+`, `1.`, or `1)`; a list inside an item, written with a deeper
  indent; `` `code` ``, `**bold**`, and `*italic*`. No other Markdown is
  shown: a heading, a link, and a table stay plain text.
