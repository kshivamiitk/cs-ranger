import express from "express";
import { createService, ok, fail, requireAuth, requireRole, withDb, isSupabaseConfigured, razorpay, isRazorpayConfigured, verifyWebhookSignature, publish, Topics, getPlatformSetting, writeAuditLog, buildAnnualStatementPdf, type StatementMonthRow } from "@cs-ranger/shared";
import { z } from "zod";
import { ACCOUNT_NUMBER, dispatchRazorpayPayout, settleMockPayout, runBulkPayout, runDueScheduledPayouts, readPayoutSchedule, minPayoutPaise } from "./bulk.js";
import { currentPayoutWindow, nextPayoutWindowOpensAt } from "./scheduler.js";

const { app, listen, log } = createService("payout-service");
const PORT = Number(process.env.PORT_PAYOUT || 4008);

// ─── KYC: register creator's bank/UPI for payouts ────────────────
const KycSchema = z.object({
  type: z.enum(["bank", "upi"]),
  accountHolderName: z.string().min(2),
  email: z.string().email(),
  contactNumber: z.string().min(10),
  // bank
  accountNumber: z.string().optional(),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
  // upi
  upiId: z.string().optional(),
}).refine((d) => d.type === "upi" ? !!d.upiId : (!!d.accountNumber && !!d.ifsc),
  { message: "Provide bank details or UPI ID" });

app.post("/kyc/:creatorId", requireAuth, async (req, res) => {
  if (req.user!.id !== req.params.creatorId && req.user!.role !== "admin") {
    return fail(res, 403, "Forbidden", "FORBIDDEN");
  }
  const parsed = KycSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;

  let contactId: string | undefined;
  let fundAccountId: string | undefined;

  if (isRazorpayConfigured()) {
    try {
      // 1. Create or fetch the Contact (a person we can pay)
      const contactResp = await fetch("https://api.razorpay.com/v1/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64"),
        },
        body: JSON.stringify({
          name: d.accountHolderName,
          email: d.email,
          contact: d.contactNumber,
          type: "vendor",
          reference_id: `creator_${req.params.creatorId}`,
        }),
      });
      const contact = await contactResp.json() as { id?: string; error?: { description?: string } };
      if (!contactResp.ok || !contact.id) {
        return fail(res, 502, contact.error?.description || "Contact creation failed", "GATEWAY_ERROR");
      }
      contactId = contact.id;

      // 2. Create the Fund Account (bank or UPI)
      const fundBody = d.type === "bank"
        ? { contact_id: contactId, account_type: "bank_account", bank_account: { name: d.accountHolderName, ifsc: d.ifsc, account_number: d.accountNumber } }
        : { contact_id: contactId, account_type: "vpa", vpa: { address: d.upiId } };
      const faResp = await fetch("https://api.razorpay.com/v1/fund_accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64"),
        },
        body: JSON.stringify(fundBody),
      });
      const fa = await faResp.json() as { id?: string; error?: { description?: string } };
      if (!faResp.ok || !fa.id) {
        return fail(res, 502, fa.error?.description || "Fund account creation failed", "GATEWAY_ERROR");
      }
      fundAccountId = fa.id;
    } catch (e) {
      log.error("kyc razorpay error", { err: e instanceof Error ? e.message : String(e) });
      return fail(res, 502, "KYC gateway error", "GATEWAY_ERROR");
    }
  } else {
    contactId = `cont_dev_${Date.now()}`;
    fundAccountId = `fa_dev_${Date.now()}`;
  }

  // 3. Persist KYC record. Full account_number / account_holder_name /
  // contact_number are stored so admins can run off-platform payouts while
  // bulk Razorpay payouts are unavailable (see /offplatform/queue below).
  await withDb(async (db) => {
    await db.from("kyc_details").upsert({
      creator_id: req.params.creatorId,
      razorpay_contact_id: contactId,
      razorpay_fund_account_id: fundAccountId,
      kyc_status: isRazorpayConfigured() ? "pending" : "approved",
      bank_name: d.type === "bank" ? "Bank Account" : null,
      account_number: d.accountNumber || null,
      account_number_last4: d.accountNumber?.slice(-4) || null,
      ifsc: d.ifsc || null,
      upi_id: d.upiId || null,
      account_holder_name: d.accountHolderName,
      contact_number: d.contactNumber,
      verified_at: isRazorpayConfigured() ? null : new Date().toISOString(),
    }, { onConflict: "creator_id" });
    return null;
  }, null);

  ok(res, { contactId, fundAccountId, kycStatus: isRazorpayConfigured() ? "pending" : "approved" });
});

