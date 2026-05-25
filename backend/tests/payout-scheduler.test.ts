import { describe, expect, it } from "vitest";
import { currentPayoutWindow, nextPayoutWindowOpensAt } from "../payout-service/src/scheduler";

describe("currentPayoutWindow", () => {
  it("returns null for the manual schedule (nothing is ever auto-due)", () => {
    expect(currentPayoutWindow("manual", new Date("2026-06-10T08:00:00Z"))).toBeNull();
  });

  it("monthly_1st: every day of the month maps to the same window key", () => {
    const early = currentPayoutWindow("monthly_1st", new Date("2026-06-01T00:05:00Z"))!;
    const late = currentPayoutWindow("monthly_1st", new Date("2026-06-30T23:55:00Z"))!;
    expect(early.key).toBe("monthly_1st:2026-06-01");
    expect(late.key).toBe(early.key);
    expect(early.opensAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("monthly_1st: different months produce different keys", () => {
    const june = currentPayoutWindow("monthly_1st", new Date("2026-06-15T12:00:00Z"))!;
    const july = currentPayoutWindow("monthly_1st", new Date("2026-07-15T12:00:00Z"))!;
    expect(june.key).not.toBe(july.key);
  });

  it("monthly_1st_15th: first half and second half of the month are separate windows", () => {
    const firstHalf = currentPayoutWindow("monthly_1st_15th", new Date("2026-06-07T10:00:00Z"))!;
    const secondHalf = currentPayoutWindow("monthly_1st_15th", new Date("2026-06-21T10:00:00Z"))!;
    expect(firstHalf.key).toBe("monthly_1st_15th:2026-06-01");
    expect(secondHalf.key).toBe("monthly_1st_15th:2026-06-15");
    expect(firstHalf.key).not.toBe(secondHalf.key);
  });

  it("monthly_1st_15th: repeated calls inside the same half-month are idempotent (same key)", () => {
    const a = currentPayoutWindow("monthly_1st_15th", new Date("2026-06-15T00:00:00Z"))!;
    const b = currentPayoutWindow("monthly_1st_15th", new Date("2026-06-30T23:59:59Z"))!;
    expect(a.key).toBe(b.key);
  });
});

describe("nextPayoutWindowOpensAt", () => {
  it("returns null for the manual schedule", () => {
    expect(nextPayoutWindowOpensAt("manual", new Date("2026-06-10T08:00:00Z"))).toBeNull();
  });

  it("monthly_1st: next window is the 1st of the following month (incl. December → January rollover)", () => {
    expect(nextPayoutWindowOpensAt("monthly_1st", new Date("2026-06-10T08:00:00Z"))!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(nextPayoutWindowOpensAt("monthly_1st", new Date("2026-12-20T08:00:00Z"))!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("monthly_1st_15th: before the 15th the next window is the 15th, after it the 1st of next month", () => {
    expect(nextPayoutWindowOpensAt("monthly_1st_15th", new Date("2026-06-07T08:00:00Z"))!.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(nextPayoutWindowOpensAt("monthly_1st_15th", new Date("2026-06-20T08:00:00Z"))!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
