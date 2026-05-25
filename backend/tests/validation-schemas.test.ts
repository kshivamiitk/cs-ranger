import { describe, expect, it } from "vitest";
import { OnboardingPatch } from "../user-service/src/onboarding";
import { RefundDecision } from "../support-service/src/validation";

describe("OnboardingPatch validation", () => {
  it("accepts a valid step patch with role + profile + preferences", () => {
    const result = OnboardingPatch.safeParse({
      step: 2,
      roles: "both",
      profile: { displayName: "Aarav Sharma", username: "aarav_sharma", bio: "Hi" },
      preferences: { domains: ["Algorithms"], skillLevel: "beginner", language: "English", emailNotifications: true },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range step", () => {
    expect(OnboardingPatch.safeParse({ step: 5 }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ step: -1 }).success).toBe(false);
  });

  it("rejects an invalid username format with the friendly message", () => {
    const result = OnboardingPatch.safeParse({ profile: { username: "Bad Name!" } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("3–30 chars");
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(OnboardingPatch.safeParse({ step: 1, hacker: true }).success).toBe(false);
  });

  it("rejects an unknown skill level", () => {
    expect(OnboardingPatch.safeParse({ preferences: { skillLevel: "wizard" } }).success).toBe(false);
  });
});

describe("RefundDecision validation", () => {
  it("allows approval without a reason", () => {
    expect(RefundDecision.safeParse({ approved: true }).success).toBe(true);
  });

  it("requires a reason when rejecting", () => {
    const result = RefundDecision.safeParse({ approved: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("reason is required");
  });

  it("accepts a rejection with a reason of at least 5 characters", () => {
    expect(RefundDecision.safeParse({ approved: false, reason: "Outside the refund window" }).success).toBe(true);
    expect(RefundDecision.safeParse({ approved: false, reason: "no" }).success).toBe(false);
  });
});
