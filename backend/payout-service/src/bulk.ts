import { withDb, isRazorpayConfigured, getPlatformSetting, writeAuditLog } from "@cs-ranger/shared";
import { currentPayoutWindow, PAYOUT_SCHEDULES, type PayoutSchedule } from "./scheduler.js";

export const ACCOUNT_NUMBER = process.env.RAZORPAY_ACCOUNT_NUMBER || ""; // platform's RazorpayX virtual account

/** Minimum pending balance (paise) before a creator is eligible for payout — DB-backed setting with env fallback. */
export async function minPayoutPaise(): Promise<number> {
  const inr = await getPlatformSetting("min_payout_inr", Number(process.env.PLATFORM_MIN_PAYOUT_INR || 500));
  return inr * 100;
}

/**
 * Dispatch a single RazorpayX payout. Shared by bulk, scheduled, manual and
 * retry flows so the request shape (and the idempotency header) stays
 * identical everywhere.
 */
export async function dispatchRazorpayPayout(d: { fundAccountId: string; amountPaise: number; idempotencyKey: string; referenceId: string; narration?: string }): Promise<{ payoutId?: string; error?: string }> {
  try {
    const resp = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Payout-Idempotency": d.idempotencyKey,
        Authorization: "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64"),
      },
      body: JSON.stringify({
        account_number: ACCOUNT_NUMBER,
        fund_account_id: d.fundAccountId,
        amount: d.amountPaise,
        currency: "INR",
        mode: "IMPS",
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: d.referenceId,
        narration: d.narration || "LearnRift creator payout",
      }),
    });
    const data = await resp.json() as { id?: string; error?: { description?: string } };
    if (!resp.ok || !data.id) return { error: data.error?.description || `HTTP ${resp.status}` };
    return { payoutId: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Dev/mock fallback: without RazorpayX, settle the payout immediately so the wallet ledger reflects it. */
export async function settleMockPayout(creatorId: string, amountPaise: number, referenceId: string) {
  await withDb(async (db) => {
    await db.from("wallet_ledger").insert({ creator_id: creatorId, type: "payout_debit", amount: -amountPaise, reference_id: referenceId });
    return null;
  }, null);
}

export interface BulkPayoutItemResult { creatorId: string; amount: number; status: string; payoutId?: string; error?: string }
export interface BulkPayoutRun { runId: string; totalAmount: number; count: number; results: BulkPayoutItemResult[] }
export type BulkPayoutOutcome =
  | { status: "completed"; run: BulkPayoutRun }
  | { status: "no_eligible" }
  | { status: "window_already_processed" };

type EligibleRow = { creator_id: string; pending: number; kyc_details: { razorpay_fund_account_id: string; kyc_status: string } };

/**
 * Pay every eligible creator (pending ≥ min payout, KYC approved). Used by the
 * admin bulk endpoint and the scheduled runner. When `scheduledWindow` is set,
 * the payout_runs.scheduled_window unique index acts as the idempotency lock:
 * the run row is claimed BEFORE any money moves, so a concurrent run for the
 * same window loses the insert and dispatches nothing.
 */
export async function runBulkPayout(opts: { initiatedBy: string | null; notes?: string; scheduledWindow?: string }): Promise<BulkPayoutOutcome> {
  const minPayout = await minPayoutPaise();
  const eligible = await withDb(async (db) => {
    const { data } = await db.from("creator_balances").select("creator_id, pending, kyc_details!inner(razorpay_fund_account_id, kyc_status)").gte("pending", minPayout);
    return (data as unknown as EligibleRow[] | null)?.filter((r) => r.kyc_details.kyc_status === "approved") || [];
  }, () => [] as EligibleRow[]);

  if (eligible.length === 0) return { status: "no_eligible" };

  const totalAmount = eligible.reduce((s, e) => s + e.pending, 0);
  const claim = await withDb<{ id: string } | { duplicate: true }>(async (db) => {
    const { data, error } = await db.from("payout_runs").insert({
      initiated_by: opts.initiatedBy, total_amount: totalAmount, creator_count: eligible.length,
      notes: opts.notes ?? null, scheduled_window: opts.scheduledWindow ?? null,
    }).select("id").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") return { duplicate: true } as const;
      throw error;
    }
    return { id: String(data!.id) };
  }, () => ({ id: `run_dev_${Date.now()}` }));
  if ("duplicate" in claim) return { status: "window_already_processed" };
  const runId = claim.id;

  // Dispatch each via RazorpayX (or the mock branch when it isn't configured).
  const results: BulkPayoutItemResult[] = [];
  for (const e of eligible) {
    let payoutId: string | undefined;
    let status: "processing" | "failed" = "processing";
    let errorMsg: string | undefined;

    if (isRazorpayConfigured() && ACCOUNT_NUMBER) {
      const dispatched = await dispatchRazorpayPayout({
        fundAccountId: e.kyc_details.razorpay_fund_account_id,
        amountPaise: e.pending,
        idempotencyKey: `${runId}-${e.creator_id}`,
        referenceId: `run_${runId}_${e.creator_id}`,
      });
      if (dispatched.error) { status = "failed"; errorMsg = dispatched.error; }
      else payoutId = dispatched.payoutId;
    } else {
      payoutId = `pout_dev_${e.creator_id}_${Date.now()}`;
    }

    await withDb(async (db) => {
      await db.from("payout_items").insert({
        run_id: runId, creator_id: e.creator_id, amount: e.pending, status, razorpay_payout_id: payoutId, failure_reason: errorMsg,
      });
      return null;
    }, null);
    // In dev, immediately reflect as processed and reduce pending
    if (!isRazorpayConfigured()) await settleMockPayout(e.creator_id, e.pending, payoutId || runId);

    results.push({ creatorId: e.creator_id, amount: e.pending, status, payoutId, error: errorMsg });
  }

  return { status: "completed", run: { runId, totalAmount, count: eligible.length, results } };
}

