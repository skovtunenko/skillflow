// Tests for how render.mjs links an invariant to decide and gate nodes through outcome words (node:test).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {skillUrl} from "./skill-path.mjs";
const {buildModel} = await import(skillUrl("scripts/render.mjs"));
const {load} = await import(skillUrl("scripts/validate.mjs"));

/** The first invariant of the model for `body`. */
function rule(body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillflow-links-"));
  try {
    fs.writeFileSync(path.join(tmp, "flow.kdl"), body);
    const {text, doc} = load(path.join(tmp, "flow.kdl"));
    return buildModel(doc, text, "demo", "flow.kdl", [], null).context.invariants[0];
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}

const TWO_DECIDES = (text) => `skillflow 1.0
context {
    invariant "${text}"
}
decide review "Review?" by=llm {
    when skip {
        step tell by=llm
    }
    when go "continue"
}
decide publish "Publish?" by=llm {
    when skip {
        step log by=llm
    }
    when go "continue"
}
`;

test("a shared outcome word links no decide when the rule names none", () => {
  const found = rule(TWO_DECIDES("skip only when the diff is empty"));
  assert.deepEqual(found.nodes, {});
  assert.deepEqual(found.words, []);
});

test("a shared outcome word links only the decide that the rule names", () => {
  const found = rule(TWO_DECIDES("skip the review only when the diff is empty"));
  // n1 review and n3 its step tell; publish (n5) and its step log (n7) stay unlinked
  assert.deepEqual(found.nodes, {n1: "uses", n3: "uses"});
  assert.deepEqual(found.words, ["review", "skip"]);
});

test("an outcome word of one decide links that decide and its branch", () => {
  const found = rule(`skillflow 1.0
context {
    invariant "abort before any write"
}
decide check "Ready?" by=llm {
    when abort {
        end "stop"
    }
    when go "continue"
}
`);
  assert.deepEqual(found.nodes, {n1: "uses", n3: "uses"});
  assert.deepEqual(found.words, ["abort"]);
});

test("gate outcomes follow the same rule", () => {
  const found = rule(`skillflow 1.0
context {
    invariant "a rejected draft is never sent"
}
gate draft "Send the draft?" {
    when rejected {
        end "stop"
    }
}
gate final "Ship it?" {
    when rejected {
        end "stop"
    }
}
`);
  assert.deepEqual(found.nodes, {n1: "uses", n3: "uses"});
  assert.deepEqual(found.words, ["draft", "rejected"]);
});

test("a rule links a node named in the target skill's language", () => {
  const found = rule('skillflow 1.0\ncontext {\n    invariant "согласовать перед публикацией"\n}\nstep согласовать by=human\n');
  assert.ok(found.words.includes("согласовать"), JSON.stringify(found));
  assert.equal(Object.keys(found.nodes).length, 1);
});

test("the model carries who keeps an invariant", () => {
  assert.equal(rule('skillflow 1.0\ncontext {\n    invariant by=code "x"\n}\nstep a by=llm\n').by, "code");
  assert.equal("by" in rule('skillflow 1.0\ncontext {\n    invariant "x"\n}\nstep a by=llm\n'), false);
});

test("a short node or tool name links when the rule names it", () => {
  const found = rule(`skillflow 1.0
context {
    invariant "qa runs gh only on the draft"
}
step qa by=llm {
    tools gh
}
`);
  assert.deepEqual(found.nodes, {n1: "uses"});
  assert.deepEqual(found.words, ["gh", "qa"]);
});
