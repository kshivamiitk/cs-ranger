// ============================================================
// Pure, dependency-free payment decision logic.
//
// Everything money-correctness-critical that can be expressed as a pure
// function lives here so it can be unit-tested exhaustively without
// Supabase / Razorpay / Redis (see backend/tests/payment.test.ts). The
// index.ts handlers stay thin: they do I/O and delegate the decisions here.
// ============================================================

// ─── Pricing ──────────────────────────────────────────────────────
export type CoursePricing = { price: number | null; discounted_price: number | null };

/**
 * How much to charge for a course, in paise, mirroring the create-order rules.
 *
 * Returns null for a free course (price 0 / null / negative) — the caller routes
 * those to the free-enrollment endpoint instead.
 *
 * The discount applies ONLY when it is a positive number strictly below price.
 * In particular discounted_price === 0 means "no discount" (not "₹0 course") and
 * discounted_price >= price is ignored — this is the bug class that previously
 * let a 0 discount charge ₹0 through the paid path.
 */
export function chargeableAmountPaise(course: CoursePricing): { amountPaise: number; usedDiscount: boolean } | null {
  if (!course.price || course.price <= 0) return null;
  const usedDiscount =
    typeof course.discounted_price === "number" &&
    course.discounted_price > 0 &&
    course.discounted_price < course.price;
  const amount = usedDiscount ? (course.discounted_price as number) : course.price;
  return { amountPaise: amount * 100, usedDiscount };
}

// ─── Webhook routing ──────────────────────────────────────────────
export type PaymentStatus = "pending" | "success" | "failed" | "refunded";

export type WebhookAction =
  | { kind: "verify" } //       run verify_payment (idempotent; safe even on success)
  | { kind: "mark_failed" } //  flip pending → failed and notify the learner
  | { kind: "ignore"; reason: string };

/**
 * Decide what a Razorpay webhook should do given the event and our current
 * local payment status. Captures the "never walk a payment backwards" and
 * "captured/authorized both mean money is ours" rules in one place.
 *
 *   - refunded is terminal: ignore everything (an out-of-order webhook must
 *     never flip refunded back to success/failed).
 *   - captured / authorized → verify_payment. The RPC is idempotent, so this
 *     is a no-op if we already recorded success, and it can still rescue a
 *     payment our sweeper prematurely marked 'failed'.
 *   - payment.failed only marks failed while still pending — once a payment is
 *     success (or already failed) a late failed event is ignored.
 */
export function decideWebhookAction(event: string | undefined, status: PaymentStatus): WebhookAction {
  if (status === "refunded") return { kind: "ignore", reason: "already_refunded" };

  if (event === "payment.captured" || event === "payment.authorized") {
    return { kind: "verify" };
  }

  if (event === "payment.failed") {
    return status === "pending" ? { kind: "mark_failed" } : { kind: "ignore", reason: "terminal" };
  }

  return { kind: "ignore", reason: "unhandled_event" };
}

// ─── Gateway reconciliation ───────────────────────────────────────
export type GatewayPayment = { id: string; status: string };

/**
 * From the payments Razorpay has on an order, pick the one that means "money
 * is ours" — captured first, then authorized. Returns null when nothing on the
 * order is settled (still created/failed/refunded), so the reconciler knows not
 * to grant access. Used by the self-heal path when both the client /verify and
 * the webhook were lost.
 */
export function pickCapturablePayment(items: GatewayPayment[] | null | undefined): GatewayPayment | null {
  if (!items || items.length === 0) return null;
  return (
    items.find((p) => p.status === "captured") ??
    items.find((p) => p.status === "authorized") ??
    null
  );
}

/**
 * Whether a settled local payment status still grants course access. success is
 * the only "you're enrolled" state; refunded explicitly revokes it.
 */
export function grantsAccess(status: PaymentStatus): boolean {
  return status === "success";
}
