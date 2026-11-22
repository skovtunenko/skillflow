// What changed between two models of a flow, as render.mjs builds them.

/** [key, node] of every node of a model's flow. The key stays the same across renders: kind and name, or kind, parent, and text for a node without a name. */
export function* walk(nodes, parent = "") {
  for (const node of nodes) {
    yield [node.name ? `${node.kind}:${node.name}` : `${node.kind}:${parent}:${node.text ?? node.prose ?? ""}`, node];
    yield* walk(node.children ?? [], node.name ?? parent);
    if (node.onfail) { yield [`onfail:${node.name}`, node.onfail]; yield* walk(node.onfail.children, node.name); }
    for (const branch of node.whens ?? []) yield* walk(branch.children, `${node.name}/${branch.outcome}`);
  }
}

// a node's own content: its place in the file and its children do not count as a change of the node
const content = (node) => JSON.stringify(node, (key, value) => (["id", "line", "children", "step", "ends"].includes(key) ? undefined : value));

/** {added, changed}: ids in `after` of the nodes that `before` does not have, and of those whose content differs. */
export function changes(before, after) {
  const was = new Map(walk(before.flow)), added = [], changed = [];
  for (const [key, node] of walk(after.flow)) {
    if (!was.has(key)) added.push(node.id);
    else if (content(was.get(key)) !== content(node)) changed.push(node.id);
  }
  return {added, changed};
}
