// Folder commands: map and rules (port of skill_files, condition, run_rules, run_map).
import fs from "node:fs";
import path from "node:path";
import { InputError, FAILURE, READ_LIMIT, W, cut, isFile, skillFiles, squash } from "./validate.mjs";

export { skillFiles };

const LARGE_BYTES = 50_000; // bytes: `map` marks a larger file that is not Markdown [name and purpose only], so reverse does not read it in full
const RULE_WORDS = new RegExp(`(?<![${W}])(never|only|before|until|unless|except|defer[${W}]*|do not|don't|unavailable|task list)(?![${W}])`, "iu");
const WRITES = new RegExp(
  `\\.write_(text|bytes)\\(|(?<![${W}])open\\([^)]*['"][wax]b?\\+?['"]|\\.open\\(\\s*['"][wax]|\\.mkdir\\(|(?<![${W}])os\\.(makedirs|replace|rename|remove|unlink)\\(|\\.unlink\\(|\\.touch\\(|\\.save\\(|(?<![${W}])ZipFile\\([^)]*['"][wax]['"]|(?<![${W}])shutil\\.(copy[${W}]*|move|rmtree|make_archive|unpack_archive)\\(|(?<![${W}])(NamedTemporaryFile|mkstemp|mkdtemp)\\(|(?<![${W}])(writeFile|appendFile|mkdir|rm|rename|copyFile)(Sync)?\\(`,
  "u",
);
// Shell scripts only: a file command in command position, `sed -i`, or a redirect into a file (not `>&2`, not /dev/null).
const SHELL_WRITES = new RegExp(
  `(?:^|[;&|({!]|(?<![${W}])(?:then|do|else|sudo|exec|command))\\s*(?:mkdir|install|cp|mv|rm|rmdir|touch|ln|tee|mktemp|truncate)(?=\\s|$)`
  + `|(?<![${W}])sed\\s+(?:-[${W}]*\\s+)*-[${W}]*i|(?<=^|\\s|\\d)>>?\\s*(?![&>]|/dev/(?:null|stderr|stdout|tty))[^\\s&>]`,
  "u",
);
// quoted text is blanked before the shell patterns run: "run a | install b" in a message is not a command
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
const isShell = (relative, lines) => /\.(sh|bash|zsh)$/.test(relative) || /^#!.*(?<![a-z])(ba|z|da|k)?sh(?![a-z])/.test(lines[0] ?? "");
const BRANCH = new RegExp(`^(if|elif|else|except|while|for|with)(?![${W}])|^\\}?\\s*(else|catch)(?![${W}])`, "u");
const LINK = new RegExp(`(?<![${W}.-])((?:scripts|references|assets)/[${W}./-]*[${W}])(?![${W}./-]*[*{])`, "gu");

const splitLines = (text) => text.split(/\r\n|\r|\n/);
// a final newline adds no empty last line
const textLines = (text) => {
  const lines = splitLines(text);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};
const lstripLen = (s) => s.length - s.trimStart().length;

function showRoot(dir) {
  const p = path.normalize(dir);
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/** The skill folder as given, without a trailing slash; an InputError when it holds no SKILL.md. */
function skillRoot(dir) {
  const root = showRoot(dir);
  if (!isFile(path.join(root, "SKILL.md"))) throw new InputError(`${root}: no SKILL.md here; pass the skill folder that holds SKILL.md`);
  return root;
}

// The nearest enclosing branch line above lines[index], by indentation: the condition a failure or write sits under.
export function condition(lines, index) {
  let indent = lstripLen(lines[index]);
  // search at most 40 lines back: the enclosing branch of a usual block is nearer
  for (const line of lines.slice(Math.max(0, index - 40), index).reverse()) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const level = lstripLen(line);
    if (level < indent) {
      if (text.includes("__name__")) return "";
      if (BRANCH.test(text)) return cut(squash(text), 120); // 120 characters show the condition; the file has the rest above the reported line
      if (text.startsWith("def ") || text.startsWith("function ") || text.startsWith("async def ") || level === 0) return "";
      indent = level;
    }
  }
  return "";
}

const decoder = () => new TextDecoder("utf-8", { fatal: true });

