# Block for the repository's agent instructions

Offer this block once, when a repository's `AGENTS.md` or `CLAUDE.md` has no
SkillFlow block. Fill the location from the user's answer, show the block,
and write it only after the user agrees. Edit the shared target once when
`CLAUDE.md` is a symlink to `AGENTS.md`.

Ask in the same message where flow files live: next to `SKILL.md` (default),
in a subfolder (which one), or in a separate tree that mirrors the skill paths
(which root)?

```markdown
## SkillFlow

A skill with a flow file `<skill>.kdl` <next to its `SKILL.md` | in its `<folder>/` subfolder |
at `<root>/<skill path>/<skill>.kdl`, with `skill="<path>"` on its first line or run with `--skill <skill folder>`>
describes its workflow in SkillFlow format. Use the skillflow skill:

- after you change such a skill's logic, check its flow file and sync them;
- after you change a flow file, sync the skill to it.
```
