# Example flow file

A complete `flow.kdl` for an imagined skill `release-notes`, which drafts release
notes for a git tag and adds them to `CHANGELOG.md`. It uses every node, every
property, every executor and every tool kind of [grammar.md](grammar.md). The
validator accepts it without a warning when the skill folder has
`scripts/collect.sh`, the version `1.2` in `SKILL.md`, and a heading that
starts with `S2`.

```kdl
skillflow 1.0 skill-version="1.2" skillflow-version="2026.11.20.1"

context "Drafts release notes for a git tag and adds them to CHANGELOG.md." {
	input tag "the git tag to describe"
	input changelog "the project's existing CHANGELOG.md"

	output changelog "a new section in CHANGELOG.md"
	output "a one-line summary in the chat"

	invariant by=human "nothing is published without the user's approval"
	invariant by=code "collect.sh stops the flow when the tag does not exist"
	invariant by=llm "no commit is changed during the flow"
}

phase gather "Find what changed since the last tag." {
	step collect-changes by=code file="scripts/collect.sh" {
		tools gh /* the GitHub CLI */
		output changes "the commits and pull requests since the last tag"

		on-fail {
			end "report that the tag does not exist"
		}
	}

	decide size "Is this a major release?" by=llm {
		output size "major or regular"

		when major {
			step ask-highlights by=llm "Ask which changes come first." {
				input highlights "the changes that the user wants at the top"
			}
		}

		when regular "The notes have no highlights."
	}
}

phase write ref="S2" {
	step draft by=llm """
		Group the changes **by type**:
		- features
		- fixes

		Leave out internal refactors. Revise the draft until the user approves it or stops.
		""" {
		tools (agent)editor (mcp)jira
		output draft "the release notes before approval"
	}

	step polish by=llm skill=style-guide "Apply the style guide to the draft."

	// ? The skill does not say how many revision rounds are allowed (SKILL.md:24).
	gate approved "Did the user approve the draft?" {
		when rejected {
			end "the user stopped without approval"
		}
	}

	// From here on the flow writes files.
	step publish by=code {
		output changelog

		on-fail {
			step report-error by=llm "Show the error and leave CHANGELOG.md unchanged."
			end "CHANGELOG.md stays unchanged"
		}
	}

	/- step tweet by=llm "Post the notes."

	step announce by=human #"The user posts the "What's new" section to the team channel."# {
		on-fail "The notes stay in CHANGELOG.md only."
	}
}
```

How to read it:

- The first line carries the stamps that reverse and sync write:
  `skill-version` and `skillflow-version`. A flow file that is not next to its
  `SKILL.md` adds `skill="<path>"` there.
- Each `invariant` says who keeps it: a person at `gate approved`, the script
  `collect.sh`, or the model's instructions alone.
- The three executors: `by=code` runs a script (`collect-changes`, `publish`),
  `by=llm` is the model, and `by=human` is work the user does alone
  (`announce`).
- Data is born once: `changes`, `size`, `highlights` and `draft` each have one
  line with a description. `output changelog` names the step that delivers the
  flow's named output.
- `decide size` is a fork: `when major` holds a step, and `when regular` says in
  prose why nothing happens. The step in `when major` asks the user, so the
  answer is an `input` of that step.
- `tools` names the kind of each tool: `(agent)editor` is a subagent,
  `(mcp)jira` a tool of an MCP server, and `gh` a CLI with no kind.
- `phase write ref="S2"` links the phase to the part of the skill that has the
  label `S2`. `skill=style-guide` on `polish` loads another skill.
- The three `on-fail`: in `collect-changes` it ends the flow; in `publish` it
  reports the error in a step of its own and then ends the flow; in `announce`
  it is one line of prose, and the flow continues.
- The revision loop lives in the prose of `draft`, because loops are prose only.
- `gate approved` is a human approval checkpoint. Its outcomes `approved`
  (the flow continues) and `revise` (the draft is redone and the gate asks
  again) are implied and never written. `when rejected` adds an outcome that
  ends the flow.
- Comments: `// ?` marks a place where the skill text is unclear, `//` is a
  note for the reader of the file, `/* … */` sits inside a line, and `/-`
  comments out the whole node `tweet`.
- Strings: `"…"`, a multi-line `"""` string with a list and bold text in
  `draft`, and a raw string `#"…"#` that holds quotes in `announce`.
