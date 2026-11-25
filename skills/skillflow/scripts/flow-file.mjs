// File access for a flow file: its real path, its text, a write in one step, and a save only over the text the caller has seen.
import {accessSync, chmodSync, constants, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {statOrNull} from "./validate.mjs";

// realpath of a file that may not exist yet: a dangling symlink resolves to its target, else the folder's realpath plus the name
// 40 links at most, so a loop of links ends
export function real(path, depth = 0) {
  try { return realpathSync(path); } catch {}
  if (depth < 40) try { return real(resolve(dirname(path), readlinkSync(path)), depth + 1); } catch {}
  try { return join(realpathSync(dirname(path)), basename(path)); } catch { return resolve(path); }
}

/** The text of the file, or null when there is no such file; other read errors are thrown. */
export function readText(path) {
  try { return readFileSync(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Write `text` over `path` through a temporary file next to it and a rename: a crash never leaves half a file. Throws the file system error. */
export function replaceFile(path, text) {
  const target = real(path), temporary = `${target}.skillflow-${process.pid}.tmp`, mode = statOrNull(target)?.mode;
  try {
    if (mode !== undefined) accessSync(target, constants.W_OK); // a rename would replace a read-only file
    writeFileSync(temporary, text);
    if (mode !== undefined) chmodSync(temporary, mode & 0o777);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, {force: true});
    throw error;
  }
}

/**
 * Save `text` when the file still holds `base`, the text the caller loaded (null: no file).
 * {saved: true}, or {saved: false, disk} with the text now on disk: no save overwrites a change it has not seen.
 */
export function saveFlow(path, base, text) {
  const disk = readText(path);
  if (disk !== base) return {saved: false, disk};
  replaceFile(path, text);
  return {saved: true};
}
