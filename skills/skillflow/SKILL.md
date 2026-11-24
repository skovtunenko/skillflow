---
name: skillflow
description: Use when the user says "skillflow", "skillflow help", "skillflow reverse", "skillflow author", "skillflow check", "skillflow sync", or "skillflow explain", or when you change a skill whose folder has a flow file (flow.kdl or <skill>.kdl).
metadata:
  version: "2026.11.24.1"
---

# SkillFlow

A **flow file** (`<skill-name>.kdl`, written in the KDL 2.0.0 document language, not
KDL v1) describes one target skill's high-level workflow so a person can
review it in minutes. Its nodes are the **skeleton**:
phases, steps, decisions, who acts (`llm`, `code`, `human`), data, invariants,
and exits. Its quoted strings are **prose**: the intent of each node. The flow
file is the specification; the skill implements it. The bundled script checks
the skeleton; you compare the prose with the skill and make the edits a script
cannot make.

Before reverse, author, check, or sync, read [grammar.md](references/grammar.md)
(constructs and KDL v2 primer) and [authoring.md](references/authoring.md)
(the intent test and writing rules). `help` and `explain` do not need them.

## Script

`<skill-dir>` is the folder of this `SKILL.md` (requires Node.js 22+, no packages, no network):

```bash
node <skill-dir>/scripts/skillflow.mjs validate <flow.kdl> [--skill <target-skill-dir>] [--draft]
node <skill-dir>/scripts/skillflow.mjs render <flow.kdl> [-o <page.html>] [--skill <target-skill-dir>] [--draft]
node <skill-dir>/scripts/skillflow.mjs fmt <flow.kdl> [--check]
node <skill-dir>/scripts/skillflow.mjs map <target-skill-dir>
node <skill-dir>/scripts/skillflow.mjs rules <target-skill-dir>
```

Run `--help` or `<command> --help` for full flags and exit codes. Agent rules:

- **Human CLI (`skillflowctl` / `skillflowctl.cmd`).** Gives a person `page`, `lint`, `edit` (serves a live browser editor until stopped — hand it to the user, do not run it as an agent), and a terminal menu. In help mode, give the user `skillflowctl` commands; use `node <skill-dir>/scripts/skillflow.mjs` for your own runs.
- **`validate`.** Prints `OK`/`FAIL` with error, `todo`, and warning counts (`OK` with warnings is not done in reverse), `versions:`, and `invariants:` (by keeper; `unstated` has no `by`). Resolves the target skill from `--skill`, `skill="<path>"`, beside/above the flow file, or a unique name match in the repo, and checks `file=` paths and `ref=` defining places against it.
- **`fmt`.** Run after every flow edit; do not lay out a flow by hand. Exit 1 without `--check` means a syntax or placement error: fix the reported line and re-run.
- **`--draft`.** Turns completeness gaps into `todo` lines (exit 0 when only `todo`s and warnings remain). Use only while sketching; reverse, check, and sync require a clean run without `--draft`.
- **`render`.** Validates and writes a self-contained HTML page (default `<skill>-<skill-version>.html` or `<skill>.html`, outside the skill folder). Never read or edit `assets/` to render. Refuses paths inside the skill folder, on the flow file, or over a page with saved review comments (exit 2): pick another `-o` path outside the skill folder.
- **`map` / `rules`.** `map` lists files, headings, and references (`[name and purpose only]`, `[in <folder>/]`, `[not in skill]`). `rules` extracts candidate rule lines, script failure lines with `[under: …]`, and `[write]` lines; you decide which are rules.
- **Exit 2.** Three causes, named in the error: (1) wrong CLI args or folder in place of a flow file / missing `SKILL.md` — fix the command from the error or `--help` and re-run; (2) refused `render` path — pass another `-o` outside the skill folder; (3) unreadable/unwritable file — report the path and stop.

## Rules for every mode

- **Location.** One flow file per skill: a `.kdl` file whose first line
  starts with `skillflow`. A new one is `<skill-name>.kdl` next to the target
  `SKILL.md`, or the path that the user or the repository's SkillFlow block
  names: a subfolder of the skill, or a separate tree that mirrors the skill
  paths. An existing flow file keeps its name.
- **Assets.** Name an asset and its purpose; copy no data from it.
- **Scope.** Change only the flow file, the target skill in sync, the
  repository's agent instructions once with consent, and in explain the HTML
  page outside the skill folder. Leave OpenSpec, evals, and other tooling to
  the user. Work from the current files; read history only to compare two
  versions in explain.
- **Questions.** Ask all open questions in one numbered message and end the
  turn. Each question quotes the skill line with file:line, names the options
  and what each changes in the flow, and shows the smallest visual that fits:
  a table, or a flow fragment per option. No answer means no change. When
  nobody can answer (a batch or subagent run), report the questions and stop.
  A ❓ in the flow is a report item; in reverse, a ❓ that changes who acts or
  where the flow goes next is also a question when someone can answer.
