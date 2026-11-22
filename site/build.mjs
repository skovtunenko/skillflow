#!/usr/bin/env node
// Builds the SkillFlow website from index.html, examples/*.kdl, and the skill folder.
// node build.mjs --skill <skill-dir> --license <file> --out <dir>   (Node 22+, no packages, no network)
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import vm from "node:vm";

const SITE = import.meta.dirname;
const MAX_WORDS = 60;

const fail = (message) => { console.error(`build: ${message}`); process.exit(1); };
/** The real path of `path`: symlinks resolved in its nearest existing ancestor, the missing rest appended. */
function real(path) {
  const rest = [];
  for (let at = resolve(path); ; at = dirname(at)) {
    try { return join(realpathSync(at), ...rest); } catch { if (at === dirname(at)) return resolve(path); rest.unshift(basename(at)); }
  }
}
// `..` counts only as a whole path segment: a sibling named `..site-output` is outside
const inside = (child, parent) => { const rel = relative(real(parent), real(child)); return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)); };
const read = (path) => { try { return readFileSync(path, "utf8"); } catch (error) { fail(`cannot read ${path}: ${error.message}`); } };

let args;
try {
  ({values: args} = parseArgs({options: {skill: {type: "string"}, out: {type: "string"}, license: {type: "string"}}}));
} catch (error) { fail(error.message); }
for (const key of ["skill", "out", "license"]) if (!args[key]) fail(`missing --${key}\nusage: node build.mjs --skill <skill-dir> --license <file> --out <dir>`);
const skill = resolve(args.skill), out = resolve(args.out);
if (!existsSync(join(skill, "SKILL.md"))) fail(`${skill} has no SKILL.md`);
if (inside(out, skill)) fail(`--out ${out} is inside the skill folder ${skill}; pick a folder outside it`);
if (inside(out, SITE)) fail(`--out ${out} is inside the site sources ${SITE}; pick a folder outside it`);

const cli = join(skill, "scripts", "skillflow.mjs");
const run = (...argv) => spawnSync(process.execPath, [cli, ...argv], {encoding: "utf8"});

// 1. every example passes the skill's validator with no warning and no todo
const examples = readdirSync(join(SITE, "examples")).filter((name) => name.endsWith(".kdl")).sort();
for (const name of examples) {
  const result = run("validate", join(SITE, "examples", name));
  const first = result.stdout.split("\n")[0];
  if (result.status !== 0 || !/^OK [^·]*$/.test(first)) fail(`example ${name} does not pass the validator:\n${result.stdout}${result.stderr}`);
}

// 2. the single sources
const version = /^---\n[\s\S]*?^metadata:\n(?:[ \t]+.*\n)*?[ \t]+version:\s*"([^"]+)"/m.exec(read(join(skill, "SKILL.md")))?.[1];
if (!version) fail(`no metadata.version in ${join(skill, "SKILL.md")}`);
const {escapeHtml, htmlLines} = await import(pathToFileURL(join(skill, "assets", "editor", "highlight.mjs")).href);
const kdl = {};
vm.runInNewContext(read(join(skill, "assets", "viewer-lib", "kdl.js")), kdl);
if (typeof kdl.sfKdl?.tokenize !== "function") fail("assets/viewer-lib/kdl.js no longer declares sfKdl.tokenize");

const css = read(join(skill, "assets", "viewer.css"));
const light = /:root\{([^}]*)\}/.exec(css)?.[1], dark = /:root\[data-theme=dark\]\{([^}]*)\}/.exec(css)?.[1];
if (!light || !dark) fail("assets/viewer.css has no :root or :root[data-theme=dark] block of tokens");
// no attribute follows the system; data-theme, set by the theme button, wins over it
const viewerCss = `:root{${light}}\n@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark}}}\n:root[data-theme=dark]{${dark}}\n` + (css.match(/\.tk-[a-z]+(?:,\.tk-[a-z]+)*\{[^}]*\}/g) ?? []).join("\n");

