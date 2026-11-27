# SkillFlow

[![check](https://github.com/skovtunenko/skillflow/actions/workflows/check.yml/badge.svg)](https://github.com/skovtunenko/skillflow/actions/workflows/check.yml)
[![release](https://img.shields.io/github/v/release/skovtunenko/skillflow?sort=date)](https://github.com/skovtunenko/skillflow/releases/latest)
[![node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![license](https://img.shields.io/github/license/skovtunenko/skillflow)](https://github.com/skovtunenko/skillflow/blob/main/LICENSE)

SkillFlow is a language for the workflow of an agent skill. A flow file
lists the phases, steps, and decisions of a skill and names who acts in
each step: the model, a script, or a person. Nothing runs a flow file. It
is the specification, and the skill is its implementation.

SkillFlow has two parts. `skillflowctl` checks a flow, draws its graph, and
runs a browser editor in which the graph follows the text. It is plain code:
the same input gives the same result, and it spends no tokens. The
`skillflow` skill is for your agent: it writes a flow for an existing skill
(`reverse`), writes one with you (`author`), and finds and fixes the
differences between a flow and its skill (`check`, `sync`). Only these agent
modes spend tokens.

Website and playground: <https://skovtunenko.github.io/skillflow/>

## A flow file

```kdl
skillflow 1.0

context "Drafts release notes for a git tag and adds them to CHANGELOG.md." {
	input tag "the git tag to describe"

	output changelog "a new section in CHANGELOG.md"

	invariant by=human "nothing is published without the user's approval"
}

phase gather {
	step collect-changes by=code "Run collect.sh for the tag." {
		output changes "the commits since the last tag"

		catch {
			end "the tag does not exist"
		}
	}

	decide size "Is this a major release?" by=llm {
		when major {
			step ask-highlights by=llm "Ask which changes come first." {
				input highlights "the changes that the user wants at the top"
			}
		}

		when regular "The notes have no highlights."
	}
}

phase write {
	step draft by=llm "Group the changes by type. Revise until the user approves." {
		output draft "the release notes before approval"
	}

	gate approved "Did the user approve the draft?"

	step publish by=code "Add the notes to CHANGELOG.md." {
		output changelog
	}

	step announce by=human "Post the notes to the team channel."
}
```

The syntax is [KDL 2.0](https://kdl.dev/). Node names (`phase`, `step`,
`decide`, `gate`, `catch`, `end`) are the structure, and a script checks
them. Quoted strings are the intent of each node; the agent compares them
with the text of the skill. `by=` names the executor: `llm`, `code`, or
`human`.

The flow of SkillFlow itself is
[`skills/skillflow/flow.kdl`](https://github.com/skovtunenko/skillflow/blob/main/skills/skillflow/flow.kdl).

## Install

Pick one: the [skills CLI](https://skills.sh/) or
[kasetto](https://kasetto.dev/). The skill needs Node.js 22 or later; its
scripts use no packages and no network.

```bash
# skills CLI (skills.sh): installs into the current project
npx skills add skovtunenko/skillflow

# kasetto: --project, because its default scope is global
kst add https://github.com/skovtunenko/skillflow --skill skillflow --project
```

By hand: copy `skills/skillflow` into the skills folder of your agent.

## Use it through your agent

Type the mode in the chat, for example `skillflow reverse` for a skill that
has no flow yet. Each mode is a model run and spends tokens.

| Mode | Reads | Gives |
| --- | --- | --- |
| `reverse` | the skill as it works now | a flow file for a skill that has none |
| `author` | your documents and answers | a new flow, or edits to a flow |
| `check` | the flow and the skill | a report of the differences; no file changes |
| `sync` | each difference, and the side you choose | edits to the flow or to the skill |
| `explain` | the flow file | an explanation, an HTML page, or a diff of two versions |
| `help` | — | answers about SkillFlow |

## Use it without an agent

`skillflowctl` (`skillflowctl.cmd` on Windows) in the skill folder runs
without a model and spends no tokens.

| Command | Result |
| --- | --- |
| `skillflowctl lint <skill>` | checks the format and validates the flow; writes nothing |
| `skillflowctl page <skill>` | formats and validates the flow, then writes its HTML page |
| `skillflowctl edit <skill>` | opens a local editor in the browser; the graph follows the text |
| `skillflowctl edit <skill> --offline <page>` | writes the editor as one offline page |
| `skillflowctl` | in a terminal: a menu of flows and actions |

`<skill>` is a flow file, a folder with one flow file, or a skill name.
Exit codes: `0` OK, `1` the flow has errors, `2` a wrong command line or an
unreadable input. `skillflowctl --help` lists all commands and options.

## Repository layout

```text
skills/skillflow/   the skill: SKILL.md, flow.kdl, skillflowctl, scripts, references, assets
build/skillflow/    tests, the eval kit, and the tool that vendors the KDL parser
site/               website sources and the examples it shows
```

This repository receives releases from a private source repository.
A release has a calendar version, `vYYYY.MM.DD.N`, equal to the version of
the skill.

## Development

The tasks need [mise](https://mise.jdx.dev/); it installs Node.js 24.

```bash
mise run check   # run the tests
mise run site    # build the website into _site/
```

The browser tests need Chrome. Without Chrome they are skipped, except in
CI or with `SKILLFLOW_BROWSER=required`.

## License

MIT, see [`LICENSE`](https://github.com/skovtunenko/skillflow/blob/main/LICENSE).
Third-party code in the skill ships with its own license; the website
lists each part.
