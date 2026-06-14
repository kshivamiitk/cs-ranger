// ============================================================
// Pure ordering helpers for the course tree. The DB stores an explicit
// `position` on modules and nodes, but PostgREST returns embedded resources in
// an arbitrary order unless told otherwise — so a course's modules/lessons came
// back shuffled. We sort by position on read here (deterministic, and robust to
// the two-level nesting that referencedTable ordering handles awkwardly).
//
// Tested in backend/tests/course-ordering.test.ts.
// ============================================================

export type WithPosition = { position?: number | null };
export type WithNodeParent = WithPosition & { id?: string | null; parent_node_id?: string | null };

/**
 * Comparator by ascending `position`. Rows with a null/undefined position sort
 * last (they're unplaced), and ties keep their incoming order (stable sort).
 */
export function byPosition(a: WithPosition, b: WithPosition): number {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  return pa - pb;
}

/**
 * Sort a flat node list into deterministic preorder. Nodes whose parent is not
 * present in the list are treated as roots, which keeps partial/out-of-date
 * payloads renderable instead of dropping rows.
 */
export function sortNodesPreorder<N extends WithNodeParent>(nodes: N[] | null | undefined): N[] {
  if (!Array.isArray(nodes)) return [];
  const ids = new Set(nodes.map((n) => n.id).filter((id): id is string => typeof id === "string" && id.length > 0));
  const groups = new Map<string, N[]>();
  const rootKey = "__root__";
  for (const node of nodes) {
    const parent = node.parent_node_id && ids.has(node.parent_node_id) ? node.parent_node_id : rootKey;
    const list = groups.get(parent) || [];
    list.push(node);
    groups.set(parent, list);
  }
  for (const [key, list] of groups) groups.set(key, [...list].sort(byPosition));

  const out: N[] = [];
  const seen = new Set<string>();
  const emitted = new Set<N>();
  const visit = (parent: string) => {
    for (const node of groups.get(parent) || []) {
      const id = node.id || "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      emitted.add(node);
      out.push(node);
      if (id) visit(id);
    }
  };
  visit(rootKey);
  for (const node of nodes) {
    if (!emitted.has(node)) out.push(node);
  }
  return out;
}

/**
 * Return modules sorted by position, each with its nodes sorted in folder
 * preorder. Non-mutating at the top level; safe to call on a freshly-fetched row.
 */
export function sortCourseTree<M extends WithPosition & { nodes?: WithNodeParent[] | null }>(
  modules: M[] | null | undefined,
): M[] {
  if (!Array.isArray(modules)) return [];
  const sorted = [...modules].sort(byPosition);
  for (const m of sorted) {
    if (Array.isArray(m.nodes)) m.nodes = sortNodesPreorder(m.nodes);
  }
  return sorted;
}
