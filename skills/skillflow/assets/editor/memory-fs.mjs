// The part of node:fs that SkillFlow's modules use, over files held in memory: {path: text}.
import {normalize} from "./node-path.mjs";

const fail = (code, path) => Object.assign(new Error(`${code}: ${path}`), {code});
const bytes = (text) => new TextEncoder().encode(text);

export function memoryFs(initial) {
  const files = new Map(Object.entries(initial));
  const below = (dir) => (dir === "/" ? "/" : dir + "/");
  const isDir = (path) => path === "/" || [...files.keys()].some((file) => file.startsWith(below(path)));
  function stat(given) {
    const path = normalize(given), file = files.has(path);
    if (!file && !isDir(path)) throw fail("ENOENT", path);
    return {isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false, get size() { return file ? bytes(files.get(path)).length : 0; }};
  }
  return {
    statSync: stat,
    lstatSync: stat,
    realpathSync(given) { stat(given); return normalize(given); },
    /** The text with an encoding, else the bytes, as Node does. */
    readFileSync(given, encoding) {
      const path = normalize(given);
      if (!files.has(path)) throw fail(isDir(path) ? "EISDIR" : "ENOENT", path);
      return encoding ? files.get(path) : bytes(files.get(path));
    },
    readdirSync(given, options) {
      const path = normalize(given);
      if (!isDir(path)) throw fail(files.has(path) ? "ENOTDIR" : "ENOENT", path);
      const names = [...new Set([...files.keys()].filter((file) => file.startsWith(below(path))).map((file) => file.slice(below(path).length).split("/")[0]))].sort();
      return options?.withFileTypes ? names.map((name) => ({name, ...stat(below(path) + name)})) : names;
    },
    writeFileSync(given, text) { files.set(normalize(given), String(text)); },
    /** Put `tree` in the place of every file below `dir`: files that are gone from the tree are gone here. Not in node:fs. */
    replaceFolder(dir, tree) {
      for (const file of [...files.keys()]) if (file.startsWith(below(normalize(dir)))) files.delete(file);
      for (const [file, text] of Object.entries(tree)) files.set(file, text);
    },
  };
}
