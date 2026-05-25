import { afterEach, describe, expect, it } from "vitest";
import { platformSettingDefaults } from "../shared/settings";
import { formatRupees } from "../shared/pdf";

const ENV_KEYS = ["PLATFORM_COMMISSION_RATE", "PLATFORM_MIN_PAYOUT_INR", "NEXT_PUBLIC_SITE_NAME"];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("platformSettingDefaults", () => {
  it("falls back to the documented defaults when env vars are absent", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const defaults = platformSettingDefaults();
    expect(defaults.site_name).toBe("CS-Ranger");
    expect(defaults.commission_rate).toBe(0.15);
    expect(defaults.min_payout_inr).toBe(500);
    expect(defaults.payout_schedule).toBe("manual");
    expect(defaults.feature_flags).toEqual({});
  });

  it("reads env overrides at call time", () => {
    process.env.PLATFORM_COMMISSION_RATE = "0.2";
    process.env.PLATFORM_MIN_PAYOUT_INR = "750";
    process.env.NEXT_PUBLIC_SITE_NAME = "Test Academy";
    const defaults = platformSettingDefaults();
    expect(defaults.commission_rate).toBe(0.2);
    expect(defaults.min_payout_inr).toBe(750);
    expect(defaults.site_name).toBe("Test Academy");
  });
});

describe("formatRupees", () => {
  it("converts paise to rupees with two decimals and Indian grouping", () => {
    expect(formatRupees(123456789)).toBe("Rs 12,34,567.89");
  });

  it("keeps the sign for negative amounts", () => {
    expect(formatRupees(-50000)).toBe("-Rs 500.00");
  });

  it("handles zero", () => {
    expect(formatRupees(0)).toBe("Rs 0.00");
  });
});
