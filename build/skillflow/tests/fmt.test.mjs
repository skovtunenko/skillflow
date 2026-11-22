// Tests of `fmt`, the SkillFlow formatter (node:test).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {describe, test} from "node:test";
import {tmpDir} from "./tmp.mjs";
import {ROOT, SKILL, skillUrl} from "./skill-path.mjs";
const {FormatError, formatFlow} = await import(skillUrl("scripts/fmt.mjs"));
const {main} = await import(skillUrl("scripts/skillflow.mjs"));
const {check, parseFlow} = await import(skillUrl("scripts/validate.mjs"));
const {buildModel} = await import(skillUrl("scripts/render.mjs"));

const EXAMPLE = /```kdl\n([\s\S]*?)```/.exec(fs.readFileSync(path.join(SKILL, "references", "example.md"), "utf8"))[1];

/** Run main(argv) with console output captured: {code, out, err}. */
function cli(argv) {
  const out = [], err = [], {log, error} = console;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try { return {code: main(argv), out: out.join("\n"), err: err.join("\n")}; } finally { Object.assign(console, {log, error}); }
}
/** Every flow.kdl of the repository: real flows, written by several authors. */
const corpus = () => fs.readdirSync(ROOT, {recursive: true}).map(String)
  .filter((file) => /^(skills|build)\//.test(file) && path.basename(file) === "flow.kdl" && !file.includes("/."));

describe("formatFlow: layout", () => {
  test("one tab for each level; spaces, trailing spaces and extra blank lines go", () => {
    assert.equal(formatFlow('skillflow 1.0   \n\n\n\nphase p {\n    step a by=llm {\n            input x "X."  \n    }\n\n}\n\n\n'),
      'skillflow 1.0\n\nphase p {\n\tstep a by=llm {\n\t\tinput x "X."\n\t}\n}\n');
  });

  test("a blank line separates two sibling nodes when one of them has more than one line", () => {
    const flow = 'skillflow 1.0\nstep a by=llm\nstep b by=llm\nstep c by=llm {\n\tinput x "X."\n\tinput y "Y."\n}\nstep d by=llm\nstep e by=llm\n';
    assert.equal(formatFlow(flow),
      'skillflow 1.0\n\nstep a by=llm\nstep b by=llm\n\nstep c by=llm {\n\tinput x "X."\n\tinput y "Y."\n}\n\nstep d by=llm\nstep e by=llm\n');
  });

  test("context: a blank line between the inputs, the outputs and the invariants", () => {
    const flow = 'skillflow 1.0\ncontext "Purpose." {\n\tinput a "A."\n\n\tinput b "B."\n\toutput c "C."\n\tinvariant "one"\n\tinvariant "two"\n}\nstep s by=llm {\n\ttools Read\n\tinput q "Q."\n\toutput c\n}\n';
    assert.equal(formatFlow(flow),
      'skillflow 1.0\n\ncontext "Purpose." {\n\tinput a "A."\n\tinput b "B."\n\n\toutput c "C."\n\n\tinvariant "one"\n\tinvariant "two"\n}\n\nstep s by=llm {\n\ttools Read\n\tinput q "Q."\n\toutput c\n}\n');
  });

  test("decide: one-line outcomes stay together; outcomes with a block get blank lines", () => {
    const flow = 'skillflow 1.0\ndecide d "Which?" by=llm {\n\twhen a "one"\n\twhen b "two"\n}\ndecide e "Which?" by=llm {\n\toutput m "M."\n\twhen a {\n\t\tend "stop"\n\t}\n\twhen b {\n\t\tstep x by=llm\n\t\tstep y by=llm\n\t}\n}\n';
    assert.equal(formatFlow(flow),
      'skillflow 1.0\n\ndecide d "Which?" by=llm {\n\twhen a "one"\n\twhen b "two"\n}\n\ndecide e "Which?" by=llm {\n\toutput m "M."\n\n\twhen a {\n\t\tend "stop"\n\t}\n\n\twhen b {\n\t\tstep x by=llm\n\t\tstep y by=llm\n\t}\n}\n');
  });

  test("a comment directly above a node stays with it; a comment with a blank line below it stays apart", () => {
    const flow = 'skillflow 1.0\n// about the whole flow\n\nstep a by=llm\n   // ? is this right (SKILL.md:3)\nstep b by=llm\nstep c by=llm\nphase p {\n\tstep d by=llm\n\t// last words\n}\n';
    assert.equal(formatFlow(flow),
      'skillflow 1.0\n\n// about the whole flow\n\nstep a by=llm\n\n// ? is this right (SKILL.md:3)\nstep b by=llm\n\nstep c by=llm\n\nphase p {\n\tstep d by=llm\n\n\t// last words\n}\n');
  });

  test("a string that spans lines moves with its node and keeps its text", () => {
    const flow = 'skillflow 1.0\nphase p {\n  step a by=llm """\n      - One.\n\n        - Deeper.\n      """ {\n      output x "X."\n  }\n}\n';
    const out = formatFlow(flow);
    assert.equal(out, 'skillflow 1.0\n\nphase p {\n\tstep a by=llm """\n\t\t- One.\n\n\t\t  - Deeper.\n\t\t""" {\n\t\toutput x "X."\n\t}\n}\n');
    const prose = (text) => parseFlow(text).nodes[1].children.nodes[0].getArgument(1);
    assert.equal(prose(out), "- One.\n\n  - Deeper.");
    assert.equal(prose(out), prose(flow));
  });

  test("a continued line is one level deeper; a block on one line stays on its line", () => {
    assert.equal(formatFlow('skillflow 1.0\nstep a by=llm \\\n"Prose."\nstep b by=llm { on-fail { end "x" } }\n'),
      'skillflow 1.0\n\nstep a by=llm \\\n\t"Prose."\n\nstep b by=llm { on-fail { end "x" } }\n');
  });

  test("Windows line ends and a byte order mark go; a slashdashed node keeps its block", () => {
    assert.equal(formatFlow('﻿skillflow 1.0\r\nstep a by=llm\r\n/- step b by=llm {\r\n    input x\r\n}\r\n'),
      'skillflow 1.0\n\nstep a by=llm\n\n/- step b by=llm {\n\tinput x\n}\n');
  });

  test("braces, comment marks and blank lines inside a string are text, not layout", () => {
    const flow = 'skillflow 1.0\nstep a by=llm "Write { and } and // and \\"quotes\\"."\nstep b by=llm #"raw } "quoted" {"#\n';
    assert.equal(formatFlow(flow), 'skillflow 1.0\n\nstep a by=llm "Write { and } and // and \\"quotes\\"."\nstep b by=llm #"raw } "quoted" {"#\n');
  });

  test("a `/-` alone on its line stays with the node below it; a node with a comment over two lines is a tall node", () => {
    assert.equal(formatFlow('skillflow 1.0\nstep a by=llm\n/-\nphase p {\n\tstep b by=llm\n}\n'), 'skillflow 1.0\n\nstep a by=llm\n\n/-\nphase p {\n\tstep b by=llm\n}\n');
    assert.equal(formatFlow('skillflow 1.0\nstep a by=llm\nstep b /* why\n   not */ by=llm\nstep c by=llm\n'), 'skillflow 1.0\n\nstep a by=llm\n\nstep b /* why\n   not */ by=llm\n\nstep c by=llm\n');
  });

  test("a `\\` with nothing after it is refused with its line number and a hint that names it", () => {
    for (const [flow, line] of [['skillflow 1.0\nstep a by=llm \\\n\nstep b by=llm\n', 2], ['skillflow 1.0\nphase p {\n\tstep b by=llm\n}\nstep a by=llm \\\n', 5], ['skillflow 1.0\nphase p {\n\tstep x by=llm\n\tstep a by=llm \\\n}\n', 4]])
      assert.throws(() => formatFlow(flow), (error) => error instanceof FormatError && error.line === line && /remove it/.test(error.hint), flow);
    // a `\\` that does continue its node is not the fault of a line with two `{`: the hint names the braces
    assert.throws(() => formatFlow('skillflow 1.0\nstep a \\\n  by=llm "x" { on-fail {\n    end "y"\n  }\n}\n'), (error) => error instanceof FormatError && error.line === 2 && /own line/.test(error.hint));
  });

  test("a string that spans lines keeps a row that a `\\` continues with other indentation", () => {
    const flow = 'skillflow 1.0\n\nstep a by=llm """\n    hello \\\n\tworld\n    """\n', value = (text) => parseFlow(text).nodes[1].getArgument(1);
    assert.equal(value(formatFlow(flow)), value(flow));
    assert.equal(value(flow), "hello world");
  });

  test("a line that opens or closes two blocks is refused with its line number", () => {
    for (const [flow, line] of [['skillflow 1.0\nphase p { step a by=llm {\n\tinput x\n}}\n', 2], ['skillflow 1.0\nphase p {\n\tstep a by=llm {\n\t\tinput x\n\t}}\n', 5],
      ['skillflow 1.0\nphase p {\n\tstep a by=llm }\n', 3]]) {
      assert.throws(() => formatFlow(flow), (error) => error instanceof FormatError && error.line === line && /each `}` on its own line/.test(error.hint), flow);
    }
  });
});

describe("formatFlow: safety", () => {
  const texts = () => [...corpus().map((file) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]), ["references/example.md", EXAMPLE]];

  test("the corpus: a second run changes nothing, and the page model is the same", () => {
    // other skills' flows exist only in the private layout (skills/<bucket>/<skill>); the public one has SkillFlow's own and the example
    const minimum = path.relative(ROOT, SKILL).split(path.sep).length > 2 ? 9 : 2;
    assert.ok(texts().length >= minimum, "the corpus pattern no longer finds the repository's flows");
    for (const [file, text] of texts()) {
      const out = formatFlow(text);
      assert.equal(formatFlow(out), out, `${file}: the second run changed the text`);
      // every line moved, so compare the models without their line numbers
      const model = (source) => JSON.stringify(buildModel(parseFlow(source), source, "t", "flow.kdl", []), (key, value) => (key === "line" || key === "sourceText" ? undefined : value));
      assert.equal(model(out), model(text), `${file}: the page model changed`);
    }
  });

  test("the validator reports the same problems before and after, apart from their lines", () => {
    const dir = tmpDir("skillflow-fmt-");
    for (const [file, text] of texts()) {
      const reports = [text, formatFlow(text)].map((source, index) => {
        const flow = path.join(dir, `${index}.kdl`);
        fs.writeFileSync(flow, source);
        const {report, stats} = check(flow, null);
        return JSON.stringify([[report.errors, report.todos, report.warnings].map((items) => items.map(([, message]) => message.replace(/\blines? [\d, ]+/g, "line N")).sort()), {...stats, versions: null}]);
      });
      assert.equal(reports[1], reports[0], file);
    }
  });

  test("SkillFlow's own flow file is formatted", () => {
    const own = fs.readFileSync(path.join(SKILL, "flow.kdl"), "utf8");
    assert.equal(formatFlow(own), own, "run: node scripts/skillflow.mjs fmt flow.kdl");
  });
});

