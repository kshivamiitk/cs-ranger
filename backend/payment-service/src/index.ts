import { createService, ok, fail, mock, requireAuth, requireRole, withDb, supabaseAdmin, isSupabaseConfigured, razorpay, isRazorpayConfigured, verifyWebhookSignature, verifyPaymentSignature, publish, Topics, getPlatformSetting, writeAuditLog } from "@cs-ranger/shared";
import { z } from "zod";
import { chargeableAmountPaise, decideWebhookAction, pickCapturablePayment, type PaymentStatus } from "./logic.js";

const { app, listen, log } = createService("payment-service");
const PORT = Number(process.env.PORT_PAYMENT || 4006);

// Platform settings — admin-editable platform_settings rows with env fallback
// (cached ~30s in shared/settings), so commission/refund-window changes from
// /admin/settings apply to NEW payments without a redeploy. They feed into the
// SQL hardening functions so JS and RPC calculations stay consistent.
const commissionRate = () => getPlatformSetting("commission_rate", Number(process.env.PLATFORM_COMMISSION_RATE || 0.15));
const refundWindowDays = () => getPlatformSetting("refund_window_days", Number(process.env.PLATFORM_REFUND_WINDOW_DAYS || 7));

type VerifyRow = { transitioned: boolean; payment_id: string; course_id: string; learner_id: string; amount_paise: number };

