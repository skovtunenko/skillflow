// Vendors the KDL v2 parser @bgotink/kdl into the SkillFlow skill (OpenSpec change
// productivity-skillflow-port-to-javascript, design D4). Node built-ins only; no bundler.
//
//   node build/productivity/skillflow/vendor-kdl.mjs --outdated          pinned and registry versions
//   node build/productivity/skillflow/vendor-kdl.mjs --check             vendored files = pinned package files
//   node build/productivity/skillflow/vendor-kdl.mjs --update [VERSION]  vendor VERSION (default: latest) after tests pass
//   node build/productivity/skillflow/vendor-kdl.mjs --suite [DIR]       KDL 2.0.0 test suite on DIR (default: vendored)
//
// Every mode except --suite on a local DIR needs the network. Behind an HTTP proxy, set NODE_USE_ENV_PROXY=1.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, posix, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";
import {ROOT, SKILL} from "./tests/skill-path.mjs";

const VENDOR = join(SKILL, "scripts/_vendor/bgotink-kdl");
const PIN_FILE = join(VENDOR, "PIN.json");
const TESTS = join(import.meta.dirname, "tests");
const PACKAGE = "@bgotink/kdl";
const REGISTRY = "https://registry.npmjs.org/@bgotink%2fkdl";
const SUITE = {url: "https://codeload.github.com/kdl-org/kdl/tar.gz/refs/tags/2.0.0", cases: "tests/test_cases/", minimum: 318};

const sha = (algorithm, data, encoding = "hex") => createHash(algorithm).update(data).digest(encoding);
const fail = (message) => { console.error(`error: ${message}`); process.exit(1); };

