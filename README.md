# SkillFlow

SkillFlow is a language for the workflow of an agent skill. A flow file
describes the phases, steps, decisions, and who acts in each step, so a
person can review the skill in minutes.

Website: <https://skovtunenko.github.io/skillflow/>

## Install

Copy the folder `skills/skillflow` into the skills folder of your agent.
The scripts of the skill need Node.js 22 or later and no packages.

## Modes

Ask the agent for a mode, for example `skillflow check`.

| Mode | What it does |
| --- | --- |
| `help` | Explains SkillFlow and how to write a flow. |
| `reverse` | Writes a flow file for a skill that has none. |
| `author` | Writes or edits a flow with you, step by step. |
| `check` | Tells you whether the skill still matches its flow. |
| `sync` | Brings the flow and the skill back in line. |
| `explain` | Explains a flow, shows it as a page, or compares two versions. |

The file `skills/skillflow/flow.kdl` is the flow of SkillFlow itself.

## Development

The tasks need [mise](https://mise.jdx.dev/).

```bash
mise run check   # run the tests
mise run site    # build the website into _site/
```

The browser tests need Chrome. Without it they are skipped, except in CI.

## License

MIT, see the file `LICENSE`. Third-party code in the skill ships with its
own license.