- **Prose style.** Write the flow's quoted prose in ASD-STE100 with
  given-new flow: topic sentence first, every term defined before use, every
  logical link written as a word. Before reverse, author, or sync writes
  prose, say in chat that this is the default style and that the user can name
  another; keep the user's choice for the rest of the conversation.
- **Ongoing work.** After you change a skill that has a flow file, run check
  mode on it and offer sync for each ❌.

## Choose the mode

| The user wants | Mode |
| --- | --- |
| to learn how to use SkillFlow or how to write a flow (`skillflow help`, `--help`) | help |
| a flow file for a skill that has none, or an explicit rebuild | reverse |
| a flow for a new skill, or to edit a flow in dialogue | author |
| to know whether the skill still matches its flow | check |
| the flow and the skill brought back in line | check, then sync |
| the flow explained, shown as a page, or two versions compared | explain |

Check, sync, and explain need a flow file. When the target skill has none,
say so, offer reverse, and end the turn.

## Help

Read [help.md](references/help.md) and answer from it in the conversation
language: the overview for a general question, the lesson for "how do I write
a flow", the message table for a validator error. A help-only request ends
with the answer; when the user also asks for work, continue with that mode.

## Reverse

Describe the skill as it works now, flaws included.

1. Run `map` on the target skill. Read `SKILL.md` completely, then every file
   that `SKILL.md` sends a step of the workflow to, scripts and on-request
   references included. Of a file marked `[name and purpose only]`,
   read only its name and purpose, unless the workflow runs it or the agent
   fills it. The target's rules bind an agent that runs it,
   not one that describes it: read its scripts unless the user forbids it in
   this conversation. Unread scripts get their facts only from `rules` and
   documented interfaces, a ❓ on each failure target those do not state, and
   a place in the list of files not read.

   Decide each file's role by how the skill uses it, not by its folder: a
   file the workflow runs is a script, also inside `assets/` or after the
   skill copies it; a file the skill only copies or shows is an asset or an
   example. A script the skill runs from an unexpected folder is an
   improvement item. Read a `[not in skill]` reference the same way: a file
   the skill makes elsewhere, an example, or a broken link. A skill without
   scripts skips the script parts of steps 1 and 2.
2. Run `rules` on the target skill and make the inventory in your notes for
   the report; the run writes no inventory file. The inventory has rows of
   four kinds only, each with file:line:
   - `flow`: a rule about what may happen during the flow;
   - `dialogue`: a point where the skill asks or waits for the user;
   - `branch`: a choice the skill makes, with its outcomes;
   - `effect`: a file, message, or state the skill makes or changes.

   Take every `rules` line that is a `flow` rule, every script failure that
   the skill handles as a `branch` row with its `[under: …]` condition, and
   each file that `[write]` lines make as one `effect` row. A script line, a
   detail, and a rule about the result get no row. Map each row: `flow` to an
   `invariant`, the others to a node, a `when`, or an `output`; a row you
   cannot map gets a ❓. A rule about the result stays in the skill: the node
   that makes the result names its intent in a few words, except the cases
   that the Coverage rules of authoring.md name (a checklist copied into the
   task list, a condition that changes the form of the result): those are
   prose of their node.
3. Write the flow file by the writing rules in authoring.md and the inventory.
   Every node rests on a row or on another skill line with file:line; a node
   without such evidence is invented, so remove it. Where the skill labels a part (`S3`, `Checkpoint-2`, a rule ID,
   a mode), give its element `ref=` by the Labels rule of authoring.md. When a
   flow file exists, update it and keep its names and refs. Set the stamps as
   in sync step 4.
4. Run `fmt`, then `validate`, and fix every error and every warning, except a length
   warning on prose a person wrote on purpose: keep it and name it in the report.
