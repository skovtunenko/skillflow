// The validator's report as the editor shows it: one list in line order, the worst problem of each line, and the steps from one problem to the next.
const WORST = ["warning", "todo", "error"];
const lineNumber = (at) => (at ? parseInt(String(at), 10) || 0 : 0);

/** [{kind, line, at, message, hint}] in line order; line 0 when the report names none. `at` is the place as the report writes it. */
export function problemList(report) {
  return [["error", report.errors], ["todo", report.todos], ["warning", report.warnings]]
    .flatMap(([kind, items]) => items.map(([at, message, hint]) => ({kind, line: lineNumber(at), at: at ? String(at) : "", message, hint: hint ?? ""})))
    .sort((x, y) => x.line - y.line);
}

/** Map of line -> {kind, items}: `kind` is the worst kind on the line, for its gutter mark and underline. */
export function byLine(problems) {
  const lines = new Map();
  for (const problem of problems) {
    const entry = lines.get(problem.line) ?? {kind: problem.kind, items: []};
    entry.items.push(problem);
    if (WORST.indexOf(problem.kind) > WORST.indexOf(entry.kind)) entry.kind = problem.kind;
    lines.set(problem.line, entry);
  }
  return lines;
}

/**
 * The index of the problem to go to from the cursor's `line`: `step` 1 is the next problem, -1 the one before; the list is a ring.
 * `active` is the index of the problem now shown, -1 for none. -1 when the list is empty.
 */
export function stepProblem(problems, active, line, step) {
  const count = problems.length, shown = problems[active];
  if (!count) return -1;
  // the cursor is still at the shown problem (one with no line has no place to leave): its neighbour in the list, so each problem of one line gets its turn
  if (shown && (shown.line === line || !shown.line)) return (active + step + count) % count;
  if (step > 0) return Math.max(0, problems.findIndex((problem) => problem.line > line));
  const before = problems.findLastIndex((problem) => problem.line < line);
  return before < 0 ? count - 1 : before;
}

/** The index of the problem to show for the cursor's `line`: the shown one when it is on that line, else the first of the line, else -1. */
export function problemAt(problems, active, line) {
  return problems[active]?.line === line ? active : problems.findIndex((problem) => problem.line === line);
}
