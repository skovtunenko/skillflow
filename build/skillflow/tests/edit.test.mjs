// `edit`: the local editor server, its save and conflict rules, the change events, and the offline page.
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {tmpDir} from "./tmp.mjs";
import {SKILL, skillUrl} from "./skill-path.mjs";
const {importMap, places, tree} = await import(skillUrl("scripts/edit-page.mjs"));
const {startEditor} = await import(skillUrl("scripts/edit.mjs"));
const {replaceFile, saveFlow} = await import(skillUrl("scripts/flow-file.mjs"));

const CLI = path.join(SKILL, "scripts/skillflow.mjs");
const FLOW = 'skillflow 1.0\n\nstep read by=llm "Read the request."\n\nend "done"\n';

/** A skill folder `demo` with a flow file in it; returns {dir, skill, flow}. */
function skillWith(text = FLOW) {
  const dir = fs.realpathSync(tmpDir("skillflow-edit-")), skill = path.join(dir, "demo"), flow = path.join(skill, "flow.kdl");
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo\n");
  fs.writeFileSync(flow, text);
  return {dir, skill, flow};
}
const put = (url, body) => fetch(url + "flow", {method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body)});
const everyFile = (dir) => fs.readdirSync(dir, {recursive: true}).sort();

/**
 * The next `count` events of the server's event stream as [[event, data]]; `ready` resolves when the stream is open.
 * A repeat of the last event of its kind is left out: a slow watcher may send again what the stream started with, and a page ignores it.
 */
function listen(url, count) {
  // a stream that stays silent fails the test after 10 s instead of holding the run
  const stop = new AbortController(), state = {}, signal = AbortSignal.any([stop.signal, AbortSignal.timeout(10000)]);
  const ready = new Promise((open) => { state.open = open; });
  const events = (async () => {
    const response = await fetch(url + "events", {signal}), out = [], last = {};
    state.open();
    let text = "";
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      text += chunk;
      for (let end; (end = text.indexOf("\n\n")) >= 0; text = text.slice(end + 2)) {
        const event = /^event: (\w+)\ndata: (.*)$/m.exec(text.slice(0, end));
        if (event && last[event[1]] !== event[2]) { last[event[1]] = event[2]; out.push([event[1], JSON.parse(event[2])]); }
        if (out.length === count) { stop.abort(); return out; }
      }
    }
    return out;
  })();
  return {ready, events};
}

test("replaceFile writes in one step, keeps the mode, and leaves no temporary file; a read-only file stays", () => {
  const {skill, flow} = skillWith();
  fs.chmodSync(flow, 0o640);
  replaceFile(flow, "new text\n");
  assert.deepEqual([fs.readFileSync(flow, "utf8"), fs.statSync(flow).mode & 0o777, fs.readdirSync(skill)], ["new text\n", 0o640, ["SKILL.md", "flow.kdl"]]);
  // through a symlink: the link stays a link, and its target gets the text
  const link = path.join(skill, "link.kdl");
  fs.symlinkSync(flow, link);
  replaceFile(link, "by link\n");
  assert.deepEqual([fs.readFileSync(flow, "utf8"), fs.lstatSync(link).isSymbolicLink()], ["by link\n", true]);
  fs.chmodSync(flow, 0o440);
  assert.throws(() => replaceFile(flow, "x"), {code: "EACCES"});
  assert.deepEqual([fs.readFileSync(flow, "utf8"), fs.readdirSync(skill).length], ["by link\n", 3]);
});

test("saveFlow writes only over the text the caller loaded", () => {
  const {flow} = skillWith("one\n");
  assert.deepEqual(saveFlow(flow, "one\n", "two\n"), {saved: true});
  assert.deepEqual(saveFlow(flow, "one\n", "three\n"), {saved: false, disk: "two\n"}, "the file changed: no write");
  assert.equal(fs.readFileSync(flow, "utf8"), "two\n");
  fs.rmSync(flow);
  assert.deepEqual(saveFlow(flow, "two\n", "four\n"), {saved: false, disk: null}, "a removed file is a change too");
  assert.deepEqual(saveFlow(flow, null, "four\n"), {saved: true});
  assert.equal(fs.readFileSync(flow, "utf8"), "four\n");
});

test("tree holds a linked file with no text, as the validator reads no linked Markdown for a ref", () => {
  const {skill} = skillWith();
  fs.writeFileSync(path.join(skill, "notes.txt"), "## Alpha\n");
  fs.symlinkSync("notes.txt", path.join(skill, "alias.md"));
  const files = tree(skill, "/skill/demo");
  assert.deepEqual([files["/skill/demo/alias.md"], files["/skill/demo/notes.txt"]], ["", "## Alpha\n"]);
});