describe("fmt command", () => {
  const write = (text) => { const flow = path.join(tmpDir("skillflow-fmt-"), "flow.kdl"); fs.writeFileSync(flow, text); return flow; };
  const UGLY = 'skillflow 1.0\nphase p {\n    step a by=llm\n}\n', NEAT = 'skillflow 1.0\n\nphase p {\n\tstep a by=llm\n}\n';

  test("fmt rewrites the file and says so; a second run leaves it", () => {
    const flow = write(UGLY);
    assert.deepEqual(cli(["fmt", flow]), {code: 0, out: `formatted ${flow}`, err: ""});
    assert.equal(fs.readFileSync(flow, "utf8"), NEAT);
    assert.deepEqual(cli(["fmt", flow]), {code: 0, out: `unchanged ${flow}`, err: ""});
    assert.deepEqual(fs.readdirSync(path.dirname(flow)), ["flow.kdl"], "no temporary file stays");
  });

  test("fmt --check writes nothing: exit 1 and the first line that differs, or exit 0", () => {
    const flow = write(UGLY);
    assert.deepEqual(cli(["fmt", flow, "--check"]), {code: 1, out: `not formatted ${flow} · first difference at line 2\n  next: run \`fmt\` on the file`, err: ""});
    assert.equal(fs.readFileSync(flow, "utf8"), UGLY);
    assert.deepEqual(cli(["fmt", write(NEAT), "--check"]).code, 0);
    // the line is the one an editor shows: Windows line ends differ from line 1 on, and a missing last line end is on the last line
    for (const [text, line] of [[NEAT.replaceAll("\n", "\r\n"), 1], [NEAT.trimEnd(), 5], [NEAT + "\n\n", 6]])
      assert.match(cli(["fmt", write(text), "--check"]).out, new RegExp(`first difference at line ${line}\n`), JSON.stringify(text));
  });

  test("a read-only file is not replaced; the file mode stays", () => {
    const locked = write(UGLY);
    fs.chmodSync(locked, 0o444);
    const {code, err} = cli(["fmt", locked]);
    assert.equal(code, 2);
    assert.match(err, /cannot write: permission denied/);
    assert.equal(fs.readFileSync(locked, "utf8"), UGLY);
    const flow = write(UGLY);
    fs.chmodSync(flow, 0o600);
    assert.equal(cli(["fmt", flow]).code, 0);
    assert.equal(fs.statSync(flow).mode & 0o777, 0o600);
    // a folder that takes no new file: exit 2, the flow as it was, and no temporary file
    const shut = write(UGLY), dir = path.dirname(shut);
    fs.chmodSync(dir, 0o555);
    try {
      assert.equal(cli(["fmt", shut]).code, 2);
      assert.equal(fs.readFileSync(shut, "utf8"), UGLY);
      assert.deepEqual(fs.readdirSync(dir), ["flow.kdl"]);
    } finally { fs.chmodSync(dir, 0o755); }
  });

  test("a file with a syntax error stays as it is, and fmt reports the error", () => {
    const text = 'skillflow 1.0\nstep a by=llm "open\n', flow = write(text);
    const {code, out} = cli(["fmt", flow]);
    assert.equal(code, 1);
    assert.match(out, /^FAIL .*flow\.kdl · 1 error\n {2}.*:\d+:\d+: error: /);
    assert.equal(fs.readFileSync(flow, "utf8"), text);
  });

  test("a line fmt cannot place: exit 1, the line and a hint; the file stays", () => {
    const text = 'skillflow 1.0\nphase p {\n\tstep a by=llm }\n', flow = write(text);
    const {code, out} = cli(["fmt", flow]);
    assert.equal(code, 1);
    assert.match(out, /flow\.kdl:3: error: .*\(hint: .*own line/);
    assert.equal(fs.readFileSync(flow, "utf8"), text);
  });

  test("fmt writes through a symlink and keeps the link; a missing file is exit 2", () => {
    const flow = write(UGLY), link = path.join(path.dirname(flow), "link.kdl");
    fs.symlinkSync(flow, link);
    assert.equal(cli(["fmt", link]).code, 0);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(flow, "utf8"), NEAT);
    assert.equal(cli(["fmt", path.join(path.dirname(flow), "none.kdl")]).code, 2);
  });

  test("the usage lists fmt and --check", () => {
    assert.match(cli(["--help"]).out, /fmt FLOW +format a flow file in place/);
    assert.match(cli(["fmt", "--help"]).out, /usage: node skillflow\.mjs fmt FLOW \[--check\]/);
  });
});