app.get("/kyc/:creatorId", requireAuth, async (req, res) => {
  const row = await withDb(async (db) => {
    const { data } = await db.from("kyc_details").select("*").eq("creator_id", req.params.creatorId).maybeSingle();
    return data;
  }, null);
  if (!row) return fail(res, 404, "No KYC record", "NOT_FOUND");
  ok(res, row);
});

// ─── KYC webhook (account verification result) ───────────────────
app.post("/kyc/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.header("x-razorpay-signature");
  const rawBody = (req.body as Buffer).toString("utf8");
  if (isRazorpayConfigured() && !verifyWebhookSignature(rawBody, signature)) {
    return fail(res, 401, "Invalid signature", "INVALID_SIGNATURE");
  }
  const body = JSON.parse(rawBody) as { event?: string; payload?: { fund_account?: { entity: { id: string; active: boolean } } } };
  const fa = body.payload?.fund_account?.entity;
  if (!fa) return ok(res, { received: true });

  const status = fa.active ? "approved" : "failed";
  const result = await withDb(async (db) => {
    const { data } = await db.from("kyc_details").update({ kyc_status: status, verified_at: status === "approved" ? new Date().toISOString() : null })
      .eq("razorpay_fund_account_id", fa.id).select("creator_id").maybeSingle();
    return data;
  }, null);

  if (result) await publish(Topics.KYC_STATUS_CHANGED, { creatorId: result.creator_id, status });
  ok(res, { received: true });
});

// ─── Bulk payout (admin) ─────────────────────────────────────────
app.post("/bulk", requireRole("admin"), async (req, res) => {
  const outcome = await runBulkPayout({ initiatedBy: req.user!.id });
  if (outcome.status === "no_eligible") return fail(res, 400, "No eligible creators", "NO_ELIGIBLE");
  if (outcome.status === "window_already_processed") return fail(res, 409, "This payout window was already processed", "ALREADY_PROCESSED");
  const { runId, totalAmount, count, results } = outcome.run;

  await writeAuditLog({
    adminId: req.user!.id, action: "payout.bulk", targetType: "payout_run", targetId: String(runId),
    metadata: { totalAmount, creatorCount: count, failed: results.filter((r) => r.status === "failed").length },
  });
  ok(res, { runId, totalAmount, count, results });
});

