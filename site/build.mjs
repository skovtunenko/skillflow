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

// 1. every example passes lint, the format check and the validator, with no warning and no todo
const examples = readdirSync(join(SITE, "examples")).filter((name) => name.endsWith(".kdl")).sort();
const lint = {};
for (const name of examples) {
  // run from examples/, so lint prints the file name, not a path
  const result = spawnSync(process.execPath, [cli, "lint", name], {encoding: "utf8", cwd: join(SITE, "examples")}), lines = result.stdout.split("\n");
  if (result.status !== 0 || !/^unchanged /.test(lines[0]) || !/^OK [^·]*$/.test(lines[1] ?? "")) fail(`example ${name} does not pass lint:\n${result.stdout}${result.stderr}`);
  // the Modes section shows the real output of lint: the format line, the OK line, its counts, tools, and invariants (not the versions, which change with each release)
  lint[name] = lines.slice(0, 5).join("\n");
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
const load = (name, text) => models.set(name, {text, model: buildModel(parseFlow(text), text, name, `${name}.kdl`, [])});
/** {text, model} of examples/<name>.kdl, or of a tutorial step that the build loaded. */
function example(name) {
  if (!models.has(name)) {
    if (!examples.includes(`${name}.kdl`)) fail(`index.html names examples/${name}.kdl, which does not exist`);
    load(name, read(join(SITE, "examples", `${name}.kdl`)).replace(/\n$/, ""));
  }
  return models.get(name);
}
const children = (node) => [...(node.children ?? []), ...(node.whens ?? []).flatMap((branch) => branch.children), ...(node.catch?.children ?? [])];
const walk = (nodes) => nodes.flatMap((node) => [node, ...walk(children(node))]);

/** The highlighted lines of an example. With `pair`, a line that starts a node or an invariant carries its name and executor;
 * a line in `added` is marked as new. */
function flowHtml(name, body, pair, added) {
  const {text, model} = example(name);
  const marks = new Map();
  if (pair) {
    for (const node of walk(model.flow)) if (node.name) marks.set(node.line, {node: node.name, by: node.by});
    for (const inv of model.context?.invariants ?? []) if (inv.by) marks.set(inv.line, {by: inv.by});
  }
  const skip = body ? /^skillflow\b.*\n+/.exec(text)?.[0].split("\n").length - 1 : 0;
  return htmlLines(text.split("\n").slice(skip).join("\n"), kdl.sfKdl.tokenize).map((html, index) => {
    const mark = marks.get(index + 1 + skip) ?? {};
    return `<span class="ln${added?.has(index + 1 + skip) ? " add" : ""}"${mark.node ? ` data-node="${escapeHtml(mark.node)}"` : ""}${mark.by ? ` data-by="${mark.by}"` : ""}>${html}</span>`;
  }).join("\n");
}

const ED = '<span class="ed"></span>';
/** The graph of an example, in the look of the viewer's cards. With `pair`, nodes are buttons that pair with code lines.
 * `marks` maps a part of the model to "new" or "chg", the class that marks it as added or changed. */
function graphHtml(name, pair, marks) {
  const {model} = example(name), e = escapeHtml;
  const m = (part) => marks?.has(part) ? ` ${marks.get(part)}` : "";
  const card = (node, cls, inner) => pair
    ? `<button type="button" class="${cls}${m(node)}" data-node="${e(node.name)}"${node.by ? ` data-by="${node.by}"` : ""} aria-pressed="false">${inner}</button>`
    : `<span class="${cls}${m(node)}">${inner}</span>`;
  const end = (node, cls = "ep") => `<span class="${cls}${m(node)}">${e(node.text || "end")}</span>`;
  const fork = (branches) => `<div class="fork${branches.every((b) => b.ends) ? " stop" : ""}" style="--n:${branches.length}">` +
    branches.map((b) => `<div class="br">${ED}<span class="lbl">${e(b.outcome)}</span>${block(b.children ?? [])}${b.ends ? "" : ED}</div>`).join("") + "</div>";
  const failRow = (caught) => {
    const ends = caught.children.filter((kid) => kid.kind === "end"), rest = caught.children.filter((kid) => kid.kind !== "end");
    return (rest.length ? `<div class="z">${block(rest)}</div>` : "") +
      `<span class="fl">fail ${ends.length ? ends.map((kid) => end(kid, "ep fail")).join("") : `<span class="ep">${e(caught.prose || "continues")}</span>`}</span>`;
  };
  const one = (node) => {
    // the spaces keep the words apart in the accessible name; a flex container does not draw them
    const head = `<i>${node.by}</i> <b>${e(node.name ?? "")}</b>`;
    const q = node.question ? ` <span class="q">${e(node.question)}</span>` : "";
    switch (node.kind) {
      case "phase": return `<div class="pb">${pair ? card(node, "a", `<span>phase</span> ${e(node.name)}`) : `<div class="a${m(node)}"><span>phase</span> ${e(node.name)}</div>`}<div class="z">${block(node.children)}</div></div>`;
      case "step": {
        // a catch that only ends the flow is a footnote of its card, as on the flow page, so the line of the flow stays whole
        const stop = node.catch && node.catch.children.length && node.catch.children.every((kid) => kid.kind === "end");
        const foot = stop ? ` <span class="ft">fail ${node.catch.children.map((kid) => end(kid, "ep fail")).join("")}</span>` : "";
        return card(node, `n ${node.by}`, head + foot) + (node.catch && !stop ? failRow(node.catch) : "");
      }
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
  const ctx = c && (c.inputs.length || c.outputs.length || c.invariants.length) ? `<div class="ctx${m(c)}"><b>context</b>` +
    (c.inputs.length || c.outputs.length ? `<div>${c.inputs.map((d) => `<span class="chip${m(d)}">in ${e(d.name)}</span>`).join("")}${c.outputs.map((d) => `<span class="chip out${m(d)}">out${d.name ? ` ${e(d.name)}` : ""}</span>`).join("")}</div>` : "") +
    c.invariants.map((inv) => `<div><span class="inv${inv.by ? ` ${inv.by}` : ""}${m(inv)}"${pair && inv.by ? ` data-by="${inv.by}"` : ""}>${e(inv.text)}</span></div>`).join("") + "</div>" : "";
  return [ctx, block(model.flow)].filter(Boolean).join(ED);
}

// the tutorial: tutorial/<n>-<slug>.kdl, numbered from 1 with no gap. Line 1 of each is "// <title> | <sentence>"; the rest is a
// flow that the validator accepts. Each step changes the flow, and the last one is the flow of the first example.
const TUTOR_WORDS = 20;
const steps = readdirSync(join(SITE, "tutorial")).filter((name) => name.endsWith(".kdl"))
  .map((file) => ({file, n: Number(/^(\d+)-[a-z0-9-]+\.kdl$/.exec(file)?.[1])})).sort((a, b) => a.n - b.n);
steps.forEach((step, i) => {
  const where = `tutorial/${step.file}`;
  if (step.n !== i + 1) fail(`${where}: name the steps 1-<slug>.kdl, 2-<slug>.kdl, … with no gap`);
  const result = run("validate", join(SITE, "tutorial", step.file));
  if (result.status !== 0 || !/^OK [^·]*$/.test(result.stdout.split("\n")[0])) fail(`${where} does not pass the validator:\n${result.stdout}${result.stderr}`);
  const [first, ...rest] = read(join(SITE, "tutorial", step.file)).replace(/\n$/, "").split("\n");
  const note = /^\/\/ (.+?) \| (.+)$/.exec(first);
  if (!note) fail(`${where}: line 1 must be "// <title> | <sentence>"`);
  [step.title, step.say] = [note[1], note[2]];
  const words = `${step.title} ${step.say}`.split(/\s+/).length;
  if (words > TUTOR_WORDS) fail(`${where}: the note has ${words} words; the limit is ${TUTOR_WORDS}`);
  step.text = rest.join("\n");
  load(`tutorial-${step.n}`, step.text);
  if (i && step.text === steps[i - 1].text) fail(`${where} does not change the flow of step ${i}`);
});
if (!steps.length) fail("tutorial/ has no step");
if (steps.at(-1).text !== example("release-notes").text) fail(`tutorial/${steps.at(-1).file} must end at the flow of examples/release-notes.kdl`);

// the language on the site: each node, property, and executor of the validator is in an example or a tutorial step, or listed
// here with the reason. A release that adds one to the language stops the build until the site shows it or lists it here.
const NOT_SHOWN = {
  "tools": "an advanced node: the tutorial keeps to the skeleton of a flow",
  "file=": "names a file of the skill; the examples have no skill folder",
  "ref=": "links a node to a label of the skill; the examples have no skill folder",
  "skill-version=": "a stamp that reverse and sync write, not the author",
  "skillflow-version=": "a stamp that reverse and sync write, not the author",
};
{
  const {CHILDREN, PROPS, EXECUTORS} = await import(pathToFileURL(join(skill, "scripts", "validate.mjs")).href);
  const language = [...new Set([...Object.keys(CHILDREN).filter(Boolean), ...Object.values(CHILDREN).flat(),
    ...Object.values(PROPS).flat().map((prop) => `${prop}=`), ...EXECUTORS.map((by) => `by=${by}`)])];
  // node names start a line; properties are word=; strings and comments say nothing about the vocabulary
  const shown = new Set();
  const texts = [...examples.map((name) => example(name.slice(0, -4)).text), ...steps.map((step) => step.text)];
  for (const text of texts.map((t) => t.replace(/"""[\s\S]*?"""/g, '""').replace(/#*"(?:\\.|[^"\\])*"#*/g, '""').replace(/\/\/.*$/gm, ""))) {
    for (const [, name] of text.matchAll(/^\s*([a-z][a-z-]*)/gm)) shown.add(name);
    for (const [, prop, value] of text.matchAll(/\b([a-z][a-z-]*)=([a-z]*)/g)) { shown.add(`${prop}=`); if (prop === "by") shown.add(`by=${value}`); }
  }
  const missing = language.filter((word) => !shown.has(word) && !(word in NOT_SHOWN));
  if (missing.length) fail(`the language has ${missing.join(", ")}, which no example and no tutorial step shows. Show each one, or add it to NOT_SHOWN in build.mjs with the reason`);
  const stale = Object.keys(NOT_SHOWN).filter((word) => !language.includes(word) || shown.has(word));
  if (stale.length) fail(`NOT_SHOWN in build.mjs lists ${stale.join(", ")}, which the language no longer has or the site now shows; remove it`);
}

/** The lines of `after` that are not in `before`, as 1-based numbers; indentation does not count, so a wrapped block is not new. */
function addedLines(before, after) {
  const a = before.split("\n").map((l) => l.trim()), b = after.split("\n").map((l) => l.trim());
  const lcs = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const added = new Set();
  let removed = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) added.add(++j); else { i++; removed++; }
  }
  for (const line of added) if (!b[line - 1]) added.delete(line);  // a blank line is layout
  return {added, removed};
}
// the own fields of a part: no position, no children, so a moved or wrapped node is not changed
const OWN = new Set(["id", "line", "step", "children", "unclear", "words", "nodes"]);
const own = (part) => JSON.stringify(part, (key, value) => OWN.has(key) ? undefined : value);
/** Each part of the model of step `n`, keyed by what names it. */
function stepParts(n) {
  const {model} = example(`tutorial-${n}`), out = new Map(), c = model.context;
  for (const node of walk(model.flow)) out.set(node.name ? `${node.kind} ${node.name}` : `${node.kind} ${node.text ?? node.outcome ?? node.id}`, node);
  if (c && (c.inputs.length || c.outputs.length || c.invariants.length)) {
    out.set("context", {...c, inputs: [], outputs: [], invariants: []});
    for (const d of c.inputs) out.set(`in ${d.name}`, d);
    for (const d of c.outputs) out.set(`out ${d.name}`, d);
    for (const inv of c.invariants) out.set(`inv ${inv.text}`, inv);
  }
  return out;
}
/** Map from a part of step `n` to "new" when step n-1 lacks it, or "chg" when its own fields differ. */
function partMarks(n) {
  const now = stepParts(n), before = n > 1 ? stepParts(n - 1) : new Map(), out = new Map();
  for (const [key, part] of now) {
    const real = key === "context" ? example(`tutorial-${n}`).model.context : part;
    if (!before.has(key)) out.set(real, "new"); else if (own(before.get(key)) !== own(part)) out.set(real, "chg");
  }
  return out;
}
const tutorial = (() => {
  const e = escapeHtml, total = steps.length;
  const rail = steps.map((s) => `<button type="button" class="st" role="tab" id="tt-${s.n}" aria-controls="tp-${s.n}" aria-selected="${s.n === 1}"${s.n === 1 ? "" : ' tabindex="-1"'}>` +
    `<span class="sn" aria-hidden="true">${s.n}</span><span class="stt">${e(s.title)}</span></button>`).join("");
  const panels = steps.map((s) => {
    const {added, removed} = addedLines(s.n > 1 ? steps[s.n - 2].text : "", s.text);
    const delta = `<span class="tag add">+${added.size}</span>${removed ? `<span class="tag del">−${removed}</span>` : ""}`;
    return `<div class="tpn" role="tabpanel" id="tp-${s.n}" aria-labelledby="tt-${s.n}">` +
      `<div class="tnote"><span class="tct">Step ${s.n} of ${total}</span><h3>${e(s.title)}</h3><p>${e(s.say)}</p></div>` +
      `<div class="ex tex" data-pair><div class="exbar"><span class="file">flow.kdl</span><span class="delta" title="lines added and removed in this step">${delta}</span>` +
      `<span class="legend" aria-hidden="true"><i class="new"></i>new<i class="chg"></i>changed</span></div>` +
      `<div class="split"><div class="src"><pre class="kdl lines" tabindex="0" aria-label="Flow file of step ${s.n}"><code>${flowHtml(`tutorial-${s.n}`, false, true, added)}</code></pre></div>` +
      `<div class="cv">${graphHtml(`tutorial-${s.n}`, true, partMarks(s.n))}</div></div></div></div>`;
  }).join("\n");
  // index.html puts Back and Next between the two, so the reading order is rail, controls, step
  return {rail: `<div class="rail" role="tablist" aria-label="Steps of the tutorial" aria-orientation="vertical">${rail}</div>`, panels: `<div class="tpanels">\n${panels}\n</div>`};
})();

// the sections of Help, from the section links of the skill's help.html: the site links to them in the playground
const helpToc = /<nav class="help-toc"[\s\S]*?<\/nav>/.exec(read(join(skill, "assets", "help.html")))?.[0] ?? "";
const chapters = [...helpToc.matchAll(/<a href="#(h-[a-z0-9-]+)">(?:(\d+) · )?([^<]+)<\/a>/g)].map(([, id, n, title], i) => ({id, n: n ?? String(i + 1), title}));
if (!chapters.length) fail("assets/help.html has no section links in <nav class=\"help-toc\">");
const helpLinks = chapters.map((c) => `<a class="ch" href="play/#${c.id}" data-help="${c.id}"><span class="cn" aria-hidden="true">${c.n}</span>${escapeHtml(c.title)}</a>`).join("");

const licenseParts = (text) => ({license: text.trim().split("\n")[0].trim(), copyright: text.split("\n").find((line) => /^Copyright\b/.test(line))?.trim() ?? "", text: text.trim()});
const parts = [{name: "SkillFlow", version, url: "https://github.com/skovtunenko/skillflow", ...licenseParts(read(resolve(args.license)))}];
const vendorDir = join(skill, "scripts", "_vendor");
// the project link of a third-party part comes from the notice in the skill's help.html, which links its name
const helpHtml = read(join(skill, "assets", "help.html"));
for (const dir of readdirSync(vendorDir).sort()) {
  if (!existsSync(join(vendorDir, dir, "PIN.json"))) continue;
  const pin = JSON.parse(read(join(vendorDir, dir, "PIN.json")));
  const url = [...helpHtml.matchAll(/<a href="(https:[^"]+)"[^>]*>([^<]+)<\/a>/g)].find(([, , text]) => text === pin.package)?.[1];
  if (!url) fail(`assets/help.html has no link whose text is ${pin.package}; the site links each third-party part to its project`);
  parts.push({name: pin.package, version: pin.version, url, ...licenseParts(read(join(vendorDir, dir, "LICENSE.md")))});
}
for (const part of parts) if (!part.copyright) fail(`the license of ${part.name} has no Copyright line`);
// one card per part; a figure, so the notices do not count as section prose
const CHEVRON = '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
const EXT = '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v4h-9v-9h4"/></svg>';
const notices = '<figure class="lic" aria-label="Licenses">\n' + parts.map((p) => {
  const e = escapeHtml;
  return `<article class="lc"><div class="lc-h"><h3><a href="${e(p.url)}" rel="noreferrer">${e(p.name)}${EXT}<span class="sr"> project page</span></a></h3><span class="v">${e(p.version)}</span><span class="spdx">${e(p.license)}</span></div>` +
    `<p class="cr">${e(p.copyright)}</p><details><summary>${CHEVRON}License text<span class="sr"> of ${e(p.name)}</span></summary><pre tabindex="0">${e(p.text)}</pre></details></article>`;
}).join("\n") + "\n</figure>";

// 3. fill the page and check it
const template = read(join(SITE, "index.html"));

const fills = {"version": escapeHtml(version), "viewer-css": viewerCss, "license-notices": notices, "tutorial-rail": tutorial.rail, "tutorial-panels": tutorial.panels,"steps": String(steps.length), "help-chapters": helpLinks, "lint-release-notes": escapeHtml(lint["release-notes.kdl"] ?? fail("examples/release-notes.kdl is missing"))};
// `pair` variants pair code lines with graph nodes; use them only inside the <figure data-pair> of one example
const page = template.replace(/<!--(flow|flow-body|flow-pair|graph|graph-pair):([\w-]+)-->/g, (_, kind, name) =>
  kind.startsWith("graph") ? graphHtml(name, kind === "graph-pair") : flowHtml(name, kind === "flow-body", kind === "flow-pair"))
  .replace(/<!--([\w-]+)-->/g, (match, name) => fills[name] ?? match);
const left = [...new Set(page.match(/<!--[\s\S]*?-->/g) ?? [])];
for (const [, id] of page.matchAll(/href="play\/#(h-[a-z0-9-]+)"/g)) if (!chapters.some((c) => c.id === id)) fail(`index.html links to play/#${id}, which assets/help.html does not have`);
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
console.log(`examples: ${examples.length} valid · tutorial steps: ${steps.length} valid · words per section: ${counts.join(", ")}`);
console.log(`wrote ${join(out, "index.html")}, ${join(out, "flow", "index.html")}, ${join(out, "play", "index.html")} (SkillFlow ${version})`);
