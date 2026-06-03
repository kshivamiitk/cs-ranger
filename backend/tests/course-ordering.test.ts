import { describe, expect, it } from "vitest";
import { byPosition, sortCourseTree } from "../course-service/src/ordering";

// ============================================================
// Guards the "modules/lessons come back in random order" bug. The DB has an
// explicit `position`, but PostgREST returns embedded resources unordered, so
// reads must sort the tree by position before returning it.
// ============================================================

describe("byPosition", () => {
  it("orders ascending by position", () => {
    expect([{ position: 2 }, { position: 0 }, { position: 1 }].sort(byPosition))
      .toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);
  });

  it("sorts rows with a missing/null position last", () => {
    const sorted = [{ position: null }, { position: 1 }, { position: undefined }, { position: 0 }].sort(byPosition);
    expect(sorted.slice(0, 2)).toEqual([{ position: 0 }, { position: 1 }]);
    // the two unplaced rows trail the placed ones
    expect(sorted.slice(2).every((r) => r.position == null)).toBe(true);
  });
});

describe("sortCourseTree", () => {
  it("sorts modules and each module's nodes by position", () => {
    const modules = [
      { id: "m2", position: 1, nodes: [{ id: "n2", position: 1 }, { id: "n1", position: 0 }] },
      { id: "m1", position: 0, nodes: [{ id: "b", position: 2 }, { id: "a", position: 0 }, { id: "c", position: 1 }] },
    ];
    const sorted = sortCourseTree(modules);
    expect(sorted.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(sorted[0].nodes!.map((n) => n.id)).toEqual(["a", "c", "b"]);
    expect(sorted[1].nodes!.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("tolerates modules with no nodes array", () => {
    const sorted = sortCourseTree([{ id: "m1", position: 0 }] as { id: string; position: number; nodes?: { position?: number | null }[] }[]);
    expect(sorted.map((m) => m.id)).toEqual(["m1"]);
  });

  it("returns [] for null/undefined input", () => {
    expect(sortCourseTree(null)).toEqual([]);
    expect(sortCourseTree(undefined)).toEqual([]);
  });

  it("is a stable order for equal positions (keeps incoming order)", () => {
    const modules = [{ id: "a", position: 0 }, { id: "b", position: 0 }, { id: "c", position: 0 }];
    expect(sortCourseTree(modules).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
