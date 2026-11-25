# Block for the repository's agent instructions

Offer this block once, when a repository's `AGENTS.md` or `CLAUDE.md` has no
SkillFlow block:

1. Offer the block, and ask in the same message where flow files live: next
   to `SKILL.md` (default), in a subfolder (which one), or in a separate tree
   that mirrors the skill paths (which root).
2. Fill the location from the user's answer and show the block.
3. Write the block only after the user agrees. When `CLAUDE.md` is a symlink
   to `AGENTS.md`, edit the shared target once.

```markdown
## SkillFlow

A skill with a flow file `<skill>.kdl` <next to its `SKILL.md` | in its `<folder>/` subfolder |
at `<root>/<skill path>/<skill>.kdl`, with `skill="<path>"` on its first line or run with `--skill <skill folder>`>
describes its workflow in SkillFlow format. Use the skillflow skill:

- after you change such a skill's logic, check its flow file and sync them;
- after you change a flow file, sync the skill to it.
```