// the skill's own parser and page model: the graphs and the code-graph pairing come from them, not from the text
const {parseFlow} = await import(pathToFileURL(join(skill, "scripts", "validate.mjs")).href);
const {buildModel} = await import(pathToFileURL(join(skill, "scripts", "render.mjs")).href);
const models = new Map();
/** {text, model} of examples/<name>.kdl. */
function example(name) {
  if (!examples.includes(`${name}.kdl`)) fail(`index.html names examples/${name}.kdl, which does not exist`);
  if (!models.has(name)) {
    const text = read(join(SITE, "examples", `${name}.kdl`)).replace(/\n$/, "");
    models.set(name, {text, model: buildModel(parseFlow(text), text, name, `${name}.kdl`, [])});
  }
  return models.get(name);
}
const children = (node) => [...(node.children ?? []), ...(node.whens ?? []).flatMap((branch) => branch.children), ...(node.onfail?.children ?? [])];
const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(children(node))]);

/** The highlighted lines of an example. With `pair`, a line that starts a node or an invariant carries its name and executor. */
function flowHtml(name, body, pair) {
  const {text, model} = example(name);
  const marks = new Map();
  if (pair) {
    for (const node of walk(model.flow)) if (node.name) marks.set(node.line, {node: node.name, by: node.by});
    for (const inv of model.context?.invariants ?? []) if (inv.by) marks.set(inv.line, {by: inv.by});
  }
  const skip = body ? /^skillflow\b.*\n+/.exec(text)?.[0].split("\n").length - 1 : 0;
  return htmlLines(text.split("\n").slice(skip).join("\n"), kdl.sfKdl.tokenize).map((html, index) => {
    const mark = marks.get(index + 1 + skip) ?? {};
    return `<span class="ln"${mark.node ? ` data-node="${escapeHtml(mark.node)}"` : ""}${mark.by ? ` data-by="${mark.by}"` : ""}>${html}</span>`;
  }).join("\n");
}

const ED = '<span class="ed"></span>';
/** The graph of an example, in the look of the viewer's cards. With `pair`, nodes are buttons that pair with code lines. */
function graphHtml(name, pair) {
  const {model} = example(name), e = escapeHtml;
  const card = (node, cls, inner) => pair
    ? `<button type="button" class="${cls}" data-node="${e(node.name)}"${node.by ? ` data-by="${node.by}"` : ""} aria-pressed="false">${inner}</button>`
    : `<span class="${cls}">${inner}</span>`;
  const end = (node, cls = "ep") => `<span class="${cls}">${e(node.text || "end")}</span>`;
  const fork = (branches) => `<div class="fork${branches.every((b) => b.ends) ? " stop" : ""}" style="--n:${branches.length}">` +
    branches.map((b) => `<div class="br">${ED}<span class="lbl">${e(b.outcome)}</span>${block(b.children ?? [])}${b.ends ? "" : ED}</div>`).join("") + "</div>";
  const failRow = (onfail) => {
    const ends = onfail.children.filter((kid) => kid.kind === "end"), rest = onfail.children.filter((kid) => kid.kind !== "end");
    return (rest.length ? `<div class="z">${block(rest)}</div>` : "") +
      `<span class="fl">fail ${ends.length ? ends.map((kid) => end(kid, "ep fail")).join("") : `<span class="ep">${e(onfail.prose || "continues")}</span>`}</span>`;
  };
  const one = (node) => {
    const head = `<i>${node.by}</i><b>${e(node.name ?? "")}</b>`;
    const q = node.question ? `<span class="q">${e(node.question)}</span>` : "";
    switch (node.kind) {
      case "phase": return `<div class="pb">${pair ? card(node, "a", `<span>phase</span>${e(node.name)}`) : `<div class="a"><span>phase</span>${e(node.name)}</div>`}<div class="z">${block(node.children)}</div></div>`;
      case "step": return card(node, `n ${node.by}`, head) + (node.onfail ? failRow(node.onfail) : "");
      case "decide": return card(node, `n ${node.by} dec`, head + q) + ED + fork([...node.whens, ...(node.implied ?? [])]);
      case "gate": {
        const branches = [...node.whens, ...node.implied.filter((b) => b.outcome !== "revise")];
        return card(node, "n human gate", head + q) + (node.whens.length ? ED + fork(branches) : "");
      }
      case "end": return end(node);
      default: fail(`examples/${name}.kdl: the site cannot draw a ${node.kind} node`);
    }
  };
  const block = (nodes) => nodes.map(one).join(ED);
  const c = model.context;
  const ctx = c && (c.inputs.length || c.outputs.length || c.invariants.length) ? '<div class="ctx"><b>context</b>' +
    (c.inputs.length || c.outputs.length ? `<div>${c.inputs.map((d) => `<span class="chip">in ${e(d.name)}</span>`).join("")}${c.outputs.map((d) => `<span class="chip out">out${d.name ? ` ${e(d.name)}` : ""}</span>`).join("")}</div>` : "") +
    c.invariants.map((inv) => `<div><span class="inv${inv.by ? ` ${inv.by}` : ""}"${pair && inv.by ? ` data-by="${inv.by}"` : ""}>${e(inv.text)}</span></div>`).join("") + "</div>" : "";
  return [ctx, block(model.flow)].filter(Boolean).join(ED);
}