export function runRules(args) {
  const root = skillRoot(args.skillDir);
  const counts = { rule: 0, failure: 0, write: 0 };
  for (const relative of skillFiles(root)) {
    const full = path.join(root, relative);
    if (fs.lstatSync(full).isSymbolicLink() || relative.startsWith("assets/")) continue;
    let text;
    try {
      if (fs.statSync(full).size > READ_LIMIT) continue;
      text = decoder().decode(fs.readFileSync(full));
    } catch { continue; }
    const lines = textLines(text);
    const md = path.extname(relative) === ".md";
    // a shell script may hold Python or JavaScript in a heredoc, so it gets both pattern sets
    const shell = !md && isShell(relative, lines);
    const writes = (line) => WRITES.test(line) || (shell && SHELL_WRITES.test(line.replace(QUOTED, '"_"')));
    lines.forEach((line, i) => {
      const rule = md && RULE_WORDS.test(line), failure = !md && FAILURE.test(line), write = !md && writes(line);
      if (!rule && !failure && !write) return;
      // a line that handles a failure and writes a file counts in both: the write list must stay complete
      if (rule) counts.rule++;
      if (failure) counts.failure++;
      if (write) counts.write++;
      // 240 characters keep a long rule sentence whole and cut a minified line
      let out = `${relative}:${i + 1}: ${cut(squash(line), 240)}`;
      if (!rule) {
        const when = condition(lines, i);
        out += (write ? "  [write]" : "") + (when ? `  [under: ${when}]` : "");
      }
      console.log(out);
    });
  }
  console.log(`${counts.rule} rule lines, ${counts.failure} failure lines, ${counts.write} write lines`);
  return 0;
}

export function runMap(args) {
  const root = skillRoot(args.skillDir);
  const links = [];
  console.log(`${root}/`);
  for (const relative of skillFiles(root)) {
    const full = path.join(root, relative);
    if (fs.lstatSync(full).isSymbolicLink()) {
      console.log(`  ${relative}  symlink, not read`);
      continue;
    }
    let size, text;
    try {
      size = fs.statSync(full).size;
      if (size > READ_LIMIT) {
        console.log(`  ${relative}  ${size} bytes  [name and purpose only]`);
        continue;
      }
      const bytes = fs.readFileSync(full);
      try { text = decoder().decode(bytes); } catch {
        console.log(`  ${relative}  ${size} bytes, binary  [name and purpose only]`);
        continue;
      }
    } catch (exc) {
      console.log(`  ${relative}  cannot read: ${exc.code === "EACCES" ? "Permission denied" : exc.message}`);
      continue;
    }
    const isMd = path.extname(relative) === ".md";
    const large = relative.startsWith("assets/") || (size > LARGE_BYTES && !isMd);
    const lines = textLines(text);
    console.log(`  ${relative}  ${lines.length} lines` + (large ? "  [name and purpose only]" : ""));
    if (!isMd) continue;
    let fence = null;
    lines.forEach((line, i) => {
      const number = i + 1;
      const opening = /^\s*(`{3,}|~{3,})/u.exec(line);
      if (fence === null && opening) fence = opening[1];
      else if (fence !== null) {
        const t = line.trim();
        if (t.startsWith(fence) && [...t].every((c) => c === fence[0])) fence = null;
      } else if (/^#{1,3} /.test(line)) console.log(`      ${number}: ${line}`);
      // references count inside code fences too: script calls live there
      for (const word of line.split(/[\s"'()<>\[\]`]+/u)) {
        if (word.includes("://") || word.startsWith("../")) continue;
        for (const m of word.matchAll(LINK)) {
          if (!links.some(([s, n, t]) => s === relative && n === number && t === m[1])) links.push([relative, number, m[1]]);
        }
      }
    });
  }
  if (links.length) {
    console.log("references from Markdown:");
    const files = skillFiles(root);
    // a path absent at the root may be relative to a subfolder, such as a scaffold the skill copies
    const holders = (target) => [...new Set(files.flatMap((file) => {
      const at = `/${file}/`.indexOf(`/${target}/`);
      return at > 0 ? [file.slice(0, at)] : [];
    }))];
    for (const [source, number, target] of links) {
      let mark = "";
      if (!fs.existsSync(path.join(root, target))) {
        const found = holders(target);
        mark = found.length ? `  [in ${found.join(", ")}]` : "  [not in skill]";
      }
      console.log(`  ${source}:${number} -> ${target}${mark}`);
    }
  }
  return 0;
}