export async function readPayoutSchedule(): Promise<PayoutSchedule> {
  const raw = String(await getPlatformSetting("payout_schedule", "manual"));
  return (PAYOUT_SCHEDULES as readonly string[]).includes(raw) ? (raw as PayoutSchedule) : "manual";
}

export type ScheduledRunResult =
  | { status: "skipped"; reason: "manual_schedule" | "already_processed" | "no_eligible"; schedule: PayoutSchedule; windowKey?: string }
  | { status: "completed"; schedule: PayoutSchedule; windowKey: string; run: BulkPayoutRun };

/**
 * Run the bulk payout for the current schedule window if it hasn't run yet.
 * Safe to call as often as you like (admin button, daily cron) — a window is
 * disbursed at most once. Used by POST /scheduler/run-due and the worker.
 */
export async function runDueScheduledPayouts(opts: { initiatedBy: string | null }): Promise<ScheduledRunResult> {
  const schedule = await readPayoutSchedule();
  if (schedule === "manual") return { status: "skipped", reason: "manual_schedule", schedule };
  const window = currentPayoutWindow(schedule)!;

  // Friendly pre-check; the unique index inside runBulkPayout is the real guarantee.
  const existing = await withDb(async (db) => {
    const { data } = await db.from("payout_runs").select("id").eq("scheduled_window", window.key).limit(1).maybeSingle();
    return data;
  }, null);
  if (existing) return { status: "skipped", reason: "already_processed", schedule, windowKey: window.key };

  const outcome = await runBulkPayout({
    initiatedBy: opts.initiatedBy,
    notes: `scheduled:${schedule}`,
    scheduledWindow: window.key,
  });
  if (outcome.status === "no_eligible") return { status: "skipped", reason: "no_eligible", schedule, windowKey: window.key };
  if (outcome.status === "window_already_processed") return { status: "skipped", reason: "already_processed", schedule, windowKey: window.key };

  // Worker runs have no admin behind them; the payout_runs row (scheduled_window,
  // initiated_by null) is their audit trail. Admin-triggered runs also land in
  // the immutable admin audit log.
  if (opts.initiatedBy) {
    await writeAuditLog({
      adminId: opts.initiatedBy, action: "payout.scheduled_run", targetType: "payout_run", targetId: String(outcome.run.runId),
      metadata: {
        schedule, windowKey: window.key, totalAmount: outcome.run.totalAmount, creatorCount: outcome.run.count,
        failed: outcome.run.results.filter((r) => r.status === "failed").length,
      },
    });
  }
  return { status: "completed", schedule, windowKey: window.key, run: outcome.run };
}
