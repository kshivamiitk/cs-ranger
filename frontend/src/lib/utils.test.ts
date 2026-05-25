import { describe, expect, it } from "vitest";
import { durationFromSeconds, formatINR, initials } from "./utils";

describe("formatINR", () => {
  it("formats whole rupees with the ₹ symbol and Indian grouping", () => {
    const out = formatINR(123456);
    expect(out).toContain("₹");
    expect(out).toContain("1,23,456");
  });

  it("rounds away fractional paise (maximumFractionDigits: 0)", () => {
    expect(formatINR(999.4)).toContain("999");
  });
});

describe("durationFromSeconds", () => {
  it("renders hours and minutes for long durations", () => {
    expect(durationFromSeconds(3700)).toBe("1h 1m");
  });

  it("renders minutes only when under an hour", () => {
    expect(durationFromSeconds(150)).toBe("2m");
  });

  it("renders seconds when under a minute", () => {
    expect(durationFromSeconds(45)).toBe("45s");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(initials("Arjun Mehta")).toBe("AM");
    expect(initials("ananya")).toBe("A");
  });

  it("ignores extra whitespace and additional words", () => {
    expect(initials("  Priya   Sharma  Extra ")).toBe("PS");
  });
});