const licenseParts = (text) => ({license: text.trim().split("\n")[0].trim(), copyright: text.split("\n").find((line) => /^Copyright\b/.test(line))?.trim() ?? "", text: text.trim()});
const parts = [{name: "SkillFlow", version, ...licenseParts(read(resolve(args.license)))}];
const vendorDir = join(skill, "scripts", "_vendor");
for (const dir of readdirSync(vendorDir).sort()) {
  if (!existsSync(join(vendorDir, dir, "PIN.json"))) continue;
  const pin = JSON.parse(read(join(vendorDir, dir, "PIN.json")));
  parts.push({name: pin.package, version: pin.version, ...licenseParts(read(join(vendorDir, dir, "LICENSE.md")))});
}
for (const part of parts) if (!part.copyright) fail(`the license of ${part.name} has no Copyright line`);
const notices = '<div class="tw" tabindex="0" role="region" aria-label="Licenses"><table>\n<thead><tr><th>Part</th><th>Version</th><th>Copyright</th><th>License</th></tr></thead>\n<tbody>\n' +
  parts.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td><code>${escapeHtml(p.version)}</code></td><td style="white-space:normal">${escapeHtml(p.copyright)}</td><td>${escapeHtml(p.license)}</td></tr>`).join("\n") +
  "\n</tbody></table></div>\n" +
  parts.map((p) => `<details><summary>License text of ${escapeHtml(p.name)}</summary><pre>${escapeHtml(p.text)}</pre></details>`).join("\n");

// 3. fill the page and check it
const template = read(join(SITE, "index.html"));

const fills = {"version": escapeHtml(version), "viewer-css": viewerCss, "license-notices": notices};
// `pair` variants pair code lines with graph nodes; use them only inside the <figure data-pair> of one example
const page = template.replace(/<!--(flow|flow-body|flow-pair|graph|graph-pair):([\w-]+)-->/g, (_, kind, name) =>
  kind.startsWith("graph") ? graphHtml(name, kind === "graph-pair") : flowHtml(name, kind === "flow-body", kind === "flow-pair"))
  .replace(/<!--([\w-]+)-->/g, (match, name) => fills[name] ?? match);
const left = [...new Set(page.match(/<!--[\s\S]*?-->/g) ?? [])];
if (left.length) fail(`unfilled placeholder: ${left.join(", ")}`);

// prose outside code, tables, and figures, per section
const prose = (html) => ["pre", "code", "table", "figure"].reduce((text, tag) => text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " "), html)
  .replace(/<[^>]+>/g, " ").replace(/&[#\w]+;/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
const counts = [];
for (const [, id, html] of page.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
  const words = prose(html).length;
  counts.push(`${id} ${words}`);
  if (words > MAX_WORDS) fail(`section #${id} has ${words} words of prose outside code and tables; the limit is ${MAX_WORDS}`);
}

// 4. write the three pages
mkdirSync(out, {recursive: true});
writeFileSync(join(out, "index.html"), page);
const flow = join(skill, "flow.kdl");
for (const [dir, argv] of [["flow", ["render", flow, "-o"]], ["play", ["edit", flow, "--offline"]]]) {
  mkdirSync(join(out, dir), {recursive: true});
  const result = run(...argv, join(out, dir, "index.html"));
  if (result.status !== 0) fail(`${argv[0]} of ${flow} failed:\n${result.stdout}${result.stderr}`);
}
console.log(`examples: ${examples.length} valid · words per section: ${counts.join(", ")}`);
console.log(`wrote ${join(out, "index.html")}, ${join(out, "flow", "index.html")}, ${join(out, "play", "index.html")} (SkillFlow ${version})`);
