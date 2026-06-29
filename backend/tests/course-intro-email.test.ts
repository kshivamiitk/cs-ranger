import { describe, expect, it } from "vitest";
import { renderCourseIntroEmail } from "../shared/email";

describe("renderCourseIntroEmail", () => {
  it("uses the creator-authored welcome message", () => {
    const email = renderCourseIntroEmail({
      learnerName: "Asha Singh",
      courseTitle: "System Design Foundations",
      courseId: "course-123",
      welcomeMessage: "Start with Module 1.\n\nPost doubts after each lesson.",
    });

    expect(email.subject).toBe("Welcome to System Design Foundations");
    expect(email.text).toContain("You're enrolled, Asha!");
    expect(email.text).toContain("Post doubts after each lesson.");
    expect(email.html).toContain("Start with Module 1.");
    expect(email.html).toContain("Post doubts after each lesson.");
  });

  it("escapes HTML in creator-authored content", () => {
    const email = renderCourseIntroEmail({
      learnerName: "Learner",
      courseTitle: "Security Basics",
      courseId: "course-456",
      welcomeMessage: "Read this <script>alert('x')</script> first.",
    });

    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
  });
});
