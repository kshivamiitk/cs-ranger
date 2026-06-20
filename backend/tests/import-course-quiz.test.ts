import { describe, expect, it } from "vitest";
// The course importer is a standalone ESM script (scripts/import-course.mjs).
// It exports its pure helpers so the quiz-import logic — the part that mirrors
// the backend `quiz_payload` Zod schema (exactly 4 options, correctIndex 0..3,
// >= 5 questions) — can be unit-tested without hitting the API or the network.
import { formatQuizText, normalizeQuiz, summarize, titleFromName } from "../../scripts/import-course.mjs";

// A valid question with the 4-option / 0..3 shape the backend requires.
const q = (id: string, correctIndex = 0) => ({
  id,
  prompt: `Prompt for ${id}`,
  options: ["alpha", "beta", "gamma", "delta"],
  correctIndex,
  explanation: `Because of ${id}.`,
});
// Five valid questions — the minimum a quiz is allowed to have.
const fiveQs = (prefix = "q") => [1, 2, 3, 4, 5].map((n) => q(`${prefix}-${n}`, n % 4));

describe("normalizeQuiz — accepted shapes", () => {
  it("accepts a full wrapper and carries timer, passing score, and title", () => {
    const warnings: string[] = [];
    const { quiz_payload, title } = normalizeQuiz(
      { title: "Quiz: Regression", timerSeconds: 600, passingPercent: 70, questions: fiveQs("regression") },
      "file.quiz.json",
      warnings,
    );
    expect(title).toBe("Quiz: Regression");
    expect(quiz_payload.timerSeconds).toBe(600);
    expect(quiz_payload.passingPercent).toBe(70);
    expect(quiz_payload.questions).toHaveLength(5);
    expect(quiz_payload.questions[0]).toEqual(q("regression-1", 1));
    expect(warnings).toHaveLength(0);
  });

  it("accepts a bare question array (no wrapper, no timer/passing/title)", () => {
    const warnings: string[] = [];
    const { quiz_payload, title } = normalizeQuiz(fiveQs(), "file.quiz.json", warnings);
    expect(title).toBeUndefined();
    expect(quiz_payload.timerSeconds).toBeUndefined();
    expect(quiz_payload.passingPercent).toBeUndefined();
    expect(quiz_payload.questions).toHaveLength(5);
  });

  it("truncates non-integer timerSeconds/passingPercent to integers", () => {
    const { quiz_payload } = normalizeQuiz(
      { timerSeconds: 600.9, passingPercent: 70.4, questions: fiveQs() },
      "file.quiz.json",
      [],
    );
    expect(quiz_payload.timerSeconds).toBe(600);
    expect(quiz_payload.passingPercent).toBe(70);
  });

  it("keeps only the schema fields and drops unknown extras", () => {
    const noisy = [{ ...q("a-1"), bonus: 42, tags: ["x"] }, ...fiveQs("b")];
    const { quiz_payload } = normalizeQuiz(noisy, "file.quiz.json", []);
    expect(Object.keys(quiz_payload.questions[0]).sort()).toEqual(
      ["correctIndex", "explanation", "id", "options", "prompt"],
    );
  });
});

describe("normalizeQuiz — validation that mirrors the backend schema", () => {
  it("rejects fewer than 5 questions", () => {
    expect(() => normalizeQuiz([q("a"), q("b"), q("c"), q("d")], "f.quiz.json", []))
      .toThrow(/at least 5 questions/);
  });

  it("rejects options that are not exactly 4 strings", () => {
    const three = [{ ...q("a-1"), options: ["a", "b", "c"] }, ...fiveQs("b")];
    expect(() => normalizeQuiz(three, "f.quiz.json", [])).toThrow(/exactly 4/);
    const blank = [{ ...q("a-1"), options: ["a", "b", "c", "  "] }, ...fiveQs("b")];
    expect(() => normalizeQuiz(blank, "f.quiz.json", [])).toThrow(/exactly 4/);
  });

  it("rejects correctIndex outside 0..3 or non-integer", () => {
    const high = [{ ...q("a-1"), correctIndex: 4 }, ...fiveQs("b")];
    expect(() => normalizeQuiz(high, "f.quiz.json", [])).toThrow(/0, 1, 2 or 3/);
    const frac = [{ ...q("a-1"), correctIndex: 1.5 }, ...fiveQs("b")];
    expect(() => normalizeQuiz(frac, "f.quiz.json", [])).toThrow(/0, 1, 2 or 3/);
  });

  it("rejects duplicate question ids within a quiz", () => {
    const dup = [q("same"), q("same"), q("c"), q("d"), q("e")];
    expect(() => normalizeQuiz(dup, "f.quiz.json", [])).toThrow(/duplicate question id/);
  });

  it("rejects a question missing its id or prompt", () => {
    const noId = [{ ...q("a-1"), id: "" }, ...fiveQs("b")];
    expect(() => normalizeQuiz(noId, "f.quiz.json", [])).toThrow(/missing a non-empty "id"/);
    const noPrompt = [{ ...q("a-1"), prompt: "" }, ...fiveQs("b")];
    expect(() => normalizeQuiz(noPrompt, "f.quiz.json", [])).toThrow(/missing "prompt"/);
  });

  it("rejects JSON that is neither an array nor a { questions } object", () => {
    expect(() => normalizeQuiz({ foo: "bar" }, "f.quiz.json", [])).toThrow(/array of questions or an object/);
  });

  it("warns (but does not throw) when an explanation is missing, and omits it from output", () => {
    const warnings: string[] = [];
    const noExpl = [{ id: "x-1", prompt: "p", options: ["a", "b", "c", "d"], correctIndex: 2 }, ...fiveQs("b")];
    const { quiz_payload } = normalizeQuiz(noExpl, "f.quiz.json", warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no explanation/);
    expect(quiz_payload.questions[0]).not.toHaveProperty("explanation");
  });
});

