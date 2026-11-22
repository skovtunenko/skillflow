// Hand-written data-path corpus for the SkillFlow validator. Every expectation was written by hand from
// references/grammar.md (rules 3, 5, 12) and is also checked against reference-model.mjs, which does not use validate.mjs.
// missing: "node:data" inputs that some path reaches without the name: the skill asks the user for new data there, and
// every other input reached is a read that gets a warning; unreachable: "kind:name"; end: names available where the flow
// ends normally (null when every path stops at `end`); unused: outputs that no input names; flowOutputs: named flow
// outputs that must be reported as not produced; recovery (optional): "output:data" flow outputs that exist only when a
// step succeeds, because its on-fail continues without them (a warning);
// terminates (optional): blocks that no path leaves.
// Each text gets the first line `skillflow 1.0`.

export const dataCases = [
  {name: "flow-output-early-exit", why: "a path that stops at end needs no flow output",
    flowOutputs: [],
    text: `context {
  output rep "report"
}
decide d "which?" by=llm {
  when a {
    output rep
  }
  when b {
    end "nothing to report"
  }
}
`,
    expect: {missing: [], unreachable: [], end: ["rep"], unused: []}},
  {name: "seq-ok", why: "sequential dependency",
    flowOutputs: [],
    text: `context {
  input req "request"
  output y "result"
}
step a by=llm {
  input req
  output x
}
step b by=llm {
  input x
  output y
}
`,
    expect: {missing: [], unreachable: [], end: ["req","x","y"], unused: []}},
  {name: "seq-missing", why: "input used before any producer",
    flowOutputs: [],
    text: `step a by=llm {
  input x
}
step b by=llm {
  output x
}
`,
    expect: {missing: ["a:x"], unreachable: [], end: ["x"], unused: []}},
  {name: "input-asks-new", why: "an action input is what the skill asks the user for: it makes new data",
    flowOutputs: [],
    text: `step s by=llm {
  input brandnew
}
`,
    expect: {missing: ["s:brandnew"], unreachable: [], end: ["brandnew"], unused: []}},
  {name: "asked-twice", why: "the first ask makes the data, so the second one is a read",
    flowOutputs: [],
    text: `step a by=llm {
  input x
}
step b by=llm {
  input x
}
`,
    expect: {missing: ["a:x"], unreachable: [], end: ["x"], unused: []}},
  {name: "unreachable-consumer", why: "the unused-output warning is global: a consumer after end still counts",
    flowOutputs: [],
    text: `step a by=llm {
  output x
}
end "stop"
step b by=llm {
  input x
}
`,
    expect: {missing: [], unreachable: ["step:b"], end: null, unused: []}},
  {name: "unreachable-producer", why: "a producer after end still gets the unused-output warning",
    flowOutputs: [],
    text: `end "stop"
step a by=llm {
  output x
}
`,
    expect: {missing: [], unreachable: ["step:a"], end: null, unused: ["x"]}},
  {name: "update-same", why: "consume and update the same artifact",
    flowOutputs: [],
    text: `context {
  input doc "the document"
  output doc "the updated document"
}
step revise by=llm {
  input doc
  output doc
}
`,
    expect: {missing: [], unreachable: [], end: ["doc"], unused: []}},
  {name: "self-satisfy", why: "own output cannot satisfy own input",
    flowOutputs: [],
    text: `step s by=llm {
  output x
  input x
}
`,
    expect: {missing: ["s:x"], unreachable: [], end: ["x"], unused: []}},
  {name: "decide-own-when", why: "a decision's own outcome cannot satisfy its input",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  input m
  when a {
    output m
  }
  when b {
    output m
  }
}
`,
    expect: {missing: ["d:m"], unreachable: [], end: ["m"], unused: []}},
  {name: "branch-all", why: "output on every continuing branch",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  when a {
    output r
  }
  when b {
    step b1 by=llm {
      output r
    }
  }
}
step use by=llm {
  input r
}
`,
    expect: {missing: [], unreachable: [], end: ["r"], unused: []}},
  {name: "branch-some", why: "output on some continuing branches",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  when a {
    output r
  }
}
step use by=llm {
  input r
}
`,
    expect: {missing: ["use:r"], unreachable: [], end: ["r"], unused: []}},
  {name: "branch-terminating", why: "a terminating branch does not limit availability",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  when a {
    output r
  }
  when b {
    end "stop"
  }
}
step use by=llm {
  input r
}
`,
    expect: {missing: [], unreachable: [], end: ["r"], unused: []}},
  {name: "only-terminating-outputs", why: "output only on a branch that terminates",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  when a {
    output r
    end "stop"
  }
}
step use by=llm {
  input r
}
`,
    expect: {missing: ["use:r"], unreachable: [], end: ["r"], unused: []}},
  {name: "all-terminate", why: "every branch ends; the next node never runs",
    flowOutputs: [],
    text: `decide d "which?" by=llm {
  when a {
    end "a"
  }
  when b {
    end "b"
  }
}
step after by=llm
`,
    expect: {missing: [], unreachable: ["step:after"], end: null, unused: []}},
  {name: "when-direct-both", why: "direct outcome outputs feed a later decision",
    flowOutputs: [],
    text: `decide mode "fast or full?" by=human {
  when fast {
    output mode
  }
  when full {
    output mode
  }
}
decide later "go?" by=llm {
  input mode
  when yes "go on"
  when no "stop here"
}
`,
    expect: {missing: [], unreachable: [], end: ["mode"], unused: []}},
  {name: "decide-own-output", why: "a decision's own output reaches every branch and after",
    flowOutputs: [],
    text: `decide mode "which?" by=human {
  output mode
  when b {
    step b1 by=llm {
      input mode
    }
  }
}
step use by=llm {
  input mode
}
`,
    expect: {missing: [], unreachable: [], end: ["mode"], unused: []}},
  {name: "gate-implicit", why: "implicit approved continues with the gate's output",
    flowOutputs: [],
    text: `step draft by=llm {
  output d
}
gate ok "Approve?" {
  input d
  output note
  when rejected {
    end "rejected"
  }
}
step publish by=code {
  input d
  input note
}
`,
    expect: {missing: [], unreachable: [], end: ["d","note"], unused: []}},
  {name: "gate-approved-ends", why: "explicit approved ends; another outcome continues",
    flowOutputs: [],
    text: `gate g "Approve?" {
  when approved {
    end "done"
  }
  when rejected {
    output r
  }
}
step after by=llm {
  input r
}
`,
    expect: {missing: [], unreachable: [], end: ["r"], unused: []}},
  {name: "gate-approved-override-some", why: "explicit approved outputs; rejected continues without it",
    flowOutputs: [],
    text: `gate g "Approve?" {
  when approved {
    step a by=llm {
      output r
    }
  }
  when rejected "nothing is made"
}
step after by=llm {
  input r
}
`,
    expect: {missing: ["after:r"], unreachable: [], end: ["r"], unused: []}},
  {name: "gate-implicit-no-output", why: "implicit approved does not get an outcome's output",
    flowOutputs: [],
    text: `gate g "Approve?" {
  when rejected {
    output r
  }
}
step after by=llm {
  input r
}
`,
    expect: {missing: ["after:r"], unreachable: [], end: ["r"], unused: []}},
  {name: "recovery-keeps", why: "a recovered step keeps its output: the input of that name is a read",
    flowOutputs: [],
    text: `step s by=code {
  output x
  on-fail "Retry once, then continue."
}
step u by=llm {
  input x
}
`,
    expect: {missing: [], unreachable: [], end: ["x"], unused: []}},
  {name: "handler-local", why: "handler-local data does not leave the handler: the skill asks for note again",
    flowOutputs: [],
    text: `step s by=code {
  output x
  on-fail {
    step h by=human {
      output note
    }
  }
}
step u by=llm {
  input x
  input note
}
`,
    expect: {missing: ["u:note"], unreachable: [], end: ["note","x"], unused: []}},
  {name: "handler-no-step-output", why: "the handler does not see the failed step's output",
    flowOutputs: [],
    text: `step s by=code {
  output x
  on-fail {
    step h by=llm {
      input x
    }
  }
}
`,
    expect: {missing: ["h:x"], unreachable: [], end: ["x"], unused: []}},
  {name: "handler-uses-earlier", why: "the handler sees data from before the step",
    flowOutputs: [],
    text: `context {
  input req "request"
}
step s by=code {
  input req
  on-fail {
    step h by=llm {
      input req
    }
  }
}
`,
    expect: {missing: [], unreachable: [], end: ["req"], unused: []}},
  {name: "nested-termination-onfail", why: "on-fail end inside a branch; success path continues",
    flowOutputs: [],
    text: `decide d "go?" by=llm {
  when a {
    step t by=code {
      output r
      on-fail {
        end "t failed"
      }
    }
  }
  when b {
    end "no"
  }
}
step use by=llm {
  input r
}
`,
    expect: {missing: [], unreachable: [], end: ["r"], unused: []}},
  {name: "nested-termination-phase", why: "every nested path ends inside a phase",
    flowOutputs: [],
    text: `phase p {
  decide d "go?" by=llm {
    when a {
      end "a"
    }
    when b {
      phase q {
        end "b"
      }
    }
  }
}
step after by=llm
`,
    expect: {missing: [], unreachable: ["step:after"], end: null, unused: []}},
  {name: "phase-transparent", why: "a phase passes data through",
    flowOutputs: [],
    text: `phase p {
  step a by=llm {
    output x
  }
}
step b by=llm {
  input x
}
`,
    expect: {missing: [], unreachable: [], end: ["x"], unused: []}},
  {name: "multi-artifacts", why: "several names per action; one is missing",
    flowOutputs: [],
    text: `context {
  input a "A"
  input b "B"
}
step s by=llm {
  input a
  input b
  input z
  output c
  output d
}
step t by=llm {
  input c
  input d
}
`,
    expect: {missing: ["s:z"], unreachable: [], end: ["a","b","c","d","z"], unused: []}},
  {name: "unicode", why: "Unicode node and data names",
    flowOutputs: [],
    text: `context {
  input 草稿 "draft"
}
step 編集 by=llm {
  input 草稿
  output résumé
}
step ñandú by=llm {
  input résumé
  input ошибка
}
`,
    expect: {missing: ["ñandú:ошибка"], unreachable: [], end: ["résumé","ошибка","草稿"], unused: []}},
  {name: "unused-output", why: "an output that nothing needs gets a warning",
    flowOutputs: [],
    text: `step s by=llm {
  output orphan
}
`,
    expect: {missing: [], unreachable: [], end: ["orphan"], unused: ["orphan"]}},
  {name: "ghost-flow-output", why: "a declared flow output that nothing produces",
    flowOutputs: ["ghost"],
    text: `context {
  output ghost "never made"
}
step work by=llm
`,
    expect: {missing: [], unreachable: [], end: [], unused: []}},
  {name: "flow-output-some-branch", why: "a declared flow output made on one continuing branch",
    flowOutputs: ["rep"],
    text: `context {
  output rep "report"
}
decide d "which?" by=llm {
  when a {
    output rep
  }
}
`,
    expect: {missing: [], unreachable: [], end: [], unused: []}},
  // declared recovery (grammar rule 5): an on-fail output says which data the recovery restores
  {name: "recovery-silent-gap", why: "the on-fail continues without the report: the flow output depends on success",
    flowOutputs: [], recovery: ["output:report"],
    text: `context {
  output report "the report"
}
step generate by=code {
  output report
  on-fail "Continue without a report."
}
`,
    expect: {missing: [], unreachable: [], end: ["report"], unused: []}},
  {name: "recovery-declared", why: "the on-fail says it restores the report: no warning",
    flowOutputs: [],
    text: `step generate by=code {
  output report
  on-fail "Retry twice, then use the cached report." {
    output report
  }
}
step publish by=code {
  input report
}
`,
    expect: {missing: [], unreachable: [], end: ["report"], unused: []}},
  {name: "recovery-ends", why: "an on-fail that ends needs no recovery output",
    flowOutputs: [],
    text: `step generate by=code {
  output report
  on-fail {
    end "no report"
  }
}
step publish by=code {
  input report
}
`,
    expect: {missing: [], unreachable: [], end: ["report"], unused: []}},
  {name: "recovery-handler-step", why: "a handler step that makes the data counts as recovery",
    flowOutputs: [],
    text: `step generate by=code {
  output report
  on-fail {
    step write-by-hand by=human {
      output report
    }
  }
}
step publish by=code {
  input report
}
`,
    expect: {missing: [], unreachable: [], end: ["report"], unused: []}},
  {name: "recovery-partial", why: "a partial result under another name: partial is missing on the success path",
    flowOutputs: [],
    text: `step generate by=code {
  output report
  on-fail "Keep the partial report." {
    output partial
  }
}
step publish by=code {
  input report
  input partial
}
`,
    expect: {missing: ["publish:partial"], unreachable: [], end: ["partial","report"], unused: []}},
  {name: "recovery-in-handler", why: "the restored data is available inside the on-fail, as an outcome's output is inside its when",
    flowOutputs: [],
    text: `step generate by=code {
  output report
  on-fail "Use the cached report." {
    output report
    step note-fallback by=llm {
      input report
    }
  }
}
step publish by=code {
  input report
}
`,
    expect: {missing: [], unreachable: [], end: ["report"], unused: []}},
  // control flow: `terminates` lists, by hand, every block that no path leaves: "phase", "decision/outcome", "step/on-fail"
  {name: "phase-gate-approved-ends", why: "approved ends inside a phase; rejected continues past it",
    flowOutputs: [], terminates: {review: false, "approval/approved": true, "approval/rejected": false},
    text: `context {
  output result "final result"
}
phase review {
  gate approval "Approve?" {
    when approved {
      end "done"
    }
    when rejected {
      step revise by=llm
    }
  }
}
step finish by=llm {
  output result
}
`,
    expect: {missing: [], unreachable: [], end: ["result"], unused: []}},
  {name: "phase-gate-all-end", why: "every outcome ends; the implied revise loops back, so the phase ends",
    flowOutputs: [], terminates: {review: true, "approval/approved": true, "approval/rejected": true},
    text: `phase review {
  gate approval "Approve?" {
    when approved {
      end "done"
    }
    when rejected {
      end "stopped"
    }
  }
}
`,
    expect: {missing: [], unreachable: [], end: null, unused: []}},
  {name: "phase-gate-only-approved-ends", why: "approved ends and no other outcome is written: the phase ends",
    flowOutputs: [], terminates: {review: true, "approval/approved": true},
    text: `phase review {
  gate approval "Approve?" {
    when approved {
      end "done"
    }
  }
}
`,
    expect: {missing: [], unreachable: [], end: null, unused: []}},
  {name: "phase-gate-implied-approved", why: "rejected ends; the implied approved continues past the phase",
    flowOutputs: [], terminates: {review: false, "approval/rejected": true},
    text: `phase review {
  gate approval "Approve?" {
    when rejected {
      end "stopped"
    }
  }
}
step finish by=llm
`,
    expect: {missing: [], unreachable: [], end: [], unused: []}},
  {name: "phase-gate-revise-written", why: "a written revise overrides the implied loop and continues like any outcome",
    flowOutputs: [], terminates: {review: false, "approval/approved": true, "approval/revise": false},
    text: `phase review {
  gate approval "Approve?" {
    when approved {
      end "done"
    }
    when revise {
      step redo by=llm
    }
  }
}
step finish by=llm
`,
    expect: {missing: [], unreachable: [], end: [], unused: []}},
  {name: "phase-on-fail-ends", why: "an on-fail that ends does not end the phase: success continues",
    flowOutputs: [], terminates: {work: false, "run/on-fail": true},
    text: `phase work {
  step run by=code {
    on-fail {
      end "failed"
    }
  }
}
step finish by=llm
`,
    expect: {missing: [], unreachable: [], end: [], unused: []}},
];

// Form and placement cases: each must give errors matching every pattern, or no error when the list is empty.
export const formCases = [
  {name: "input-in-when", text: `decide d "?" by=llm {
  when a {
    input x
  }
}
`, errors: [/`input` is not allowed inside `when`/]},
  {name: "output-in-on-fail", text: `step s by=code {
  output x
  on-fail "Retry once." {
    output x
  }
}
`, errors: []},
  {name: "on-fail-only-output", why: "an output says what the recovery restores, not what happens", text: `step s by=code {
  output x
  on-fail {
    output x
  }
}
`, errors: [/`on-fail` is empty/]},
  {name: "input-in-on-fail", text: `step s by=code {
  on-fail "Retry once." {
    input x
  }
}
`, errors: [/`input` is not allowed inside `on-fail`/]},
  {name: "input-in-phase", text: `phase p {
  input x
}
`, errors: [/`input` is not allowed inside `phase`/]},
  {name: "input-top-level", text: `input x "top"
