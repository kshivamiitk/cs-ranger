import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  isRazorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../shared/razorpay";
import {
  chargeableAmountPaise,
  decideWebhookAction,
  pickCapturablePayment,
  grantsAccess,
  type PaymentStatus,
} from "../payment-service/src/logic";

// ============================================================
// Payment is the most safety-critical path: money moves and access is
// granted off the back of these decisions. The bug we are guarding against
// is "money deducted but no course access", so the suite covers the whole
// chain — signature trust, what we charge, how webhooks transition state,
// and how the reconciler self-heals a lost verify/webhook.
// ============================================================

// ─── Signature verification (security boundary) ───────────────────
// These functions are the ONLY thing standing between a forged request and a
// granted enrollment / refund, so every failure mode must return false.
describe("verifyPaymentSignature", () => {
  const KEY_SECRET = "test_secret_key";
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";
  const validSig = createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

  const saved = { ...process.env };
  beforeEach(() => { process.env.RAZORPAY_KEY_SECRET = KEY_SECRET; });
  afterEach(() => { process.env = { ...saved }; });

  it("accepts the genuine HMAC of order_id|payment_id", () => {
    expect(verifyPaymentSignature(orderId, paymentId, validSig)).toBe(true);
  });

  it("rejects a tampered signature of the correct length", () => {
    const tampered = validSig.slice(0, -1) + (validSig.endsWith("a") ? "b" : "a");
    expect(verifyPaymentSignature(orderId, paymentId, tampered)).toBe(false);
  });

  it("rejects when the order_id is swapped (replaying a sig from another order)", () => {
    expect(verifyPaymentSignature("order_DIFFERENT", paymentId, validSig)).toBe(false);
  });

  it("rejects when the payment_id is swapped", () => {
    expect(verifyPaymentSignature(orderId, "pay_DIFFERENT", validSig)).toBe(false);
  });

  it("rejects a signature of the wrong length (timing-safe length guard)", () => {
    expect(verifyPaymentSignature(orderId, paymentId, "deadbeef")).toBe(false);
    expect(verifyPaymentSignature(orderId, paymentId, "")).toBe(false);
  });

  it("rejects everything when the secret is not configured (fails closed)", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(verifyPaymentSignature(orderId, paymentId, validSig)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const WEBHOOK_SECRET = "test_webhook_secret";
  const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } });
  const validSig = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  const saved = { ...process.env };
  beforeEach(() => { process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET; });
  afterEach(() => { process.env = { ...saved }; });

  it("accepts the genuine HMAC of the raw body", () => {
    expect(verifyWebhookSignature(rawBody, validSig)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(rawBody, undefined)).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const tamperedBody = rawBody.replace("payment.captured", "payment.failed");
    expect(verifyWebhookSignature(tamperedBody, validSig)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifyWebhookSignature(rawBody, "short")).toBe(false);
  });

  it("rejects everything when the webhook secret is not configured (fails closed)", () => {
    // This is the exact misconfig that breaks the safety net: a missing
    // RAZORPAY_WEBHOOK_SECRET silently rejects every real webhook.
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(verifyWebhookSignature(rawBody, validSig)).toBe(false);
  });
});

describe("isRazorpayConfigured", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("is true only when both key id and secret are present", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(isRazorpayConfigured()).toBe(true);
  });

  it("is false when either half is missing", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(isRazorpayConfigured()).toBe(false);

    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(isRazorpayConfigured()).toBe(false);
  });
});

// ─── What we charge ───────────────────────────────────────────────
describe("chargeableAmountPaise", () => {
  it("charges full price in paise when there is no discount", () => {
    expect(chargeableAmountPaise({ price: 499, discounted_price: null })).toEqual({ amountPaise: 49900, usedDiscount: false });
  });

  it("uses a valid discount that is positive and below price", () => {
    expect(chargeableAmountPaise({ price: 1000, discounted_price: 600 })).toEqual({ amountPaise: 60000, usedDiscount: true });
  });

  it("treats discounted_price === 0 as 'no discount', NOT a free course (the ₹0 bug)", () => {
    expect(chargeableAmountPaise({ price: 1000, discounted_price: 0 })).toEqual({ amountPaise: 100000, usedDiscount: false });
  });

  it("ignores a discount equal to or above price", () => {
    expect(chargeableAmountPaise({ price: 500, discounted_price: 500 })).toEqual({ amountPaise: 50000, usedDiscount: false });
    expect(chargeableAmountPaise({ price: 500, discounted_price: 700 })).toEqual({ amountPaise: 50000, usedDiscount: false });
  });

  it("ignores a negative discount", () => {
    expect(chargeableAmountPaise({ price: 500, discounted_price: -100 })).toEqual({ amountPaise: 50000, usedDiscount: false });
  });

  it("returns null for a free course (price 0 / null / negative) so it routes to free enrollment", () => {
    expect(chargeableAmountPaise({ price: 0, discounted_price: null })).toBeNull();
    expect(chargeableAmountPaise({ price: null, discounted_price: null })).toBeNull();
    expect(chargeableAmountPaise({ price: -10, discounted_price: null })).toBeNull();
  });
});

