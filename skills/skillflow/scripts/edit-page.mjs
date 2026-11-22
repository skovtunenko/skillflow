// The edit page: the viewer's page, as `render` writes it, with the editor added: the editor's modules, SkillFlow's own modules, and the files those modules read.
// The browser runs validate.mjs, render.mjs, and fmt.mjs as they are; assets/editor/node-fs.mjs and node-path.mjs stand in for Node.
import {lstatSync, readFileSync, realpathSync, statSync} from "node:fs";
import {basename, dirname, isAbsolute, join, posix, relative, sep} from "node:path";
import {readText} from "./flow-file.mjs";
import {page, pageModel, scriptJson} from "./render.mjs";
import {isFile, parseFlow, READ_LIMIT, skillFiles} from "./validate.mjs";

const SKILLFLOW = join(import.meta.dirname, ".."); // SkillFlow's own folder
const EDITOR = "assets/editor";

/**
 * {path in the page: text} of every file under `root`, the page paths below `at`. A link that leaves `root` is left out:
 * the editor reads nothing outside the folder.
 */
export function tree(root, at, keep = () => true) {
  const out = {}, inside = realpathSync(root) + sep;
  for (const file of skillFiles(root).filter(keep)) {
    let text = "";
    try {
      const path = realpathSync(join(root, file));
      if (!path.startsWith(inside)) continue;
      // a link is there with no text, as validate.mjs reads no linked Markdown for a ref; SkillFlow's own folder has no links
      if (lstatSync(join(root, file)).isSymbolicLink()) { out[`${at}/${file}`] = ""; continue; }
      if (statSync(path).size <= READ_LIMIT) text = new TextDecoder("utf-8", {fatal: true}).decode(readFileSync(path));
    } catch { /* shortcut: a binary, large, or unreadable file is there with no text; enough for the `file=` checks, read its text when a rule needs it */ }
    out[`${at}/${file}`] = text;
  }
  return out;
}

/** Where the flow and its skill folder are in the page's file system; a flow inside its skill folder stays inside it. */
export function places(flow, skill) {
  const name = skill ? basename(realpathSync(skill)) : null, inside = skill ? relative(realpathSync(skill), realpathSync(flow)) : "..";
  const within = !inside.startsWith("..") && !isAbsolute(inside);
  return {skill: skill ? `/skill/${name}` : null, flow: within ? `/skill/${name}/${inside.split(sep).join("/")}` : `/flow/${basename(flow)}`};
}

// what render.mjs and validate.mjs read from SkillFlow's own folder: the viewer, the help example, the version, and the third-party notices
const ownFiles = () => ({
  ...tree(join(SKILLFLOW, "assets"), "/app/assets", (file) => !file.startsWith("editor/")),
  "/app/SKILL.md": readFileSync(join(SKILLFLOW, "SKILL.md"), "utf8"),
  "/app/references/example.md": readFileSync(join(SKILLFLOW, "references", "example.md"), "utf8"),
  // the notices that the Help view shows
  ...Object.fromEntries(["PIN.json", "LICENSE.md"].map((name) => [`/app/scripts/_vendor/bgotink-kdl/${name}`, readFileSync(join(SKILLFLOW, "scripts", "_vendor", "bgotink-kdl", name), "utf8")])),
});

/**
 * The page's import map: the editor's modules and every module they import, each as a data: URL.
 * A data: URL has no folder, so a relative import becomes a name under `sf/`; `node:fs` and `node:path` name the browser stand-ins.
 */
export function importMap() {
  const imports = {};
  const add = (file) => {
    const name = `sf/${file}`;
    if (name in imports) return name;
    imports[name] = ""; // seen: two modules may import each other
    const source = readFileSync(join(SKILLFLOW, file), "utf8")
      // a specifier in a comment may name no file: it stays as it is
      .replace(/(\b(?:from|import)\s*)(["'])(\.\.?\/[^"']+)\2/g, (all, word, quote, to) => {
        const target = posix.join(posix.dirname(file), to);
        return isFile(join(SKILLFLOW, target)) ? word + quote + add(target) + quote : all;
      })
      // the module's folder in the page's file system, where ownFiles puts what it reads
      .replaceAll("import.meta.dirname", JSON.stringify(`/app/${posix.dirname(file)}`));
    imports[name] = "data:text/javascript;base64," + Buffer.from(`${source}\n//# sourceURL=skillflow/${file}`).toString("base64");
    return name;
  };
  add(`${EDITOR}/main.mjs`);
  for (const module of ["fs", "path"]) imports[`node:${module}`] = imports[add(`${EDITOR}/node-${module}.mjs`)];
  return {imports};
}

// the page starts as the viewer's page of an empty flow; the editor draws the flow's own text into it, also a text with errors
const EMPTY = "skillflow 1.0\n";
// the editor did not start (a browser without import maps): the page shows the empty flow and says why
const START = `import("sf/assets/editor/main.mjs").catch((error) => {
  document.documentElement.dataset.pageError = String(error && error.stack || error);
  if (!document.querySelector(".app")) window.skillflow.boot(JSON.parse(document.getElementById("flow-model").textContent));
  const note = document.body.appendChild(document.createElement("p"));
  note.setAttribute("role", "alert");
  note.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:99;margin:0;padding:8px 12px;border-radius:8px;background:#c2362b;color:#fff";
  note.textContent = "The editor did not start: " + error.message;
});`;

/** The edit page for `flow` and its skill folder (or null). `server`: true when a server answers next to the page, false for an offline page. */
export function editorPage(flow, skill, server) {
  const own = (file) => readFileSync(join(SKILLFLOW, file), "utf8");
  const where = places(flow, skill), name = basename(flow), title = basename(skill ? realpathSync(skill) : dirname(realpathSync(flow)));
  const boot = {...where, server, name, title, files: {...ownFiles(), ...(skill ? tree(skill, where.skill) : {}), [where.flow]: readText(flow) ?? ""}};
  const css = own(`${EDITOR}/editor.css`), ui = own(`${EDITOR}/editor.html`);
  if (css.toLowerCase().includes("</style") || /<\/template|<script/i.test(ui)) throw new Error("editor asset would break its tag");
  // edit: the viewer waits for the editor to start it; copy: the page is one copy for its comments while its text changes
  const model = {...pageModel(parseFlow(EMPTY), EMPTY, title, name), edit: true, copy: "edit"};
  return page(model, `<style>${css}</style>`, `<template id="sf-editor-ui">${ui}</template><script type="application/json" id="sf-editor">${scriptJson(boot)}</script>` +
    `<script type="importmap">${scriptJson(importMap())}</script><script type="module">${START}</script>`);
}
