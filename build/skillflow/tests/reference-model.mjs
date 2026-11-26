// Independent reference model of SkillFlow data rules, written from grammar.md rules 3, 5 and 12,
// not from validate.mjs. It enumerates every structural path and keeps one set of available names per path;
// validate.mjs instead merges paths with set intersection. An action-level input is what the skill asks the user for
// there: it makes the name available after the node, and `missing` lists the inputs some path reaches without that name
// (an input that every path already has is a read, which validate.mjs warns about). Produced = an output.
// It also reports control flow: `terminates` (blocks that no path leaves) and `reached` (cards some path reaches).
// It shares only the KDL parser with the code under test.
import {skillUrl} from "./skill-path.mjs";
const {parse} = await import(skillUrl("scripts/_vendor/bgotink-kdl/index.js"));

const ACTION = new Set(["step", "decide", "gate"]);
const FLOWING = new Set(["phase", "step", "decide", "gate", "end"]);
const kidsOf = (n) => n.children?.nodes ?? [];
const argv = (n) => n.entries.filter((e) => !e.name).map((e) => e.getValue());
const named = (n) => String(argv(n)[0] ?? "");
const items = (n, names) => kidsOf(n).filter((k) => names.includes(k.getName())).flatMap((k) => argv(k).map(String));
const key = (set) => [...set].sort().join("\u0000");

/** strict: a failed step whose catch continues has only what the handler path has (declared recovery, rule 5). */
export function reference(text, strict = false) {
  const doc = parse(text);
  const missing = new Set(), unreachable = new Set(), produced = new Set(), required = new Set(), reached = new Set();
  // terminates: "phase", "decision/outcome", or "step/catch" -> true when no path falls through that block
  const terminates = {};
  const sub = (label, nodes, states) => { const out = block(nodes, states); terminates[label] = (terminates[label] ?? true) && !out.length; return out; };
  const ctx = doc.nodes.find((n) => n.getName() === "context");
  const inputs = new Set(ctx ? kidsOf(ctx).filter((k) => k.getName() === "input").map(named) : []);
  const outputs = ctx ? kidsOf(ctx).filter((k) => k.getName() === "output" && argv(k).length === 2).map(named) : [];
  const NEED = ["input"], MAKE = ["output"];

  /** states: array of Set; returns the states that fall through the block. */
  function block(nodes, states) {
    for (const node of nodes.filter((n) => FLOWING.has(n.getName()))) {
      if (!states.length) { unreachable.add(`${node.getName()}:${named(node)}`); return []; }
      if (node.getName() !== "phase") reached.add(node.getName() === "end" ? `end:${named(node)}` : named(node));
      const next = [];
      for (const s of states) {
        const kind = node.getName();
        if (kind === "end") continue;
        if (kind === "phase") { next.push(...sub(named(node), kidsOf(node), [s])); continue; }
        const asked = items(node, NEED);
        for (const r of asked) { required.add(r); if (!s.has(r)) missing.add(`${named(node)}:${r}`); }
        const made = items(node, MAKE);
        made.forEach((m) => produced.add(m));
        const base = new Set([...s, ...made, ...asked]);
        if (kind === "step") {
          next.push(base);
          const fail = kidsOf(node).find((k) => k.getName() === "catch");
          // the handler runs without the failed step's data, with what it declares it restores; a handler that continues
          // counts as recovered: the step's data stays (lenient), or the path carries on with what the handler has (strict)
          const handled = fail ? sub(`${named(node)}/catch`, kidsOf(fail), [new Set([...s, ...items(fail, MAKE)])]) : [];
          if (handled.length) next.push(...(strict ? handled : [new Set(base)]));
          continue;
        }
        const whens = kidsOf(node).filter((k) => k.getName() === "when");
        for (const w of whens) {
          const own = items(w, MAKE);
          own.forEach((m) => produced.add(m));
          next.push(...sub(`${named(node)}/${named(w)}`, kidsOf(w), [new Set([...base, ...own])]));
        }
        if (kind === "gate" && !whens.some((w) => named(w) === "approved")) next.push(base);
        // rule 3: a decide with one written outcome has an implied other outcome that continues
        if (kind === "decide" && whens.length <= 1) next.push(base);
      }
      const seen = new Map();
      for (const s of next) seen.set(key(s), s);
      states = [...seen.values()];
    }
    return states;
  }

  // guarantee 9 is global: count every input and output, reachable or not
  const all = (n) => { if (ACTION.has(n.getName()) || n.getName() === "when" || n.getName() === "catch") { items(n, NEED).forEach((r) => required.add(r)); items(n, MAKE).forEach((m) => produced.add(m)); } kidsOf(n).forEach(all); };
  doc.nodes.forEach(all);
  const finals = block(doc.nodes, [new Set(inputs)]);
  const end = finals.length ? [...finals.reduce((a, b) => a.intersection(b))].sort() : null;
  // what the grammar promises about a declared named result: here only reported, never checked
  const outputStatus = Object.fromEntries(outputs.map((o) => [o,
    !finals.length ? "no-normal-end" : finals.every((s) => s.has(o)) ? "all" : finals.some((s) => s.has(o)) ? "some" : "none"]));
  const unused = [...produced].filter((p) => !required.has(p) && !outputs.includes(p)).sort();
  return {missing: [...missing].sort(), unreachable: [...unreachable].sort(), end, unused, outputStatus, paths: finals.length, terminates, reached: [...reached].sort()};
}