async function get(url) {
  let response;
  try {
    response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  } catch (error) {
    const proxy = (process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY;
    fail(`${url}: ${error.cause?.code ?? error.name}` + (proxy ? "; HTTPS_PROXY is set: run again with NODE_USE_ENV_PROXY=1" : ""));
  }
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  return response;
}

const download = async (url) => Buffer.from(await (await get(url)).arrayBuffer());

/** Regular files of a .tar.gz as path -> bytes, first path segment removed (npm "package/", GitHub "kdl-2.0.0/"). */
function untar(gz) {
  const data = gunzipSync(gz), files = new Map();
  let longPath = null;
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString("utf8").replace(/\0[\s\S]*$/, "");
    const size = parseInt(field(124, 136).trim() || "0", 8);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const body = data.subarray(at + 512, at + 512 + size);
    if (type === "x") longPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1] ?? null;
    else if (type !== "g") {
      const path = longPath ?? (field(345, 500) ? `${field(345, 500)}/${field(0, 100)}` : field(0, 100));
      if (type === "0") files.set(path.replace(/^[^/]*\//, ""), Buffer.from(body));
      longPath = null;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Files reached from index.js through relative import/export statements, sorted. */
function closure(files) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) return;
    if (!files.has(path)) fail(`${PACKAGE}: ${path} is imported but not in the package`);
    seen.add(path);
    const text = files.get(path).toString("utf8");
    for (const [, from, bare] of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)) {
      const specifier = from ?? bare;
      if (!/^\.\.?\//.test(specifier)) fail(`${PACKAGE}: ${path} imports ${specifier}; only relative imports can be vendored`);
      visit(posix.normalize(posix.join(posix.dirname(path), specifier)));
    }
  };
  visit("index.js");
  return [...seen].sort();
}

const licenseOf = (files) => [...files.keys()].find((path) => /^LICEN[CS]E(\.md|\.txt)?$/i.test(path)) ?? fail(`${PACKAGE}: no LICENSE file`);
const readPin = () => existsSync(PIN_FILE) ? JSON.parse(readFileSync(PIN_FILE, "utf8")) : fail(`${relative(ROOT, PIN_FILE)} is missing; run --update first`);
const registry = async () => (await get(REGISTRY)).json();

async function fetchPackage(tarball, integrity) {
  const gz = await download(tarball);
  const actual = `sha512-${sha("sha512", gz, "base64")}`;
  if (actual !== integrity) fail(`${tarball}: integrity ${actual} does not match ${integrity}`);
  return untar(gz);
}

/** KDL 2.0.0 suite on the parser in dir: inputs with an expected_kdl file must parse; the others must fail. */
async function runSuite(dir, pinnedSha256) {
  const gz = await download(SUITE.url);
  const digest = sha("sha256", gz);
  if (pinnedSha256 && digest !== pinnedSha256) fail(`${SUITE.url}: sha256 ${digest} does not match the pinned ${pinnedSha256}`);
  const files = untar(gz);
  const {parse} = await import(pathToFileURL(join(dir, "index.js")).href);
  const inputs = [...files.keys()].filter((path) => path.startsWith(`${SUITE.cases}input/`) && path.endsWith(".kdl")).sort();
  const bad = [];
  for (const path of inputs) {
    const name = posix.basename(path);
    const want = files.has(`${SUITE.cases}expected_kdl/${name}`);
    let got = true;
    try { parse(files.get(path).toString("utf8")); } catch { got = false; }
    if (got !== want) bad.push(`${name}: expected ${want ? "parse" : "error"}`);
  }
  if (!inputs.length) fail(`${SUITE.url}: no test cases under ${SUITE.cases}`);
  return {sha256: digest, agree: inputs.length - bad.length, total: inputs.length, bad};
}

const report = (suite) => `KDL 2.0.0 suite: ${suite.agree}/${suite.total} agree` + suite.bad.map((line) => `\n  ${line}`).join("");

async function outdated() {
  const pin = readPin(), meta = await registry();
  const tags = Object.entries(meta["dist-tags"]).map(([tag, version]) => `${tag} ${version}`).join(", ");
  console.log(`pinned ${pin.version}; registry: ${tags}`);
  console.log(pin.version === meta["dist-tags"].latest ? "up to date" : "update available: run --update");
}

async function check() {
  const pin = readPin();
  const files = await fetchPackage(pin.tarball, pin.integrity);
  const expected = [...closure(files), licenseOf(files)].sort();
  const problems = [];
  if (JSON.stringify(expected) !== JSON.stringify(Object.keys(pin.files))) problems.push("the file list in PIN.json does not match the package closure");
  for (const [path, digest] of Object.entries(pin.files)) {
    const local = join(VENDOR, path);
    if (!files.has(path) || sha("sha256", files.get(path)) !== digest) problems.push(`${path}: package file does not match PIN.json`);
    else if (!existsSync(local) || !readFileSync(local).equals(files.get(path))) problems.push(`${path}: vendored file differs from the package`);
  }
  const vendored = readdirSync(VENDOR, {recursive: true, withFileTypes: true}).filter((e) => e.isFile())
    .map((e) => posix.join(relative(VENDOR, e.parentPath).split("\\").join("/"), e.name)).filter((p) => p !== "PIN.json");
  for (const path of vendored) if (!(path in pin.files)) problems.push(`${path}: vendored but not in PIN.json`);
  if (problems.length) fail(problems.join("\n  "));
  console.log(`OK ${PACKAGE} ${pin.version}: ${Object.keys(pin.files).length} files match the pinned package`);
}

function skillflowTests() {
  const tests = existsSync(TESTS) ? readdirSync(TESTS).filter((name) => name.endsWith(".test.mjs")) : [];
  if (!tests.length) { console.log("SkillFlow tests: none yet (*.test.mjs), skipped"); return true; }
  // The tests need no network; the proxy flag makes child processes print certificate errors that break stderr checks.
  const {NODE_USE_ENV_PROXY, ...env} = process.env;
  return spawnSync(process.execPath, ["--test", ...tests.map((name) => join(TESTS, name))], {stdio: "inherit", env}).status === 0;
}

async function update(requested) {
  const meta = await registry();
  const version = requested ?? meta["dist-tags"].latest;
  const dist = meta.versions[version]?.dist ?? fail(`${PACKAGE}@${version} is not in the registry`);
  const files = await fetchPackage(dist.tarball, dist.integrity);
  const list = [...closure(files), licenseOf(files)].sort();

  const staging = mkdtempSync(join(dirname(VENDOR), ".staging-")) // same folder, so renameSync stays on one file system;
  for (const path of list) { mkdirSync(dirname(join(staging, path)), {recursive: true}); writeFileSync(join(staging, path), files.get(path)); }
  const previous = existsSync(PIN_FILE) ? readPin() : null;
  const suite = await runSuite(staging, previous?.suite?.sha256);
  console.log(report(suite));
  if (suite.agree < SUITE.minimum) { rmSync(staging, {recursive: true}); fail(`fewer than ${SUITE.minimum} suite cases agree; nothing changed`); }

  const pin = {
    package: PACKAGE, version, tarball: dist.tarball, integrity: dist.integrity,
    suite: {url: SUITE.url, sha256: suite.sha256, minimum: SUITE.minimum, agree: suite.agree, total: suite.total},
    files: Object.fromEntries(list.map((path) => [path, sha("sha256", files.get(path))])),
  };
  writeFileSync(join(staging, "PIN.json"), JSON.stringify(pin, null, 2) + "\n");
  const backup = existsSync(VENDOR) ? `${staging}.previous` : null;
  if (backup) renameSync(VENDOR, backup);
  mkdirSync(dirname(VENDOR), {recursive: true});
  renameSync(staging, VENDOR);
  if (!skillflowTests()) {
    rmSync(VENDOR, {recursive: true});
    if (backup) renameSync(backup, VENDOR);
    fail(`SkillFlow tests fail with ${PACKAGE} ${version}; the previous files are restored`);
  }
  if (backup) rmSync(backup, {recursive: true});
  console.log(`OK vendored ${PACKAGE} ${version}: ${list.length} files into ${relative(ROOT, VENDOR)}`);
}

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  outdated: {type: "boolean"}, check: {type: "boolean"}, update: {type: "boolean"}, suite: {type: "boolean"}}});
if (values.outdated) await outdated();
else if (values.check) await check();
else if (values.update) await update(positionals[0]);
else if (values.suite) {
  const suite = await runSuite(resolve(positionals[0] ?? VENDOR), existsSync(PIN_FILE) ? readPin().suite.sha256 : null);
  console.log(report(suite));
  if (suite.agree < SUITE.minimum) process.exitCode = 1;
} else fail("use --outdated, --check, --update [VERSION], or --suite [DIR]");