`, errors: [/`input` is not allowed at the top level/]},
  {name: "action-input-description", why: "the skill asks the user for new data, and says what it is", text: `step s by=llm {
  input x "described here"
}
`, errors: []},
  {name: "action-input-list", text: `context {
  input a "A"
  input b "B"
}
step s by=llm {
  input a b
}
`, errors: [/the description of an `input` must be a quoted string/]},
  {name: "action-output-empty", text: `step s by=llm {
  output
}
`, errors: [/needs one data name/]},
  {name: "action-output-spaces", text: `step s by=llm {
  output "my draft"
}
`, errors: [/needs one data name/]},
  {name: "action-input-property", text: `context {
  input x "X"
}
step s by=llm {
  input x by=llm
}
`, errors: [/unknown property `by` on `input`/]},
  {name: "action-output-children", text: `step s by=llm {
  output x {
    step y by=llm
  }
}
`, errors: [/takes no children/]},
  {name: "unknown-in-step", text: `context {
  input x "X"
}
step s by=llm {
  note x
}
`, errors: [/`note` is not allowed inside `step`.*allowed here: input, on-fail, output, tools/]},
  {name: "unknown-in-when", text: `decide d "?" by=llm {
  when a {
    note x
  }
}
`, errors: [/`note` is not allowed inside `when`.*allowed here: decide, end, gate, output, phase, step/]},
  {name: "context-input-no-name", text: `context {
  input
}
`, errors: [/`input` needs a name/]},
  {name: "context-unnamed-output", text: `context {
  output "a new section in CHANGELOG.md"
}
`, errors: []},
  {name: "context-output-one-word", text: `context {
  output summary
}
`, errors: [/description of a flow `output` must be a quoted string/]},
  {name: "context-input-two-words", text: `context {
  input a b
}
`, errors: [/description of a flow `input` must be a quoted string/]},
  {name: "context-input-bare-name", text: `context {
  input x
}
step s by=llm {
  input x
}
`, errors: [/a flow `input` needs a quoted description/]},
  {name: "context-raw-string-ok", text: `context {
  input a #"the "A" file"#
  output a """
    updated A
    """
}
step s by=llm {
  output a
}
`, errors: []},
];