5. Report in chat: the file path, the inventory, the validator summary, every
   ❓, the files you did not read, and improvements for the skill as a separate
   list that stays out of the flow file. Find the improvements with these
   checks: an early exit without an `end`, a write without a guard step before it,
   a state that is never cleared, a failure without its own handling, two files
   that contradict each other, and a question without a fixed place. A defect
   of the skill is an improvement item, not a `// ?` line: a `// ?` line marks
   only a place where you cannot tell what the skill does. Then offer [set-up](#set-up) when it applies.

Done when the validator exits 0 with no warning but those step 4 keeps, every
inventory row is written in the node it names or has a ❓, every node rests
on evidence, the report names every `// ?` line of the flow and no other ❓,
and every writing rule in authoring.md (granularity, coverage, what
the human does, skipping a gate, rules with exceptions) is applied: each case
it names has a node, prose, or a ❓. A ❓ needs no answer: a run with open
❓ lines is done, not partial.

## Author

1. Take the user's documents and answers as source material.
2. Draft or edit the flow by the writing rules. Run `fmt` and `validate --draft` on each
   draft, then show the change as a [semantic diff](#semantic-diff) with the
   open `todo` items. Before the user accepts, run `validate` without
   `--draft`.
3. Offer [set-up](#set-up) when it applies.

When the user rejects the flow, it stays a draft and the mode ends.

Done when the user accepts the flow and the validator exits 0. Bringing the
skill in line is sync. For a skill that does not exist yet, leave out `file=`
until its script exists; sync then builds the skill from the flow without a
check, because every node is ❌ missing in skill.

## Check

Report differences; change no file.

1. Run `validate`. On errors, report them and stop: the skeleton must parse
   before it can be compared.
2. Run `map` and read the skill as in reverse step 1.
3. Give every skeleton element one status, testing in this order:
   - ✅ the skill does it, with the same intent as the node's prose; nuance may differ.
   - ❌ it differs, and every file that could hold it was read. Give a type
     (missing in skill, extra in skill, order, other) and evidence: file, line,
     and a short quote from instructions or scripts.
   - ❓ not established: a relevant file was not read, or passages contradict.
     Say what you read and what you did not find.

   Count these elements: each `context` line; each node, `on-fail` included; each
   `when` outcome, a gate's implied `approved` and `revise`, and the implied
   outcome of a one-`when` decide; each executor (a gate is human), an invariant's `by` included: `by=code` is ✅ only with a script line that fails or blocks on the broken rule; each `input`, `output`, or
   `tools` line; each `file`, `skill`, and `ref`; and the order of each block with two
   or more nodes. A prose intent that the skill drops or changes is ❌ other
   on its node. For an element with `ref`, compare it first with the skill
   text at the label's defining places; a ref that `validate` finds no
   defining place for is ❌ other: the skill renamed or removed the label.
4. Search every file you read for behavior that passes the intent test and has
   no node; each is ❌ extra in skill. An order difference is ❌ even when the
   result is fine. The flow's own `// ?` comments are evidence, not differences.
   When the flow has a `ref`, also look for labels of workflow parts (step IDs,
   checkpoints, modes) at defining places in the files you read that no `ref`
   names. Give each one line: the label, file:line, and either "node
   `<name>` needs `ref`" or "no node", which is also ❌ extra in skill.
5. Report in chat: counts, the ❌ list (most important first, each with a
   semantic diff), the ❓ list with the files you did not read, the unlinked
   labels from step 4, then a compact ✅ list grouped by phase.

Done when every skeleton element has a status and the extra-behavior search
covered every file you read.

## Sync

1. Take the ❌ items of a check report from this conversation; without one,
   run check first. For a skill that does not exist yet, take every node as
   ❌ missing in skill instead.
2. Ask which side wins for each item: the flow file or the skill.
3. Apply each answered item with the smallest edit to the losing side. Leave
   unanswered items unchanged.
4. On the flow's first line, set `skill-version` to the target skill's
   `metadata.version`, when it has one, and `skillflow-version` to the
   installed SkillFlow version from the `versions:` line of `validate`. Run
   `fmt` and `validate`, then check the changed nodes again.
5. Report what changed, what stays open, and any follow-up steps the
   repository's rules require for a skill change, such as a version bump.

Done when every answered item is applied and the validator exits 0.

## Explain

Explain the flow in plain words that both a developer and a domain expert can
follow: what the skill does, its phases, who decides each branch, where the
user is asked, the invariants, and where the flow ends. When the user wants to
see it, run `render` and give the page's path. Without `-o`, the page is
`<skill>-<skill-version>.html` (or `<skill>.html`) next to the flow file, or
next to the skill folder for a flow inside it. For a flow that does not pass `validate` yet, run `render
--draft` and say that the page lists its open gaps. To show one run, give
the page's path with `#scenario=<name>=<outcome>,…`, which opens Scenario
with those picks. For two versions of a flow file, such as the working copy and
`git show HEAD:<path>`, show a semantic diff, or say that nothing changed.

Done when every phase, decision with its executor, human step, invariant, and
end appears in the explanation or on the page.

## Semantic diff

Show changes in the shape of the flow, not as text lines:

```diff
 context
-  invariant "nothing is published without approval"
 phase write
   step draft (llm)  + output draft
-  gate approved
+  step publish (code)
+    on-fail → end
```

## Set up

When the repository's `AGENTS.md` or `CLAUDE.md` has no SkillFlow block, offer
the block in [agents-block.md](references/agents-block.md) once per
conversation, at the end of reverse or author. Write it only after the user
agrees. When nobody can answer, skip set-up and name the missing block in
the report.