// ─── Webhook state machine ────────────────────────────────────────
describe("decideWebhookAction", () => {
  it("verifies on payment.captured while pending (the happy server-side path)", () => {
    expect(decideWebhookAction("payment.captured", "pending")).toEqual({ kind: "verify" });
  });

  it("treats payment.authorized the same as captured", () => {
    expect(decideWebhookAction("payment.authorized", "pending")).toEqual({ kind: "verify" });
  });

  it("still verifies a captured webhook on a payment our sweeper marked failed (recovery)", () => {
    // verify_payment allows pending|failed → success, so a captured event must
    // not be dropped just because expire_pending_orders ran first.
    expect(decideWebhookAction("payment.captured", "failed")).toEqual({ kind: "verify" });
  });

  it("is idempotent: a captured webhook on an already-success payment still routes to verify (RPC no-ops)", () => {
    expect(decideWebhookAction("payment.captured", "success")).toEqual({ kind: "verify" });
  });

  it("marks failed only while pending", () => {
    expect(decideWebhookAction("payment.failed", "pending")).toEqual({ kind: "mark_failed" });
  });

  it("never walks a successful payment backwards on a late failed webhook", () => {
    expect(decideWebhookAction("payment.failed", "success")).toEqual({ kind: "ignore", reason: "terminal" });
    expect(decideWebhookAction("payment.failed", "failed")).toEqual({ kind: "ignore", reason: "terminal" });
  });

  it("ignores every event once the payment is refunded (terminal)", () => {
    for (const ev of ["payment.captured", "payment.authorized", "payment.failed", "refund.processed", undefined]) {
      expect(decideWebhookAction(ev, "refunded")).toEqual({ kind: "ignore", reason: "already_refunded" });
    }
  });

  it("ignores unknown / unhandled events", () => {
    expect(decideWebhookAction("order.paid", "pending")).toEqual({ kind: "ignore", reason: "unhandled_event" });
    expect(decideWebhookAction(undefined, "pending")).toEqual({ kind: "ignore", reason: "unhandled_event" });
  });
});

// ─── Gateway reconciliation (self-heal) ───────────────────────────
describe("pickCapturablePayment", () => {
  it("returns null for no payments on the order (nothing was captured)", () => {
    expect(pickCapturablePayment([])).toBeNull();
    expect(pickCapturablePayment(null)).toBeNull();
    expect(pickCapturablePayment(undefined)).toBeNull();
  });

  it("picks a captured payment", () => {
    expect(pickCapturablePayment([{ id: "pay_1", status: "captured" }])).toEqual({ id: "pay_1", status: "captured" });
  });

  it("picks an authorized payment when nothing is captured yet", () => {
    expect(pickCapturablePayment([{ id: "pay_1", status: "authorized" }])).toEqual({ id: "pay_1", status: "authorized" });
  });

  it("prefers captured over authorized when both exist on the order", () => {
    const items = [{ id: "pay_auth", status: "authorized" }, { id: "pay_cap", status: "captured" }];
    expect(pickCapturablePayment(items)).toEqual({ id: "pay_cap", status: "captured" });
  });

  it("does not treat created / failed / refunded as money we can grant access for", () => {
    expect(pickCapturablePayment([{ id: "p", status: "created" }])).toBeNull();
    expect(pickCapturablePayment([{ id: "p", status: "failed" }])).toBeNull();
    expect(pickCapturablePayment([{ id: "p", status: "refunded" }])).toBeNull();
  });
});

describe("grantsAccess", () => {
  it("grants access only for a successful payment", () => {
    const cases: [PaymentStatus, boolean][] = [
      ["success", true],
      ["pending", false],
      ["failed", false],
      ["refunded", false],
    ];
    for (const [status, expected] of cases) expect(grantsAccess(status)).toBe(expected);
  });
});
