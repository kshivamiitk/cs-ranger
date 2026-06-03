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
 * Return modules sorted by position, each with its nodes sorted by position.
 * Non-mutating at the top level; safe to call on a freshly-fetched row.
 */
export function sortCourseTree<M extends WithPosition & { nodes?: WithPosition[] | null }>(
  modules: M[] | null | undefined,
): M[] {
  if (!Array.isArray(modules)) return [];
  const sorted = [...modules].sort(byPosition);
  for (const m of sorted) {
    if (Array.isArray(m.nodes)) m.nodes = [...m.nodes].sort(byPosition);
  }
  return sorted;
}
