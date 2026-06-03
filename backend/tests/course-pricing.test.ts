import { describe, expect, it } from "vitest";
import { resolveCoursePricing } from "../course-service/src/pricing";

// ============================================================
// Guards the "changed price → 'Course not found' / Razorpay charges the old
// price" class of bugs. The DB CHECK is `discounted_price < price`; a partial
// PATCH that leaves a stale discount (or flips a course to free) would violate
// it, get swallowed, and surface as a 404 while the price never persists.
// resolveCoursePricing keeps the written pair always valid.
// ============================================================

describe("resolveCoursePricing — premium → free", () => {
  it("clears a leftover discount when the course is made free (the 404 bug)", () => {
    // price 500 / discount 400, caller only sends price: 0
    const r = resolveCoursePricing({ price: 0 }, { price: 500, discounted_price: 400 });
    expect(r).toEqual({ ok: true, price: 0, discounted_price: null });
  });

  it("clears the discount even when both price:0 and a discount are sent", () => {
    const r = resolveCoursePricing({ price: 0, discounted_price: 100 }, { price: 500, discounted_price: 400 });
    expect(r).toEqual({ ok: true, price: 0, discounted_price: null });
  });
});

describe("resolveCoursePricing — lowering price below an existing discount", () => {
  it("drops a now-invalid stale discount when only price changes", () => {
    // price 1000 / discount 400, caller lowers price to 300 (so 400 is no longer below price)
    const r = resolveCoursePricing({ price: 300 }, { price: 1000, discounted_price: 400 });
    expect(r).toEqual({ ok: true, price: 300, discounted_price: null });
  });

  it("keeps a still-valid discount when price is lowered but stays above it", () => {
    const r = resolveCoursePricing({ price: 500 }, { price: 1000, discounted_price: 400 });
    expect(r).toEqual({ ok: true, price: 500, discounted_price: 400 });
  });
});

describe("resolveCoursePricing — explicit invalid pair is rejected clearly", () => {
  it("rejects when caller sets discount >= price (both provided, paid course)", () => {
    expect(resolveCoursePricing({ price: 300, discounted_price: 400 }, { price: 1000, discounted_price: null }))
      .toEqual({ ok: false, error: "Discounted price must be lower than the price" });
    expect(resolveCoursePricing({ price: 300, discounted_price: 300 }, { price: 1000, discounted_price: null }))
      .toEqual({ ok: false, error: "Discounted price must be lower than the price" });
  });
});

describe("resolveCoursePricing — normal edits", () => {
  it("sets a valid new discount", () => {
    expect(resolveCoursePricing({ price: 1000, discounted_price: 600 }, { price: 1000, discounted_price: null }))
      .toEqual({ ok: true, price: 1000, discounted_price: 600 });
  });

  it("free → premium: sets price, no discount carried", () => {
    expect(resolveCoursePricing({ price: 499 }, { price: 0, discounted_price: null }))
      .toEqual({ ok: true, price: 499, discounted_price: null });
  });

  it("leaves an untouched valid pair intact when neither field is in the patch", () => {
    expect(resolveCoursePricing({}, { price: 1000, discounted_price: 700 }))
      .toEqual({ ok: true, price: 1000, discounted_price: 700 });
  });

  it("updates only the discount, keeping the existing price", () => {
    expect(resolveCoursePricing({ discounted_price: 250 }, { price: 1000, discounted_price: null }))
      .toEqual({ ok: true, price: 1000, discounted_price: 250 });
  });

  it("treats a 0 discount as a real value below price (not cleared)", () => {
    expect(resolveCoursePricing({ discounted_price: 0 }, { price: 1000, discounted_price: null }))
      .toEqual({ ok: true, price: 1000, discounted_price: 0 });
  });
});
