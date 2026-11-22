// `rules` marks a script line `[write]` only when it writes a file: a shutil lookup is not a write, a temporary file is.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {tmpDir} from "./tmp.mjs";
import {SKILL} from "./skill-path.mjs";

const CLI = path.join(SKILL, "scripts/skillflow.mjs");

const SCRIPT = `import shutil, tempfile
from pathlib import Path
if shutil.which('node'):
    print('node: ' + ('found' if shutil.which('node') else 'missing'))
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as tmp:
    tmp.write('x')
fd, name = tempfile.mkstemp()
shutil.copy2('a', 'b')
shutil.rmtree('build')
Path('stamp').touch()
`;

test("rules marks file writes, not shutil lookups", () => {
  const dir = tmpDir("sf-rules-");
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# T\n\nRun scripts/w.py.\n");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts", "w.py"), SCRIPT);
  const out = execFileSync("node", [CLI, "rules", dir], {encoding: "utf8"});
  const writes = out.split("\n").filter((l) => l.includes("[write]")).map((l) => Number(/^scripts\/w\.py:(\d+):/.exec(l)?.[1]));
  assert.deepEqual(writes, [5, 7, 8, 9, 10]);
});

const SHELL = `#!/usr/bin/env bash
# rm the old build first
mkdir -p "$target" || return
[[ -e $destination ]] && continue
install -m 755 "$source" "$destination" || return
echo "Error: refusing to overwrite: $destination" >&2
command -v uv >/dev/null 2>&1
echo "Usage: $0 check | install TARGET; rm nothing > here"
echo "$version" > "$target/.version"
if [[ -d build ]]; then rm -rf build; fi
sed -i '' 's/a/b/' config.toml
cat notes.txt | tee -a "$log"
`;

test("rules marks shell file commands and redirects, not stderr or /dev/null", () => {
  const dir = tmpDir("sf-rules-");
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# T\n\nRun scripts/w.sh.\n");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts", "w.sh"), SHELL);
  const out = execFileSync("node", [CLI, "rules", dir], {encoding: "utf8"});
  const writes = out.split("\n").filter((l) => l.includes("[write]")).map((l) => Number(/^scripts\/w\.sh:(\d+):/.exec(l)?.[1]));
  assert.deepEqual(writes, [3, 5, 9, 10, 11, 12]);
});
