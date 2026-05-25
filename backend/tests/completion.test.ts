import { describe, expect, it } from "vitest";
import { evaluateCompletion, type NodeCore } from "../enrollment-service/src/completion";

const node = (type: NodeCore["type"], duration: number | null = null): NodeCore => ({
  id: "node-1",
  type,
  duration_seconds: duration,
  course_id: "course-1",
});

describe("evaluateCompletion (per-node-type completion policy)", () => {
  it("does not complete a markdown lesson below the 80% scroll threshold", () => {
    const verdict = evaluateCompletion(node("markdown"), { scrollPercent: 60, watchSeconds: 0, durationSeconds: null }, false);
    expect(verdict.completed).toBe(false);
  });

  it("completes markdown / pdf at 80% scroll with the scroll_80 rule", () => {
    expect(evaluateCompletion(node("markdown"), { scrollPercent: 80, watchSeconds: 0, durationSeconds: null }, false))
      .toEqual({ completed: true, rule: "scroll_80" });
    expect(evaluateCompletion(node("pdf"), { scrollPercent: 95, watchSeconds: 0, durationSeconds: null }, false))
      .toEqual({ completed: true, rule: "scroll_80" });
  });

  it("completes a video at 80% of the known duration with the watch_80 rule", () => {
    const verdict = evaluateCompletion(node("video", 100), { scrollPercent: 0, watchSeconds: 80, durationSeconds: null }, false);
    expect(verdict).toEqual({ completed: true, rule: "watch_80" });
  });

  it("prefers the reported duration when the node has none stored", () => {
    const verdict = evaluateCompletion(node("video"), { scrollPercent: 0, watchSeconds: 160, durationSeconds: 200 }, false);
    expect(verdict).toEqual({ completed: true, rule: "watch_80" });
  });

  it("never auto-completes a video without any known duration", () => {
    const verdict = evaluateCompletion(node("video"), { scrollPercent: 100, watchSeconds: 9999, durationSeconds: null }, false);
    expect(verdict.completed).toBe(false);
  });

  it("treats explicit Mark-as-Done as the manual rule for content nodes", () => {
    expect(evaluateCompletion(node("static_website"), { scrollPercent: 0, watchSeconds: 0, durationSeconds: null }, true))
      .toEqual({ completed: true, rule: "manual" });
    expect(evaluateCompletion(node("video"), { scrollPercent: 0, watchSeconds: 0, durationSeconds: null }, true))
      .toEqual({ completed: true, rule: "manual" });
  });

  it("static websites only complete via Mark-as-Done", () => {
    const verdict = evaluateCompletion(node("static_website"), { scrollPercent: 100, watchSeconds: 0, durationSeconds: null }, false);
    expect(verdict.completed).toBe(false);
  });

  it("quizzes never complete through the generic progress path, even with markDone", () => {
    expect(evaluateCompletion(node("quiz"), { scrollPercent: 100, watchSeconds: 100, durationSeconds: 100 }, true).completed).toBe(false);
  });
});