// Run verify_payment WITHOUT collapsing a thrown error into a misleading
// fallback. withDb(fn, null) logs-and-returns-null on failure, which made
// /verify look like "payment not found" and /reconcile falsely report
// "enrolled" while NO enrollment was written — the classic "paid but no
// access". Here the failure stays explicit so callers return a truthful 502,
// and the Postgres code/details/hint are logged for diagnosis.
async function runVerifyPayment(
  orderId: string,
  paymentId: string,
  webhookEventId: string | null,
): Promise<{ ok: true; row: VerifyRow | null } | { ok: false }> {
  if (!isSupabaseConfigured()) return { ok: true, row: null };
  try {
    const { data, error } = await supabaseAdmin().rpc("verify_payment", {
      p_order_id: orderId,
      p_payment_id: paymentId,
      p_webhook_event_id: webhookEventId,
      p_commission_rate: await commissionRate(),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as VerifyRow | null;
    return { ok: true, row: row ?? null };
  } catch (err) {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    log.error("verify_payment failed — money captured but NOT finalized", {
      orderId, paymentId, err: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
    });
    return { ok: false };
  }
}

// Belt-and-suspenders access guarantee: once a payment is confirmed, the buyer
// MUST be able to open the course. verify_payment already inserts the enrollment
// inside its transaction, but if that row is ever missing this idempotent upsert
// restores access. The (learner_id, course_id) unique constraint makes it a
// no-op when already enrolled, so it can never double-enroll.
async function ensureEnrollment(learnerId: string, courseId: string): Promise<void> {
  await withDb(async (db) => {
    const { error } = await db.from("enrollments").upsert(
      { learner_id: learnerId, course_id: courseId, progress_percent: 0 },
      { onConflict: "learner_id,course_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return null;
  }, null);
}

// ─── Create Razorpay order ───────────────────────────────────────
const CreateOrder = z.object({ courseId: z.string() });
app.post("/create-order", requireAuth, async (req, res) => {
  const parsed = CreateOrder.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { courseId } = parsed.data;

  // 1. Load course and verify it's published and paid.
  // Cast to snake_case shape — Supabase JS returns DB column names, but the
  // shared Course type is camelCased, so direct field access fails type-check.
  type CourseRow = { id: string; status: string; price: number; discounted_price: number | null; title: string };
  const course = await withDb(async (db) => {
    const { data } = await db.from("courses").select("id, status, price, discounted_price, title").eq("id", courseId).maybeSingle();
    return data as CourseRow | null;
  }, () => mock.courses.find((c) => c.id === courseId) as unknown as CourseRow | undefined);
  if (!course) return fail(res, 404, "Course not found", "NOT_FOUND");
  if (course.status !== "published") return fail(res, 400, "Course not available", "UNAVAILABLE");
  if (!course.price || course.price === 0) return fail(res, 400, "Course is free — use enrollment endpoint", "FREE_COURSE");

  // 2a. Per-month model: a re-purchase EXTENDS access by another 30 days, so we
  // only block when the learner already has PERMANENT access (access_expires_at
  // IS NULL — a grandfathered or free enrollment), where paying again does nothing.
  const existing = await withDb(async (db) => {
    const { data } = await db.from("enrollments").select("id, access_expires_at").eq("learner_id", req.user!.id).eq("course_id", courseId).maybeSingle();
    return data as { id: string; access_expires_at: string | null } | null;
  }, null);
  if (existing && existing.access_expires_at === null) return fail(res, 409, "You already have lifetime access to this course", "ALREADY_ENROLLED");

  // Charge amount (paise). chargeableAmountPaise encodes the discount rules:
  // discounted_price applies only when positive AND strictly below price, so a
  // 0/NULL discount can't charge ₹0 through the paid path. Returns null for a
  // free course — already guarded above, but we re-check defensively.
  // Computed BEFORE the dedupe lookup so we can refuse to reuse a pending order
  // priced at a now-stale amount (creator changed the price after it was opened).
  const charge = chargeableAmountPaise(course);
  if (!charge) return fail(res, 400, "Course is free — use enrollment endpoint", "FREE_COURSE");
  const amountPaise = charge.amountPaise;

  // 2b. Dedupe pending orders. If the user clicked Buy multiple times we
  // already have a pending Razorpay order open for this (learner, course)
  // pair — reuse it. Otherwise the creator could end up double-credited
  // when two of those orders happened to both go through later (different
  // cards, retry-and-original both captured at Razorpay, etc).
  // Cutoff matches Razorpay's order TTL (~1 hour) so we don't hand back
  // an order Razorpay has already expired. The amount filter ensures a price
  // change invalidates the old order — we mint a fresh one at the new price
  // rather than charging the buyer the previous amount.
  const reusable = await withDb(async (db) => {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await db.from("razorpay_orders")
      .select("razorpay_order_id, amount, currency")
      .eq("learner_id", req.user!.id)
      .eq("course_id", courseId)
      .eq("status", "pending")
      .eq("amount", amountPaise)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }, null);
  if (reusable) {
    return ok(res, {
      orderId: (reusable as { razorpay_order_id: string }).razorpay_order_id,
      keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_dev",
      amount: (reusable as { amount: number }).amount,
      currency: (reusable as { currency?: string }).currency || "INR",
      courseTitle: course.title,
      reused: true,
    });
  }

  // 3. Create Razorpay order (or stub in dev). Retry a few times — most
  // "payment gateway 502"s are transient Razorpay API blips/timeouts, and a
  // single failure shouldn't cost a sale.
  let orderId = "";
  if (isRazorpayConfigured()) {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !orderId; attempt++) {
      try {
        const order = await razorpay().orders.create({
          amount: amountPaise,
          currency: "INR",
          receipt: `enr_${courseId}_${req.user!.id}_${Date.now()}`.slice(0, 40),
          notes: { learnerId: req.user!.id, courseId, courseTitle: course.title || "" },
        });
        orderId = order.id;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
    if (!orderId) {
      log.error("razorpay create order failed after 3 attempts", { err: lastErr instanceof Error ? lastErr.message : String(lastErr) });
      return fail(res, 502, "Payment gateway error", "GATEWAY_ERROR");
    }
  } else {
    orderId = `order_dev_${Date.now()}`;
  }

  // 4. Persist
  await withDb(async (db) => {
    await db.from("razorpay_orders").insert({
      learner_id: req.user!.id, course_id: courseId,
      razorpay_order_id: orderId, amount: amountPaise, status: "pending",
    });
    await db.from("payments").insert({
      learner_id: req.user!.id, course_id: courseId,
      razorpay_order_id: orderId, amount: amountPaise, status: "pending",
    });
    return null;
  }, null);

  ok(res, {
    orderId,
    keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_dev",
    amount: amountPaise,
    currency: "INR",
    courseTitle: course.title,
  });
});

// ─── Verify payment (client-side after Razorpay checkout success) ─
const VerifySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});
app.post("/verify", requireAuth, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  // Without a configured key we'd skip signature verification entirely — fine
  // in local dev (no real money flowing), unsafe in prod. Bail loudly if NODE_ENV
  // looks production-ish but Razorpay isn't configured.
  if (!isRazorpayConfigured() && process.env.NODE_ENV === "production") {
    return fail(res, 503, "Payment provider not configured", "GATEWAY_OFFLINE");
  }
  if (isRazorpayConfigured() && !verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return fail(res, 401, "Invalid signature", "INVALID_SIGNATURE");
  }

  // Fail-fast ownership: a user shouldn't be able to trigger ANY side effect
  // on a payment that isn't theirs, even if they somehow have a valid
  // signature triple. Look up the row first; if learner_id doesn't match,
  // return 403 BEFORE the verify_payment RPC mutates state.
  const preCheck = await withDb(async (db) => {
    const { data } = await db.from("payments")
      .select("learner_id")
      .eq("razorpay_order_id", razorpay_order_id)
      .maybeSingle();
    return data as { learner_id?: string } | null;
  }, null);
  if (!preCheck) return fail(res, 404, "Payment not found", "NOT_FOUND");
  if (preCheck.learner_id !== req.user!.id) return fail(res, 403, "Not your payment", "FORBIDDEN");

  // Atomic: status transition + enrollment insert + wallet ledger entries
  // happen in a single SQL function so partial failures roll back. Returns
  // transitioned=true exactly once per order — repeats and the webhook race
  // get transitioned=false and we skip the event publish to avoid double-credit.
  // runVerifyPayment surfaces a real RPC failure (instead of masking it as
  // "not found") so we never tell a paying user they're enrolled when they aren't.
  const verify = await runVerifyPayment(razorpay_order_id, razorpay_payment_id, null);
  if (!verify.ok) {
    return fail(res, 502, "We couldn't finalize your payment yet. Your money is safe — please refresh in a moment.", "FINALIZE_FAILED");
  }
  const result = verify.row;
  if (!result || !result.payment_id) return fail(res, 404, "Payment not found", "NOT_FOUND");

  // Guarantee access whenever the payment is confirmed (just transitioned OR
  // already success) — never leave a paid learner locked out.
  await ensureEnrollment(result.learner_id, result.course_id);

  if (result.transitioned) {
    await publish(Topics.PAYMENT_VERIFIED, {
      paymentId: result.payment_id, courseId: result.course_id, learnerId: result.learner_id, amount: result.amount_paise,
    });
  }

  ok(res, {
    verified: true,
    paymentId: result.payment_id,
    courseId: result.course_id,
    idempotent: !result.transitioned,
  });
});

// ─── Reconciliation / self-heal ──────────────────────────────────
// The "paid but no access" failure happens when BOTH the client /verify and
// the webhook are lost (verify timed out at the browser, webhook unreachable
// or its secret misconfigured). Razorpay still captured the money. This path
// treats the gateway as the source of truth: look up what Razorpay actually
// captured for the order and, if it's settled, run the same idempotent
// verify_payment the webhook would have. Safe to call any number of times.
type ReconcileOutcome =
  | { status: "success"; transitioned: boolean; courseId?: string }
  | { status: "refunded" }
  | { status: "pending"; reconciled: boolean; reason?: string }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "gateway_error" };

async function reconcileOrder(orderId: string, expectedLearnerId: string | null): Promise<ReconcileOutcome> {
  const payment = await withDb(async (db) => {
    const { data } = await db.from("payments")
      .select("id, learner_id, course_id, status, razorpay_payment_id")
      .eq("razorpay_order_id", orderId).maybeSingle();
    return data as { id: string; learner_id: string; course_id: string; status: PaymentStatus; razorpay_payment_id: string | null } | null;
  }, null);
  if (!payment) return { status: "not_found" };
  // Ownership — a learner may only reconcile their own order. The admin bulk
  // sweeper passes null to skip this.
  if (expectedLearnerId && payment.learner_id !== expectedLearnerId) return { status: "forbidden" };

  if (payment.status === "success") return { status: "success", transitioned: false, courseId: payment.course_id };
  if (payment.status === "refunded") return { status: "refunded" };

  // Without a configured gateway (local dev) there's nothing to reconcile against.
  if (!isRazorpayConfigured()) return { status: "pending", reconciled: false, reason: "gateway_offline" };

  let captured: { id: string; status: string } | null;
  try {
    const resp = await razorpay().orders.fetchPayments(orderId) as { items?: { id: string; status: string }[] };
    captured = pickCapturablePayment(resp?.items);
  } catch (e) {
    log.error("reconcile fetchPayments failed", { orderId, err: e instanceof Error ? e.message : String(e) });
    return { status: "gateway_error" };
  }
  if (!captured) return { status: "pending", reconciled: true, reason: "uncaptured" };

  // Captured at Razorpay but not settled locally → run the same atomic path the
  // webhook uses. verify_payment is idempotent; only publish on a real transition.
  const verify = await runVerifyPayment(orderId, captured!.id, null);
  if (!verify.ok) {
    // RPC failed (the Postgres cause is logged). Do NOT report success — that
    // was the bug that told paying users "enrolled" with no enrollment row.
    return { status: "gateway_error" };
  }
  const result = verify.row;
  // Money is ours and the payment is finalized — guarantee access.
  await ensureEnrollment(payment.learner_id, payment.course_id);
  if (result?.transitioned) {
    await publish(Topics.PAYMENT_VERIFIED, {
      paymentId: result.payment_id, courseId: result.course_id, learnerId: result.learner_id, amount: result.amount_paise,
    });
  }
  return { status: "success", transitioned: !!result?.transitioned, courseId: payment.course_id };
}

// Learner-triggered recovery. The checkout calls this when /verify fails after
// the money was already taken, and the course page can call it as a last resort
// before telling the user they aren't enrolled.
const ReconcileSchema = z.object({ orderId: z.string() });
app.post("/reconcile", requireAuth, async (req, res) => {
  const parsed = ReconcileSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  const outcome = await reconcileOrder(parsed.data.orderId, req.user!.id);
  switch (outcome.status) {
    case "not_found": return fail(res, 404, "Payment not found", "NOT_FOUND");
    case "forbidden": return fail(res, 403, "Not your payment", "FORBIDDEN");
    case "gateway_error": return fail(res, 502, "Payment gateway error", "GATEWAY_ERROR");
    case "success": return ok(res, { enrolled: true, status: "success", courseId: outcome.courseId, idempotent: !outcome.transitioned });
    case "refunded": return ok(res, { enrolled: false, status: "refunded" });
    case "pending": return ok(res, { enrolled: false, status: "pending", reconciled: outcome.reconciled, reason: outcome.reason });
  }
});

// Admin bulk recovery. Reconciles every still-pending order against Razorpay —
// the operational tool for sweeping up any payment that slipped through (and
// the way to rescue payments before expire_pending_orders flips them to failed).
app.post("/reconcile-pending", requireRole("admin"), async (req, res) => {
  const minutes = Math.max(0, Math.min(1440, Number((req.body as { minutesOld?: number })?.minutesOld ?? 0)));
  const orders = await withDb(async (db) => {
    let q = db.from("payments").select("razorpay_order_id").eq("status", "pending");
    if (minutes > 0) q = q.lt("created_at", new Date(Date.now() - minutes * 60_000).toISOString());
    const { data } = await q.limit(500);
    return (data || []) as { razorpay_order_id: string }[];
  }, () => []);

  let recovered = 0, stillPending = 0, errored = 0;
  for (const o of orders) {
    if (!o.razorpay_order_id) continue;
    const outcome = await reconcileOrder(o.razorpay_order_id, null);
    if (outcome.status === "success" && outcome.transitioned) recovered++;
    else if (outcome.status === "gateway_error") errored++;
    else if (outcome.status === "pending") stillPending++;
  }
  if (recovered > 0) {
    await writeAuditLog({
      adminId: req.user!.id, action: "payment.reconcile_pending", targetType: "payment", targetId: "bulk",
      metadata: { scanned: orders.length, recovered, stillPending, errored, minutesOld: minutes },
    });
  }
  ok(res, { scanned: orders.length, recovered, stillPending, errored });
});

// ─── Razorpay webhook (server-to-server confirmation) ────────────
// Razorpay HMAC-signs the raw bytes of the request body. The global
// express.json() middleware in createService captures those bytes via its
// `verify` callback and attaches them as req.rawBody — we use that for the
// signature check, then keep using req.body (already-parsed JSON) for everything
// else.
app.post("/webhook", async (req, res) => {
  const signature = req.header("x-razorpay-signature");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody?.toString("utf8");
  if (!rawBody) return fail(res, 400, "Empty body", "VALIDATION");

  if (isRazorpayConfigured() && !verifyWebhookSignature(rawBody, signature)) {
    return fail(res, 401, "Invalid signature", "INVALID_SIGNATURE");
  }

  let body: { event?: string; payload?: Record<string, { entity: Record<string, unknown> }>; id?: string };
  try { body = JSON.parse(rawBody); } catch { return fail(res, 400, "Invalid body", "VALIDATION"); }

  const event = body.event;
  const eventId = body.id;
  const payment = body.payload?.payment?.entity as { id?: string; order_id?: string; status?: string; amount?: number } | undefined;

  if (!payment?.order_id) return fail(res, 400, "Missing order_id", "VALIDATION");

  // Idempotency: ignore replays via webhook_event_id unique index
  if (eventId) {
    const dup = await withDb(async (db) => {
      const { data } = await db.from("payments").select("id").eq("webhook_event_id", eventId).maybeSingle();
      return data;
    }, null);
    if (dup) { return ok(res, { received: true, idempotent: true }); }
  }

  // First, make sure we even know about this order — webhooks for unrelated
  // accounts or stale orders should be logged and acknowledged, not 500ed.
  const orderRow = await withDb(async (db) => {
    const { data } = await db.from("payments").select("id, course_id, learner_id, status").eq("razorpay_order_id", payment.order_id).maybeSingle();
    return data;
  }, null);
  if (!orderRow) {
    log.warn("webhook for unknown order_id", { order_id: payment.order_id, event });
    return ok(res, { received: true, unknown: true });
  }

  // Decide from event + current local status. Pure decision (logic.ts) so the
  // "never walk a payment backwards" and "captured == authorized == money is
  // ours" rules are unit-tested. refunded/terminal states resolve to ignore.
  const status = (orderRow as { status: PaymentStatus }).status;
  const action = decideWebhookAction(event, status);

  if (action.kind === "verify") {
    const verify = await runVerifyPayment(payment.order_id, payment.id!, eventId ?? null);
    if (!verify.ok) {
      // Return non-2xx so Razorpay retries the webhook (a transient failure may
      // clear); the cause is logged and /reconcile is the other safety net.
      return fail(res, 502, "Could not finalize payment", "FINALIZE_FAILED");
    }
    const result = verify.row;
    if (result?.payment_id) await ensureEnrollment(result.learner_id, result.course_id);
    if (result?.transitioned) {
      await publish(Topics.PAYMENT_VERIFIED, {
        paymentId: result.payment_id, courseId: result.course_id, learnerId: result.learner_id, amount: result.amount_paise,
      });
    }
  } else if (action.kind === "mark_failed") {
    // .eq("status", "pending") so an out-of-order webhook can't flip a
    // captured payment back to failed. Pre-existing terminal state is sticky.
    const result = await withDb(async (db) => {
      const { data } = await db.from("payments").update({
        status: "failed",
        failure_reason: (payment as { error_description?: string }).error_description ?? "unknown",
        webhook_event_id: eventId,
      }).eq("razorpay_order_id", payment.order_id).eq("status", "pending").select("id").maybeSingle();
      return data;
    }, null);
    if (result) {
      // Only notify on a real transition, not on a no-op replay.
      await withDb(async (db) => {
        await db.from("notifications").insert({
          user_id: (orderRow as { learner_id: string }).learner_id,
          type: "payment_failed",
          title: "Payment failed",
          body: (payment as { error_description?: string }).error_description ?? "Your card was declined. Try again.",
          href: "/transactions",
        });
        return null;
      }, null);
    }
  } else if (action.reason === "already_refunded") {
    log.warn("ignoring webhook for refunded order", { order_id: payment.order_id, event });
    return ok(res, { received: true, ignored: "already_refunded" });
  }

  ok(res, { received: true });
});

// ─── Refund initiation (admin only) ──────────────────────────────
// Atomic RPC handles the status flip, wallet debit, enrollment removal
// and audit row — all in one transaction. We hit Razorpay BEFORE the RPC
// so a gateway failure leaves our DB state untouched (no "refunded in our
// system but not at Razorpay" drift).
app.post("/:id/refund", requireRole("admin"), async (req, res) => {
  const paymentId = req.params.id;

  // Pre-flight read so we can attempt the gateway refund first.
  const payment = await withDb(async (db) => {
    const { data } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
    return data;
  }, null);
  if (!payment) return fail(res, 404, "Payment not found", "NOT_FOUND");
  if (payment.status !== "success") return fail(res, 400, "Payment not refundable", "INVALID_STATE");
  // Refund window is enforced inside refund_payment() RPC — single source of
  // truth so the two layers never drift. (Was previously checked here too.)

  if (isRazorpayConfigured() && payment.razorpay_payment_id) {
    try {
      await razorpay().payments.refund(payment.razorpay_payment_id, { amount: payment.amount, speed: "normal" });
    } catch (e) {
      log.error("razorpay refund failed", { err: e instanceof Error ? e.message : String(e) });
      return fail(res, 502, "Refund failed at gateway", "GATEWAY_ERROR");
    }
  }

  const result = await withDb(async (db) => {
    const { data, error } = await db.rpc("refund_payment", {
      p_payment_id: paymentId,
      p_admin_id: req.user!.id,
      p_window_days: await refundWindowDays(),
      p_commission_rate: await commissionRate(),
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }, null);
  if (!result) return fail(res, 500, "Refund commit failed", "INTERNAL");
  if (!result.ok) return fail(res, 400, result.reason || "Refund failed", "REFUND_FAILED");

  await publish(Topics.PAYMENT_REFUNDED, {
    paymentId, courseId: payment.course_id, learnerId: payment.learner_id, amount: payment.amount,
  });
  // Notify the learner so they know access was revoked.
  await withDb(async (db) => {
    await db.from("notifications").insert({
      user_id: payment.learner_id,
      type: "refund_processed",
      title: "Refund processed",
      body: `₹${(payment.amount / 100).toLocaleString("en-IN")} refunded. Course access has been revoked.`,
      href: "/transactions",
    });
    return null;
  }, null);
  await writeAuditLog({
    adminId: req.user!.id, action: "payment.refund", targetType: "payment", targetId: String(paymentId),
    metadata: { amount: payment.amount, courseId: payment.course_id, learnerId: payment.learner_id },
  });
  ok(res, { refunded: true });
});

// ─── History & details ────────────────────────────────────────────
app.get("/", requireAuth, async (req, res) => {
  // unknown[]: DB rows are snake_case, the dev mock is camelCase — the handler
  // just forwards whichever list it gets.
  const list = await withDb<unknown[]>(async (db) => {
    const { data } = await db.from("payments")
      .select("id, course_id, amount, status, razorpay_payment_id, razorpay_order_id, created_at")
      .eq("learner_id", req.user!.id)
      .order("created_at", { ascending: false });
    return data || [];
  }, () => mock.payments.filter((p) => p.learnerId === req.user!.id));
  ok(res, list);
});

// Unified transactions feed for the current user — courses they've bought,
// storage they've purchased, and any future spending kinds added to the
// user_transactions SQL view. One query, all kinds, ordered newest first.
// Optional ?kind=course|storage filter for the dashboard tabs.
app.get("/transactions", requireAuth, async (req, res) => {
  const kind = String(req.query.kind || "");
  const list = await withDb(async (db) => {
    let q = db.from("user_transactions")
      .select("id, kind, amount_paise, currency, status, description, reference_id, razorpay_order_id, razorpay_payment_id, created_at")
      .eq("user_id", req.user!.id);
    if (kind === "course" || kind === "storage") q = q.eq("kind", kind);
    const { data } = await q.order("created_at", { ascending: false }).limit(200);
    return data || [];
  }, () => []);
  ok(res, list);
});

app.get("/:id", requireAuth, async (req, res) => {
  const p = await withDb(async (db) => {
    const { data } = await db.from("payments").select("*").eq("id", req.params.id).maybeSingle();
    return data;
  }, () => mock.payments.find((x) => x.id === req.params.id));
  if (!p) return fail(res, 404, "Payment not found", "NOT_FOUND");
  // Ownership: a payment row is private to the buyer (and platform admins).
  // Without this check anyone with a payment id could read someone else's row.
  if ((p as { learner_id?: string }).learner_id !== req.user!.id && req.user!.role !== "admin") {
    return fail(res, 403, "Not your payment", "FORBIDDEN");
  }
  ok(res, p);
});

listen(PORT);
