// Temp folders for tests: each one is removed when the test process exits.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dirs = [];
process.on("exit", () => { for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true}); });

/** A new folder under the OS temp folder, named `<prefix>XXXXXX`. */
export function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