// ─── Scheduled payout runner (admin) ─────────────────────────────
// The schedule itself lives in platform_settings.payout_schedule (manual /
// monthly_1st / monthly_1st_15th). A window is disbursed at most once — the
// payout_runs.scheduled_window unique index is the lock — so the admin button
// and the cron worker can both call run-due freely.
app.get("/scheduler/status", requireRole("admin"), async (_req, res) => {
  const schedule = await readPayoutSchedule();
  const now = new Date();
  const window = currentPayoutWindow(schedule, now);
  const lastScheduledRun = await withDb(async (db) => {
    const { data } = await db.from("payout_runs")
      .select("id, initiated_at, total_amount, creator_count, scheduled_window")
      .not("scheduled_window", "is", null)
      .order("initiated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }, null);
  const alreadyProcessed = window
    ? await withDb(async (db) => {
        const { data } = await db.from("payout_runs").select("id").eq("scheduled_window", window.key).limit(1).maybeSingle();
        return !!data;
      }, () => false)
    : false;
  ok(res, {
    schedule,
    mockMode: !isRazorpayConfigured() || !ACCOUNT_NUMBER,
    currentWindow: window ? { key: window.key, opensAt: window.opensAt.toISOString(), alreadyProcessed } : null,
    nextWindowOpensAt: nextPayoutWindowOpensAt(schedule, now)?.toISOString() || null,
    lastScheduledRun,
  });
});

app.post("/scheduler/run-due", requireRole("admin"), async (req, res) => {
  const result = await runDueScheduledPayouts({ initiatedBy: req.user!.id });
  log.info("scheduled payout run-due", { status: result.status, ...("reason" in result ? { reason: result.reason } : {}), windowKey: "windowKey" in result ? result.windowKey : undefined });
  ok(res, result);
});

// ─── Manual single-creator payout (admin) ────────────────────────
const ManualPayoutSchema = z.object({
  creatorId: z.string().min(1),
  amountInr: z.number().positive("Amount must be greater than zero").max(10_000_000),
  reason: z.string().min(10, "Reason must be at least 10 characters").max(500),
  // Allows paying out more than the tracked pending balance (e.g. dispute resolution). Audited.
  override: z.boolean().optional(),
});

app.post("/manual", requireRole("admin"), async (req, res) => {
  const parsed = ManualPayoutSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { creatorId, amountInr, reason, override } = parsed.data;
  const amountPaise = Math.round(amountInr * 100);

  const creator = await withDb(async (db) => {
    const [{ data: balance }, { data: kyc }] = await Promise.all([
      db.from("creator_balances").select("pending").eq("creator_id", creatorId).maybeSingle(),
      db.from("kyc_details").select("razorpay_fund_account_id, kyc_status").eq("creator_id", creatorId).maybeSingle(),
    ]);
    return { pending: balance?.pending || 0, kyc };
  }, { pending: 0, kyc: null as { razorpay_fund_account_id: string; kyc_status: string } | null });

  if (creator.pending < amountPaise && !override) {
    return fail(res, 400, `Creator's pending balance is ₹${(creator.pending / 100).toFixed(2)} — pass override to pay out more`, "INSUFFICIENT_BALANCE", { pending: creator.pending });
  }
  if (isRazorpayConfigured() && ACCOUNT_NUMBER && (!creator.kyc || creator.kyc.kyc_status !== "approved" || !creator.kyc.razorpay_fund_account_id)) {
    return fail(res, 400, "Creator does not have an approved KYC fund account", "KYC_REQUIRED");
  }

  const runId = await withDb(async (db) => {
    const { data, error } = await db.from("payout_runs").insert({
      initiated_by: req.user!.id, total_amount: amountPaise, creator_count: 1, notes: `manual: ${reason}`,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }, () => `run_dev_manual_${Date.now()}`);

  let payoutId: string | undefined;
  let status: "processing" | "failed" = "processing";
  let errorMsg: string | undefined;
  if (isRazorpayConfigured() && ACCOUNT_NUMBER) {
    const dispatched = await dispatchRazorpayPayout({
      fundAccountId: creator.kyc!.razorpay_fund_account_id,
      amountPaise,
      idempotencyKey: `manual-${runId}-${creatorId}`,
      referenceId: `run_${runId}_${creatorId}`,
      narration: "CS-Ranger manual payout",
    });
    if (dispatched.error) { status = "failed"; errorMsg = dispatched.error; }
    else payoutId = dispatched.payoutId;
  } else {
    // Safe mocked branch — no RazorpayX locally, settle instantly so balances stay coherent.
    payoutId = `pout_dev_manual_${creatorId}_${Date.now()}`;
  }

  const itemId = await withDb(async (db) => {
    const { data, error } = await db.from("payout_items").insert({
      run_id: runId, creator_id: creatorId, amount: amountPaise, status, razorpay_payout_id: payoutId, failure_reason: errorMsg,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }, () => `item_dev_${Date.now()}`);
  if (!isRazorpayConfigured() && status === "processing") await settleMockPayout(creatorId, amountPaise, payoutId || runId);

  await writeAuditLog({
    adminId: req.user!.id, action: "payout.manual", targetType: "payout_item", targetId: String(itemId),
    metadata: { creatorId, amount: amountPaise, reason, override: !!override, runId, payoutId, status, error: errorMsg },
  });

  if (status === "failed") return fail(res, 502, errorMsg || "Payout dispatch failed", "GATEWAY_ERROR", { runId, payoutItemId: itemId });
  ok(res, { runId, payoutItemId: itemId, payoutId, amount: amountPaise, status });
});

// ─── Off-platform payouts (admin) ─────────────────────────────────
// Interim flow while bulk Razorpay payouts are unavailable. Admin pays the
// creator via their own bank / UPI app, then records the disbursement here.
// The wallet_ledger row triggers the same balance update as a webhook-confirmed
// Razorpay payout — pending drops, total_paid_out grows.

app.get("/offplatform/queue", requireRole("admin"), async (_req, res) => {
  const minPayout = await minPayoutPaise();
  const rows = await withDb(async (db) => {
    const { data } = await db.from("creator_balances")
      .select("creator_id, pending, kyc_details(kyc_status, bank_name, account_holder_name, account_number, account_number_last4, ifsc, upi_id, contact_number)")
      .gte("pending", minPayout)
      .order("pending", { ascending: false });
    return (data as unknown as Array<{
      creator_id: string;
      pending: number;
      kyc_details: { kyc_status: string; bank_name: string | null; account_holder_name: string | null; account_number: string | null; account_number_last4: string | null; ifsc: string | null; upi_id: string | null; contact_number: string | null } | null;
    }>) || [];
  }, () => []);

  // Fetch users + profile display names in a single batched query.
  const ids = rows.map((r) => r.creator_id);
  const users = ids.length === 0 ? [] : await withDb(async (db) => {
    const { data } = await db.from("users").select("id, email, profiles(display_name, username)").in("id", ids);
    return (data as unknown as Array<{ id: string; email: string; profiles: { display_name: string | null; username: string | null } | null }>) || [];
  }, () => []);
  const userById = new Map(users.map((u) => [u.id, u]));

  const items = rows.map((r) => {
    const u = userById.get(r.creator_id);
    const kyc = r.kyc_details;
    const method: "bank" | "upi" | null = kyc?.upi_id ? "upi" : (kyc?.account_number || kyc?.account_number_last4) ? "bank" : null;
    return {
      creator_id: r.creator_id,
      pending: r.pending,
      name: u?.profiles?.display_name || u?.profiles?.username || null,
      email: u?.email || null,
      contact_number: kyc?.contact_number || null,
      kyc_status: kyc?.kyc_status || "missing",
      method,
      account_holder_name: kyc?.account_holder_name || null,
      account_number: kyc?.account_number || null,
      account_number_last4: kyc?.account_number_last4 || null,
      ifsc: kyc?.ifsc || null,
      upi_id: kyc?.upi_id || null,
      bank_name: kyc?.bank_name || null,
    };
  });
  ok(res, items);
});

const OffplatformMarkPaidSchema = z.object({
  creatorId: z.string().uuid(),
  amountInr: z.number().positive(),
  method: z.enum(["bank", "upi", "other"]),
  txnReference: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

app.post("/offplatform/mark-paid", requireRole("admin"), async (req, res) => {
  const parsed = OffplatformMarkPaidSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { creatorId, amountInr, method, txnReference, note } = parsed.data;
  const amountPaise = Math.round(amountInr * 100);

  const balance = await withDb(async (db) => {
    const { data } = await db.from("creator_balances").select("pending").eq("creator_id", creatorId).maybeSingle();
    return data;
  }, null);
  if (!balance) return fail(res, 404, "Creator not found", "NOT_FOUND");
  if (balance.pending < amountPaise) {
    return fail(res, 400, `Amount exceeds pending balance (₹${(balance.pending / 100).toFixed(2)}).`, "INSUFFICIENT_BALANCE", { pending: balance.pending });
  }

  // The wallet_ledger row is the source of truth; manual_payouts is descriptive.
  // Insert the ledger row first so the balance trigger fires, then write the
  // audit row pointing back at it.
  const referenceId = `manual-offplatform-${Date.now()}-${creatorId.slice(0, 8)}`;
  const ledgerId = await withDb(async (db) => {
    const { data, error } = await db.from("wallet_ledger").insert({
      creator_id: creatorId,
      type: "payout_debit",
      amount: -amountPaise,
      reference_id: referenceId,
      notes: note ? `off-platform: ${note}` : "off-platform manual payout",
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }, () => `ledger_dev_${Date.now()}`);

  const recordId = await withDb(async (db) => {
    const { data, error } = await db.from("manual_payouts").insert({
      creator_id: creatorId,
      amount: amountPaise,
      method,
      txn_reference: txnReference || null,
      note: note || null,
      marked_paid_by: req.user!.id,
      ledger_id: ledgerId,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }, () => `manual_dev_${Date.now()}`);

  await writeAuditLog({
    adminId: req.user!.id,
    action: "payout.offplatform_mark_paid",
    targetType: "manual_payout",
    targetId: String(recordId),
    metadata: { creatorId, amount: amountPaise, method, txnReference, note, ledgerId, referenceId },
  });

  await publish(Topics.PAYOUT_COMPLETED, { creatorId, payoutId: referenceId, amount: amountPaise });

  ok(res, { recordId, ledgerId, referenceId, amount: amountPaise });
});

// ─── Failed payouts (admin) ──────────────────────────────────────
app.get("/failed", requireRole("admin"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 50)));
  const result = await withDb(async (db) => {
    const { data, count, error } = await db.from("payout_items")
      .select("*, creator:users!payout_items_creator_id_fkey(email, profiles(display_name, username, avatar_url)), payout_runs(initiated_at, notes)", { count: "exact" })
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return { items: data || [], total: count || 0 };
  }, { items: [], total: 0 });
  ok(res, result.items, { page, pageSize, total: result.total });
});

// ─── Payout webhook ──────────────────────────────────────────────
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.header("x-razorpay-signature");
  const rawBody = (req.body as Buffer).toString("utf8");
  if (isRazorpayConfigured() && !verifyWebhookSignature(rawBody, signature)) {
    return fail(res, 401, "Invalid signature", "INVALID_SIGNATURE");
  }
  const body = JSON.parse(rawBody) as { event?: string; payload?: { payout?: { entity: { id: string; status: string; failure_reason?: string } } } };
  const p = body.payload?.payout?.entity;
  if (!p) return ok(res, { received: true });

  const newStatus = p.status === "processed" ? "processed" : p.status === "failed" || p.status === "rejected" || p.status === "reversed" ? "failed" : "processing";

  const item = await withDb(async (db) => {
    const { data } = await db.from("payout_items").update({
      status: newStatus, settled_at: newStatus === "processed" ? new Date().toISOString() : null, failure_reason: p.failure_reason,
    }).eq("razorpay_payout_id", p.id).select("creator_id, amount").maybeSingle();
    return data;
  }, null);

  if (item) {
    if (newStatus === "processed") {
      // Debit the creator's pending balance via the ledger trigger
      await withDb(async (db) => {
        await db.from("wallet_ledger").insert({ creator_id: item.creator_id, type: "payout_debit", amount: -item.amount, reference_id: p.id });
        return null;
      }, null);
      await publish(Topics.PAYOUT_COMPLETED, { creatorId: item.creator_id, payoutId: p.id, amount: item.amount });
    } else if (newStatus === "failed") {
      await publish(Topics.PAYOUT_FAILED, { creatorId: item.creator_id, payoutId: p.id, reason: p.failure_reason });
    }
  }
  ok(res, { received: true });
});

// ─── Reads ────────────────────────────────────────────────────────
app.get("/", requireAuth, async (req, res) => {
  const creatorId = (req.query.creatorId as string | undefined) || req.user!.id;
  const list = await withDb(async (db) => {
    const { data } = await db.from("payout_items").select("*").eq("creator_id", creatorId).order("created_at", { ascending: false });
    return data || [];
  }, () => []);
  ok(res, list);
});

app.get("/runs", requireRole("admin"), async (_req, res) => {
  const runs = await withDb(async (db) => {
    const { data } = await db.from("payout_runs").select("*, payout_items(*)").order("initiated_at", { ascending: false });
    return data || [];
  }, () => []);
  ok(res, runs);
});

app.post("/:payoutItemId/retry", requireRole("admin"), async (req, res) => {
  const item = await withDb(async (db) => {
    const { data } = await db.from("payout_items").select("*").eq("id", req.params.payoutItemId).maybeSingle();
    return data;
  }, null);
  if (!item) return fail(res, 404, "Payout item not found", "NOT_FOUND");
  if (item.status !== "failed") return fail(res, 400, "Only failed payouts can be retried", "INVALID_STATE");

  const attempt = (item.retry_count || 0) + 1;
  let payoutId: string | undefined;
  let status: "processing" | "failed" = "processing";
  let errorMsg: string | undefined;

  if (isRazorpayConfigured() && ACCOUNT_NUMBER) {
    const kyc = await withDb(async (db) => {
      const { data } = await db.from("kyc_details").select("razorpay_fund_account_id, kyc_status").eq("creator_id", item.creator_id).maybeSingle();
      return data;
    }, null);
    if (!kyc?.razorpay_fund_account_id || kyc.kyc_status !== "approved") {
      return fail(res, 400, "Creator does not have an approved KYC fund account", "KYC_REQUIRED");
    }
    // A fresh idempotency key per attempt — the original key would make Razorpay
    // replay the failed payout instead of creating a new one.
    const dispatched = await dispatchRazorpayPayout({
      fundAccountId: kyc.razorpay_fund_account_id,
      amountPaise: item.amount,
      idempotencyKey: `retry-${item.id}-${attempt}`,
      referenceId: `retry_${item.id}_${attempt}`,
      narration: "CS-Ranger payout retry",
    });
    if (dispatched.error) { status = "failed"; errorMsg = dispatched.error; }
    else payoutId = dispatched.payoutId;
  } else {
    payoutId = `pout_dev_retry_${item.id}_${Date.now()}`;
  }

  await withDb(async (db) => {
    await db.from("payout_items").update({
      retry_count: attempt, status, razorpay_payout_id: payoutId || item.razorpay_payout_id, failure_reason: errorMsg || null,
    }).eq("id", item.id);
    return null;
  }, null);
  if (!isRazorpayConfigured() && status === "processing") await settleMockPayout(item.creator_id, item.amount, payoutId || String(item.id));

  await writeAuditLog({
    adminId: req.user!.id, action: "payout.retry", targetType: "payout_item", targetId: String(item.id),
    metadata: { creatorId: item.creator_id, amount: item.amount, attempt, payoutId, status, error: errorMsg },
  });

  if (status === "failed") return fail(res, 502, errorMsg || "Payout dispatch failed", "GATEWAY_ERROR");
  ok(res, { retried: true, status, payoutId });
});

// ─── Creator annual statement (TDS / financial year summary) ──────
// Built from the wallet ledger + payout items + tds_records. Only the creator
// themselves (or an admin) can read it.

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

function currentFinancialYear(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function fyRange(fy: string): { from: string; to: string; label: string; startYear: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!m) return null;
  const startYear = Number(m[1]);
  if (startYear < 2000 || startYear > 2100) return null;
  return {
    from: new Date(Date.UTC(startYear, 3, 1)).toISOString(),
    to: new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59, 999)).toISOString(),
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    startYear,
  };
}

interface AnnualStatement {
  financialYear: string;
  grossPaise: number; commissionPaise: number; refundsPaise: number; tdsPaise: number;
  netPaise: number; payoutsPaise: number; pendingPaise: number;
  months: StatementMonthRow[];
  generatedAt: string;
  isEstimate: boolean;
}

async function computeAnnualStatement(creatorId: string, fy: string): Promise<AnnualStatement | null> {
  const range = fyRange(fy);
  if (!range) return null;
  const empty: AnnualStatement = {
    financialYear: range.label, grossPaise: 0, commissionPaise: 0, refundsPaise: 0, tdsPaise: 0,
    netPaise: 0, payoutsPaise: 0, pendingPaise: 0,
    months: FY_MONTHS.map((m, i) => ({ month: `${m} ${i < 9 ? range.startYear : range.startYear + 1}`, grossPaise: 0, commissionPaise: 0, refundsPaise: 0, tdsPaise: 0, netPaise: 0 })),
    generatedAt: new Date().toISOString(), isEstimate: !isSupabaseConfigured(),
  };
  return withDb<AnnualStatement>(async (db) => {
    const [{ data: ledger }, { data: balance }, { data: tdsRecord }] = await Promise.all([
      db.from("wallet_ledger").select("type, amount, created_at").eq("creator_id", creatorId).gte("created_at", range.from).lte("created_at", range.to),
      db.from("creator_balances").select("pending").eq("creator_id", creatorId).maybeSingle(),
      db.from("tds_records").select("tds_withheld").eq("creator_id", creatorId).eq("financial_year", range.label).maybeSingle(),
    ]);

    const months = empty.months.map((m) => ({ ...m }));
    let gross = 0, commission = 0, refunds = 0, tds = 0, payouts = 0;
    for (const row of ledger || []) {
      const amount = row.amount || 0;
      const created = new Date(row.created_at);
      const fyMonthIndex = (created.getUTCMonth() + 12 - 3) % 12;       // Apr → 0, Mar → 11
      const bucket = months[fyMonthIndex];
      if (row.type === "enrollment_credit") { gross += amount; bucket.grossPaise += amount; }
      else if (row.type === "commission_debit") { commission += -amount; bucket.commissionPaise += -amount; }
      else if (row.type === "refund_debit") { refunds += -amount; bucket.refundsPaise += -amount; }
      else if (row.type === "tds_debit") { tds += -amount; bucket.tdsPaise += -amount; }
      else if (row.type === "payout_debit") { payouts += -amount; }
    }
    if (tds === 0 && tdsRecord?.tds_withheld) tds = tdsRecord.tds_withheld;
    for (const m of months) m.netPaise = m.grossPaise - m.commissionPaise - m.refundsPaise - m.tdsPaise;

    return {
      financialYear: range.label,
      grossPaise: gross, commissionPaise: commission, refundsPaise: refunds, tdsPaise: tds,
      netPaise: gross - commission - refunds - tds,
      payoutsPaise: payouts,
      pendingPaise: balance?.pending || 0,
      months,
      generatedAt: new Date().toISOString(),
      isEstimate: false,
    };
  }, empty);
}

function statementCsv(creatorName: string, s: AnnualStatement): string {
  const lines = [
    `Creator annual statement,${creatorName},FY ${s.financialYear}`,
    "",
    "Summary,Amount (INR)",
    `Gross revenue,${(s.grossPaise / 100).toFixed(2)}`,
    `Platform commission,${(s.commissionPaise / 100).toFixed(2)}`,
    `Refunds,${(s.refundsPaise / 100).toFixed(2)}`,
    `TDS deducted,${(s.tdsPaise / 100).toFixed(2)}`,
    `Net earnings,${(s.netPaise / 100).toFixed(2)}`,
    `Payouts made,${(s.payoutsPaise / 100).toFixed(2)}`,
    `Pending balance,${(s.pendingPaise / 100).toFixed(2)}`,
    "",
    "Month,Gross,Commission,Refunds,TDS,Net",
    ...s.months.map((m) => `${m.month},${(m.grossPaise / 100).toFixed(2)},${(m.commissionPaise / 100).toFixed(2)},${(m.refundsPaise / 100).toFixed(2)},${(m.tdsPaise / 100).toFixed(2)},${(m.netPaise / 100).toFixed(2)}`),
  ];
  return lines.join("\n");
}

function statementAccessCheck(req: express.Request): { creatorId: string } | { error: string } {
  const creatorId = String(req.query.creatorId || req.user!.id);
  if (creatorId !== req.user!.id && req.user!.role !== "admin") return { error: "You can only download your own statement" };
  return { creatorId };
}

app.get("/statements/annual", requireAuth, async (req, res) => {
  const access = statementAccessCheck(req);
  if ("error" in access) return fail(res, 403, access.error, "FORBIDDEN");
  const fy = String(req.query.fy || currentFinancialYear());
  const statement = await computeAnnualStatement(access.creatorId, fy);
  if (!statement) return fail(res, 400, "Invalid financial year — use the format 2025-26", "VALIDATION");
  ok(res, statement);
});

app.get("/statements/annual/download", requireAuth, async (req, res) => {
  const access = statementAccessCheck(req);
  if ("error" in access) return fail(res, 403, access.error, "FORBIDDEN");
  const fy = String(req.query.fy || currentFinancialYear());
  const format = req.query.format === "csv" ? "csv" : "pdf";
  const statement = await computeAnnualStatement(access.creatorId, fy);
  if (!statement) return fail(res, 400, "Invalid financial year — use the format 2025-26", "VALIDATION");

  const creator = await withDb(async (db) => {
    const [{ data: profile }, { data: user }] = await Promise.all([
      db.from("profiles").select("display_name").eq("user_id", access.creatorId).maybeSingle(),
      db.from("users").select("email").eq("id", access.creatorId).maybeSingle(),
    ]);
    return { name: profile?.display_name || "Creator", email: user?.email as string | undefined };
  }, { name: "Creator", email: undefined });

  try {
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="cs-ranger-statement-${statement.financialYear}.csv"`);
      return res.send(statementCsv(creator.name, statement));
    }
    const siteName = await getPlatformSetting("site_name", "CS-Ranger");
    const bytes = await buildAnnualStatementPdf({
      siteName: String(siteName),
      creatorName: creator.name,
      creatorEmail: creator.email,
      financialYear: statement.financialYear,
      grossPaise: statement.grossPaise,
      commissionPaise: statement.commissionPaise,
      refundsPaise: statement.refundsPaise,
      tdsPaise: statement.tdsPaise,
      netPaise: statement.netPaise,
      payoutsPaise: statement.payoutsPaise,
      pendingPaise: statement.pendingPaise,
      months: statement.months,
      generatedAt: statement.generatedAt,
      isEstimate: statement.isEstimate,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="cs-ranger-statement-${statement.financialYear}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    log.error("annual statement render failed", { err: e instanceof Error ? e.message : String(e) });
    fail(res, 500, "Could not render the statement", "PDF_FAILED");
  }
});

listen(PORT);
