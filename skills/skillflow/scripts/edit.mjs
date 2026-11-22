// `edit`: a local server for one flow. It serves the editor page, saves the flow file, and tells the page when files change.
// It reads only the flow file, its skill folder, and SkillFlow's own folder, and it writes only the flow file.
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {realpathSync, watch, writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {dirname, sep} from "node:path";
import {InvalidKdlError} from "./_vendor/bgotink-kdl/index.js";
import {resolveTarget} from "./ctl.mjs";
import {editorPage, places, tree} from "./edit-page.mjs";
import {readText, real, saveFlow} from "./flow-file.mjs";
import {InputError, load, READ_LIMIT, reason} from "./validate.mjs";

// a save sends the loaded text and the new text, each at most a flow file's size, as JSON
const BODY_LIMIT = 4 * READ_LIMIT;

/** The request body as text; an error with `status` 413 when it is larger than the limit. */
async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("the text is too large"), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function reply(response, status, type, body) {
  response.writeHead(status, {"content-type": type, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff"});
  response.end(body);
}

/**
 * Start the editor server for `flow` and its skill folder (or null) on 127.0.0.1, on a free port.
 * Resolves to {url, close}; the url holds a random token, and a request without it gets 404.
 */
export function startEditor(flow, skill) {
  const root = `/${randomBytes(16).toString("hex")}/`, clients = new Set(), where = places(flow, skill);
  // the skill's files without the flow file, which has its own event
  const skillFiles = () => (skill ? tree(skill, where.skill, (file) => `${where.skill}/${file}` !== where.flow) : {});
  // what the pages have: the watcher sends only what differs from it
  const seen = {flow: readText(flow), files: JSON.stringify(skillFiles()), timer: null, poll: null};
  const send = (event, data) => { for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  // shortcut: every change reads the whole skill folder again; fine for a skill's few hundred small files, compare by mtime when a folder is slow
  function look() {
    try {
      const text = readText(flow), files = skillFiles(), json = JSON.stringify(files);
      if (text !== seen.flow) { seen.flow = text; send("flow", {text}); }
      if (json !== seen.files) { seen.files = json; send("files", {files}); }
    } catch { /* a file in the middle of a write: the next change event looks again */ }
  }
  // the folder, not the file: a rename over the flow file gives it a new inode, and a watch on the old one goes silent
  const folders = [[dirname(real(flow)), false], ...(skill ? [[realpathSync(skill), true]] : [])];
  const watchers = folders.map(([folder, recursive]) => watch(folder, {recursive}, () => {
    clearTimeout(seen.timer);
    seen.timer = setTimeout(look, 60); // an editor writes a file in several steps: wait until they end
    // a system that cannot watch (no free watch handles, some network disks): look once a second instead
  }).on("error", () => { seen.poll ??= setInterval(look, 1000); }));

  async function handle(request, response) {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const route = path.startsWith(root) ? `${request.method} ${path.slice(root.length)}` : null;
    if (route === "GET ") return reply(response, 200, "text/html; charset=utf-8", editorPage(flow, skill, true));
    if (route === "GET events") {
      response.writeHead(200, {"content-type": "text/event-stream", "cache-control": "no-store"});
      // the flow and the skill's files as they are now: they may have changed after the page was sent or while it was cut off;
      // a page ignores a text it already has
      response.write(`retry: 1000\n\nevent: flow\ndata: ${JSON.stringify({text: readText(flow)})}\n\n`);
      if (skill) response.write(`event: files\ndata: ${JSON.stringify({files: skillFiles()})}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (route === "PUT flow") {
      const {base, text} = JSON.parse(await bodyOf(request));
      if (typeof text !== "string" || (base !== null && typeof base !== "string")) throw Object.assign(new Error("a save needs {base, text}"), {status: 400});
      const result = saveFlow(flow, base, text);
      // every open page of this flow gets the saved text; the page that saved it already has it
      if (result.saved) { seen.flow = text; send("flow", {text}); }
      return reply(response, result.saved ? 200 : 409, "application/json", JSON.stringify(result));
    }
    reply(response, 404, "text/plain; charset=utf-8", "not found\n");
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = error.status ?? (error instanceof SyntaxError ? 400 : 500);
      if (response.headersSent) response.end(); else reply(response, status, "application/json", JSON.stringify({error: status === 500 ? reason(error) : error.message}));
    });
  });
  const unwatch = () => {
    clearTimeout(seen.timer);
    clearInterval(seen.poll);
    for (const watcher of watchers) watcher.close();
  };
  const close = () => new Promise((done) => {
    unwatch();
    server.close(done);
    server.closeAllConnections(); // the event streams stay open until the server ends them
  });
  return new Promise((started, failed) => {
    // a server that cannot listen ends its watchers too: open ones keep the process alive after the error
    server.once("error", (error) => { unwatch(); failed(error); });
    server.listen(0, "127.0.0.1", () => started({url: `http://127.0.0.1:${server.address().port}${root}`, close}));
  });
}

/** Open `url` in the person's browser; a machine without one keeps the printed url. */
function openBrowser(url) {
  const [command, ...args] = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(command, args, {stdio: "ignore", detached: true}).on("error", () => {}).unref();
}

/** `edit SKILL`: serve the editor until the person stops it; with --offline, write one offline page and return. */
export function runEdit(args) {
  const {flow, skill} = resolveTarget(args.target);
  // a flow that does not parse is what the editor is for; a file that cannot be read is an input error
  try { load(flow); } catch (error) { if (!(error instanceof InvalidKdlError)) throw error; }
  if (args.offline !== undefined) {
    const page = real(args.offline);
    // the page holds a copy of the skill's files: inside the skill folder it would ship with the skill
    if (page === real(flow) || (skill && page.startsWith(real(skill) + sep))) throw new InputError(`${args.offline}: the page must be outside the flow file and the skill folder`);
    try { writeFileSync(page, editorPage(flow, skill, false)); } catch (error) { throw new InputError(`${args.offline}: cannot write: ${reason(error)}`); }
    console.log(`offline editor of ${flow} -> ${args.offline}\n  next: open the page in a browser; it saves through the browser, to a file you link or as a download`);
    return 0;
  }
  return startEditor(flow, skill).then(({url, close}) => {
    console.log(`editing ${flow}\n  ${url}\n  Save in the page writes ${flow}; Ctrl+C here stops the editor`);
    if (process.stdout.isTTY) openBrowser(url);
    return new Promise((stopped) => { for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => close().then(() => stopped(0))); });
  });
}