test("places keeps a flow inside its skill folder inside it, and puts any other flow apart", () => {
  const {dir, skill, flow} = skillWith();
  assert.deepEqual(places(flow, skill), {skill: "/skill/demo", flow: "/skill/demo/flow.kdl"});
  const apart = path.join(dir, "demo-flow.kdl");
  fs.writeFileSync(apart, FLOW);
  assert.deepEqual(places(apart, skill), {skill: "/skill/demo", flow: "/flow/demo-flow.kdl"});
  assert.deepEqual(places(apart, null), {skill: null, flow: "/flow/demo-flow.kdl"});
});

test("the import map holds every module as a data: URL with no relative import left, and the Node stand-ins", () => {
  const {imports} = importMap(), source = (name) => Buffer.from(imports[name].split(",")[1], "base64").toString("utf8");
  for (const name of ["sf/assets/editor/main.mjs", "sf/scripts/validate.mjs", "sf/scripts/render.mjs", "sf/scripts/fmt.mjs", "sf/scripts/_vendor/bgotink-kdl/index.js", "node:fs", "node:path"])
    assert.match(imports[name] ?? "", /^data:text\/javascript;base64,/, name);
  assert.equal(imports["node:fs"], imports["sf/assets/editor/node-fs.mjs"]);
  for (const name of Object.keys(imports)) {
    // code lines only: a JSDoc type may still name a file
    const code = source(name).split("\n").filter((line) => !/^\s*(\/?\*|\/\/)/.test(line)).join("\n");
    assert.doesNotMatch(code, /\b(?:from|import)\s*["']\.\.?\//, `${name} still has a relative import, which a data: URL cannot resolve`);
    assert.doesNotMatch(code, /import\.meta\.dirname/, name);
    assert.doesNotMatch(code, /from\s*["']node:(?!fs["']|path["'])/, `${name} imports a Node module that the page does not have`);
  }
  assert.match(source("sf/scripts/render.mjs"), /"\/app\/scripts"/);
  // the server and the command line stay out of the page
  assert.deepEqual(Object.keys(imports).filter((name) => /scripts\/(skillflow|ctl|edit|edit-page|flow-file|folder)\.mjs$/.test(name)), []);
});

test("the server answers only with its token, on 127.0.0.1", async () => {
  const {flow, skill} = skillWith(), {url, close} = await startEditor(flow, skill);
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
    const origin = new URL(url).origin;
    for (const wrong of [origin + "/", origin + "/" + "0".repeat(32) + "/", url.slice(0, -1), url + "../"]) assert.equal((await fetch(wrong)).status, 404, wrong);
    assert.equal((await put(origin + "/", {base: FLOW, text: "x"})).status, 404, "no save without the token");
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW);
    const page = await fetch(url), html = await page.text();
    assert.deepEqual([page.status, page.headers.get("content-type"), page.headers.get("cache-control")], [200, "text/html; charset=utf-8", "no-store"]);
    const boot = JSON.parse(/<script type="application\/json" id="sf-editor">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.deepEqual([boot.flow, boot.skill, boot.name, boot.title, boot.server], ["/skill/demo/flow.kdl", "/skill/demo", "flow.kdl", "demo", true]);
    assert.deepEqual([boot.files["/skill/demo/flow.kdl"], boot.files["/skill/demo/SKILL.md"]], [FLOW, "# demo\n"]);
    assert.ok(boot.files["/app/assets/viewer.css"] && boot.files["/app/SKILL.md"], "the viewer and SkillFlow's version are in the page");
    assert.deepEqual(Object.keys(boot.files).filter((file) => file.startsWith("/app/assets/editor/")), [], "the editor's own files are modules, not data");
    assert.equal((await fetch(url + "nothing")).status, 404);
    assert.equal((await fetch(url + "flow", {method: "DELETE"})).status, 404);
  } finally { await close(); }
});

test("a save writes the flow file and no other file; a save over an unseen change is refused with the disk text", async () => {
  const {dir, flow, skill} = skillWith(), {url, close} = await startEditor(flow, skill);
  try {
    const before = everyFile(dir);
    const saved = await put(url, {base: FLOW, text: FLOW + "// mine\n"});
    assert.deepEqual([saved.status, await saved.json()], [200, {saved: true}]);
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW + "// mine\n");
    assert.deepEqual(everyFile(dir), before, "no new file: the temporary file is gone");
    // another program writes; the page still holds the old text
    fs.writeFileSync(flow, FLOW + "// theirs\n");
    const refused = await put(url, {base: FLOW + "// mine\n", text: FLOW + "// mine 2\n"});
    assert.deepEqual([refused.status, await refused.json()], [409, {saved: false, disk: FLOW + "// theirs\n"}]);
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW + "// theirs\n", "the other program's text stays");
    // the person chose their own version: the page sends the disk text it has now seen
    assert.equal((await put(url, {base: FLOW + "// theirs\n", text: FLOW + "// mine 2\n"})).status, 200);
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW + "// mine 2\n");
    for (const bad of ["{", {text: 5, base: ""}, {base: FLOW}, {base: 1, text: ""}]) {
      const answer = await put(url, bad);
      assert.deepEqual([answer.status, typeof (await answer.json()).error], [400, "string"], JSON.stringify(bad));
    }
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW + "// mine 2\n");
    assert.deepEqual(everyFile(dir), before);
  } finally { await close(); }
});