describe("summarize — dry-run plan counts quizzes separately", () => {
  it("counts markdown, pdf, static sites, and quizzes (recursing folders)", () => {
    const plan = {
      modules: [
        {
          title: "M1",
          items: [
            { kind: "lesson", type: "markdown" },
            { kind: "lesson", type: "quiz" },
            {
              kind: "folder",
              items: [
                { kind: "lesson", type: "static_website" },
                { kind: "lesson", type: "quiz" },
                { kind: "lesson", type: "pdf" },
              ],
            },
          ],
        },
      ],
    };
    const counts = summarize(plan);
    expect(counts).toMatchObject({
      modules: 1,
      folders: 1,
      markdown: 1,
      pdf: 1,
      staticSites: 1,
      quizzes: 2,
    });
    expect(counts.lessons).toBe(5); // markdown + pdf + static + quizzes
  });
});

describe("formatQuizText — multi-line code becomes <pre><code> so it renders on its own lines", () => {
  it("wraps a blank-line-separated code block, keeping the question as prose", () => {
    const out = formatQuizText("What does this print?\n\nimport numpy as np\nprint(np.mean([1, 2, 3]))");
    expect(out).toBe("<p>What does this print?</p><pre><code>import numpy as np\nprint(np.mean([1, 2, 3]))</code></pre>");
    // The newline inside the code block survives (that is the whole point).
    expect(out).toContain("np\nprint");
  });

  it("escapes HTML-special characters in the code so they are not parsed as tags", () => {
    const out = formatQuizText("Trace it:\n\nfor i in range(3):\n    if a < b & c > d:\n        pass");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;");
    expect(out).not.toMatch(/<(?!\/?(?:p|pre|code)\b)/); // no stray tags beyond p/pre/code
  });

  it("handles prose → code → prose (e.g. a confusion-matrix question)", () => {
    const out = formatQuizText("Given this matrix:\n\nTN 90  FP 10\nFN 20  TP 30\n\nWhat is the recall?");
    expect(out).toBe("<p>Given this matrix:</p><pre><code>TN 90  FP 10\nFN 20  TP 30</code></pre><p>What is the recall?</p>");
  });

  it("leaves single-line text, plain prose paragraphs, and existing HTML untouched", () => {
    expect(formatQuizText("Just a normal one-line prompt.")).toBe("Just a normal one-line prompt.");
    expect(formatQuizText("Para one.\n\nPara two.")).toBe("Para one.\n\nPara two."); // no multi-line block
    expect(formatQuizText("Already <strong>rich</strong>\n\nwith lines\nhere")).toBe("Already <strong>rich</strong>\n\nwith lines\nhere");
    expect(formatQuizText(undefined as unknown as string)).toBeUndefined();
  });

  it("is applied by normalizeQuiz to prompts on the way out", () => {
    const withCode = [
      { id: "c-1", prompt: "Run it:\n\nx = 1\nprint(x)", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "ok" },
      ...fiveQs("b"),
    ];
    const { quiz_payload } = normalizeQuiz(withCode, "f.quiz.json", []);
    expect(quiz_payload.questions[0].prompt).toBe("<p>Run it:</p><pre><code>x = 1\nprint(x)</code></pre>");
  });
});

describe("titleFromName", () => {
  it("strips the numeric prefix and extension, then title-cases", () => {
    expect(titleFromName("01 Welcome.md")).toBe("Welcome");
    expect(titleFromName("70 Quiz — Regression.quiz")).toBe("Quiz — Regression");
    expect(titleFromName("02_two-pointers")).toBe("Two Pointers");
  });
});
