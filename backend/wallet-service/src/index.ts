import { createService, ok, fail, paginate, mock, requireAuth, requireRole, withDb, getPlatformSetting } from "@cs-ranger/shared";

const { app, listen, log } = createService("wallet-service");
const PORT = Number(process.env.PORT_WALLET || 4007);

// PAYMENT_VERIFIED / PAYMENT_REFUNDED ledger writes USED to live here as
// event consumers. They now happen inside the atomic SQL functions
// verify_payment() and refund_payment() (migration 0024) — the ledger row
// hits the DB in the same transaction as the payment status flip, so there
// is no longer any "paid but never credited" gap.
//
// Re-enabling these consumers would double-credit every payment the moment
// Redis came online (the RPC already wrote the row, the consumer would
// write it again). Deleted on purpose. log + COMMISSION_RATE stay for the
// payout flows defined below.
void log;

app.get("/:creatorId/balance", requireAuth, async (req, res) => {
  if (req.user!.id !== req.params.creatorId && req.user!.role !== "admin") return fail(res, 403, "Forbidden", "FORBIDDEN");
  const row = await withDb(async (db) => {
    const { data } = await db.from("creator_balances").select("*").eq("creator_id", req.params.creatorId).maybeSingle();
    return data;
  }, null);
  ok(res, row || { pending: 0, total_earned: 0, total_paid_out: 0, total_commission: 0 });
});

app.get("/:creatorId/ledger", requireAuth, async (req, res) => {
  if (req.user!.id !== req.params.creatorId && req.user!.role !== "admin") return fail(res, 403, "Forbidden", "FORBIDDEN");
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  type ListResult = { items: unknown[]; total: number } | { items: unknown[]; meta: { page: number; pageSize: number; total: number } };
  const result = await withDb<ListResult>(async (db) => {
    let q = db.from("wallet_ledger").select("*", { count: "exact" }).eq("creator_id", req.params.creatorId).order("created_at", { ascending: false });
    if (req.query.type) q = q.eq("type", req.query.type as string);
    q = q.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count } = await q;
    return { items: data || [], total: count || 0 };
  }, () => {
    const all = mock.ledger.filter((l) => l.creatorId === req.params.creatorId);
    return paginate(all, page, pageSize);
  });
  ok(res, result.items, { page, pageSize, total: "total" in result ? result.total : 0 });
});

app.get("/eligible-for-payout", requireRole("admin"), async (_req, res) => {
  // Threshold comes from platform_settings (admin-editable) with env fallback.
  const minPayout = (await getPlatformSetting("min_payout_inr", Number(process.env.PLATFORM_MIN_PAYOUT_INR || 500))) * 100;
  const list = await withDb(async (db) => {
    const { data } = await db.from("creator_balances").select("creator_id, pending, kyc_details(razorpay_fund_account_id, kyc_status, account_number_last4, ifsc, upi_id)").gte("pending", minPayout);
    return data || [];
  }, () => []);
  ok(res, list);
});

listen(PORT);