test("a save that cannot write says why and leaves the file", async () => {
  const {flow, skill} = skillWith(), {url, close} = await startEditor(flow, skill);
  try {
    fs.chmodSync(flow, 0o440);
    const answer = await put(url, {base: FLOW, text: "x"});
    assert.deepEqual([answer.status, await answer.json()], [500, {error: "permission denied"}]);
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW);
  } finally { await close(); }
});

test("the event stream tells of a change to the flow file, of a change in the skill folder, and of a save", async () => {
  const {flow, skill} = skillWith(), {url, close} = await startEditor(flow, skill);
  try {
    // a change after the page was sent and before it listens: the stream starts with the flow and the skill's files as they are now
    fs.writeFileSync(flow, FLOW + "// early\n");
    fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo, early\n");
    await new Promise((done) => setTimeout(done, 400));
    const stream = listen(url, 5);
    await stream.ready;
    // as an editor saves: a new file renamed over the old one
    fs.writeFileSync(flow + ".swap", FLOW + "// outside\n");
    fs.renameSync(flow + ".swap", flow);
    await new Promise((done) => setTimeout(done, 400));
    fs.mkdirSync(path.join(skill, "scripts"));
    fs.writeFileSync(path.join(skill, "scripts", "new.sh"), "echo hi\n");
    await new Promise((done) => setTimeout(done, 400));
    await put(url, {base: FLOW + "// outside\n", text: FLOW});
    const events = await stream.events;
    assert.deepEqual(events[0], ["flow", {text: FLOW + "// early\n"}]);
    assert.deepEqual(events[1], ["files", {files: {"/skill/demo/SKILL.md": "# demo, early\n"}}], "a page that connects again gets the files it missed");
    assert.deepEqual(events[2], ["flow", {text: FLOW + "// outside\n"}]);
    assert.deepEqual(events[3], ["files", {files: {"/skill/demo/SKILL.md": "# demo, early\n", "/skill/demo/scripts/new.sh": "echo hi\n"}}], "the skill's files without the flow file");
    assert.deepEqual(events[4], ["flow", {text: FLOW}], "a save reaches the other pages of the flow");
  } finally { await close(); }
});

test("edit --offline writes one page outside the skill folder and starts no server", () => {
  const {dir, skill, flow} = skillWith(), page = path.join(dir, "editor.html");
  const run = (...args) => spawnSync("node", [CLI, "edit", ...args], {encoding: "utf8", cwd: dir});
  const ok = run(flow, "--offline", page);
  assert.deepEqual([ok.status, ok.stderr], [0, ""]);
  assert.match(ok.stdout, /^offline editor of demo\/flow\.kdl -> .*editor\.html\n {2}next: open the page in a browser/);
  const html = fs.readFileSync(page, "utf8");
  assert.equal(JSON.parse(/id="sf-editor">([\s\S]*?)<\/script>/.exec(html)[1]).server, false);
  assert.doesNotMatch(html, /\{\{\w+\}\}/, "every part of the template is filled");
  const inside = run("demo", "--offline", path.join(skill, "editor.html"));
  assert.deepEqual([inside.status, inside.stderr.split("\n")[0]], [2, `error: ${path.join(skill, "editor.html")}: the page must be outside the flow file and the skill folder`]);
  assert.equal(run("demo", "--offline", flow).status, 2);
  assert.equal(fs.readFileSync(flow, "utf8"), FLOW);
  assert.deepEqual([run("none").status, run("none").stderr.split("\n")[0]], [2, "error: no flow named none; flows here: demo"]);
});

test("edit prints the url, serves until it is stopped, and exits 0", async () => {
  const {dir, flow} = skillWith();
  const child = spawn("node", [CLI, "edit", "demo"], {cwd: dir, stdio: ["ignore", "pipe", "inherit"]});
  try {
    let out = "";
    for await (const chunk of child.stdout) { out += chunk; if (out.includes("Ctrl+C")) break; }
    const url = /http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\//.exec(out)[0];
    assert.match(out, /^editing demo\/flow\.kdl\n {2}http:.*\n {2}Save in the page writes demo\/flow\.kdl; Ctrl\+C here stops the editor\n$/);
    assert.equal((await put(url, {base: FLOW, text: FLOW + "// saved\n"})).status, 200);
    assert.equal(fs.readFileSync(flow, "utf8"), FLOW + "// saved\n");
    const exit = new Promise((done) => child.once("exit", done));
    child.kill("SIGINT");
    assert.equal(await exit, 0);
  } finally { child.kill("SIGKILL"); }
});
