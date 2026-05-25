# CS-Ranger — Creator Bulk Payouts: Complete Setup Guide

How money moves from a learner's checkout all the way into a creator's bank
account, every config knob you need to turn, and every checkpoint to verify it
end-to-end. Read this top-to-bottom the first time; later you'll only need the
**Production checklist** at the bottom.

---

## 1. The money flow at a glance

```
Learner pays                                        Razorpay collects
   │                                                       │
   ▼                                                       ▼
Razorpay Checkout ──► payment-service ──► payments table ─► wallet_ledger
                          │ (HMAC verify        │             rows:
                          │  + idempotency)     │           enrollment_credit
                          ▼                     │           commission_debit
                  enrollments row created       │           (atomic SQL fn
                                                ▼            verify_payment)
                                       creator_balances.pending  ▲
                                       updated by AFTER INSERT   │
                                       trigger on wallet_ledger──┘
                                                │
            ┌───────────────────────────────────┘
            │
            ▼
Admin opens /admin/payouts        OR     payout-service scheduler-worker (cron)
            │                                      │
            ▼                                      ▼
  POST /payouts/bulk            POST /payouts/scheduler/run-due
            │                                      │
            └──────────────► payout-service ───────┘
                                    │
                                    │ 1. SELECT creators where
                                    │    pending ≥ min_payout
                                    │    AND kyc_status = 'approved'
                                    │ 2. INSERT payout_runs (UNIQUE
                                    │    scheduled_window — idempotency lock)
                                    │ 3. for each creator:
                                    │      POST RazorpayX /v1/payouts
                                    │      header: X-Payout-Idempotency
                                    │      INSERT payout_items (status=processing)
                                    │
                                    ▼
                          Razorpay X → IMPS → creator's bank
                                    │
                                    ▼
                          POST /payouts/webhook (HMAC verified)
                                    │ status → 'processed'
                                    │ INSERT wallet_ledger (payout_debit, -amount)
                                    │ trigger → creator_balances.pending  decreases
                                    ▼
                              Creator now has the money.
                              UI shows it in /creator/finance.
```

Key invariants:
- **Money is paise-precise.** Every amount in DB columns and Razorpay API calls
  is in paise (₹1 = 100 paise). The UI converts at the edges only.
- **Pending balance is denormalised** in `creator_balances.pending`, maintained
  by an `AFTER INSERT` trigger on `wallet_ledger`. This is what the bulk-payout
  query reads. Never compute balances by summing the ledger in a request path.
- **Idempotency at every dispatch:** each payout call carries
  `X-Payout-Idempotency: <runId>-<creatorId>` (and the scheduled-window unique
  index prevents double-runs). Replaying a request is always safe.

---

## 2. Database schema (already in `database/migrations/`)

| Table | Purpose |
|---|---|
| `wallet_ledger` | Append-only journal. One row per money event (credit, commission, refund, TDS, payout_debit). `reference_id` ties it to the source payment/payout. |
| `creator_balances` | One row per creator: `pending`, `total_earned`, `total_paid_out`, `total_commission`. Maintained by `trg_ledger_to_balance`. |
| `kyc_details` | One row per creator. Holds `razorpay_contact_id`, `razorpay_fund_account_id`, `kyc_status` (`pending` / `approved` / `failed`), last4 / IFSC / UPI for display. |
| `payout_runs` | One row per bulk run. `scheduled_window` is the idempotency lock — unique index ensures one disbursement per window. |
| `payout_items` | One row per (run, creator). Carries `razorpay_payout_id`, `status` (`processing` / `processed` / `failed`), `failure_reason`, `retry_count`. |
| `tds_records` | TDS withheld per financial year, used for the annual statement. |
| `platform_settings` | Key/value JSON config — `commission_rate`, `min_payout_inr`, `payout_schedule`, etc. Editable from `/admin/settings`. |

Applying them:

```bash
# from project root
cd database && ./apply.sh "$DATABASE_URL"
```

The relevant files: `0005_money.sql` (core), `0009_triggers.sql` (balance
trigger), `0024_wallet_hardening.sql` (atomic `verify_payment` /
`refund_payment` RPCs), `0032_payout_scheduler.sql` (scheduled_window column +
unique index).

---

## 3. One-time setup — RazorpayX side

You need **RazorpayX**, not regular Razorpay Payments. Payments collects money,
X disburses it. Both live under the same dashboard account.

### 3.1 Activate RazorpayX

1. Sign in to https://dashboard.razorpay.com.
2. Side nav → **RazorpayX** → **Apply for account**.
3. Submit KYC docs for the *business* (PAN, GST, signatory ID, cancelled cheque
   or bank statement). Approval usually takes 1–3 working days.
4. Once approved you'll get a **virtual account number** (looks like a real
   bank A/C) and an IFSC (`RAZRB000001` or similar). Fund this account by
   transferring INR from your business current account; balance in this account
   is what Razorpay dispatches payouts from. **Always keep ≥ projected daily
   payout × 2 here, or set `queue_if_low_balance: true`** (already on — see
   `backend/payout-service/src/bulk.ts:33`).

Copy the virtual account number — it goes into `.env` as
`RAZORPAY_ACCOUNT_NUMBER`.

### 3.2 Generate API keys

1. Dashboard → **Settings → API Keys → Generate Key**. Pick **Test Mode** first
   to wire everything up, then regenerate for **Live Mode** when ready.
2. You'll see `Key Id` (starts with `rzp_test_…` or `rzp_live_…`) and the
   `Key Secret` (shown ONCE — copy to a password manager).

### 3.3 Configure webhooks

You need two distinct webhook endpoints — both pointed at your public URL of
the payout-service (typically via `api-gateway` → `/api/payouts/...`).

| Event | URL (gateway path) | What our code does |
|---|---|---|
| `fund_account.validation.completed` | `https://YOUR_DOMAIN/api/payouts/kyc/webhook` | Flips `kyc_details.kyc_status` to `approved` / `failed`. |
| `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected` | `https://YOUR_DOMAIN/api/payouts/webhook` | Updates `payout_items.status` and, on success, writes the `payout_debit` ledger row. |

Steps:
1. Dashboard → **Settings → Webhooks → Add New Webhook**.
2. Paste the URL, tick all events listed above, set a **secret** (a random
   32-byte hex string is good: `openssl rand -hex 32`). Copy the secret —
   you'll need it in `.env`.
3. Repeat for the second endpoint OR add both endpoints to the same webhook
   (Razorpay allows multiple URLs per webhook entry).

For local dev expose your gateway via `ngrok http 4000` and use the ngrok URL.

---

## 4. Environment variables

Edit **both** `.env` (repo root, sourced by `run.sh`) and `backend/.env`
(loaded by the backend processes). The values that matter for payouts:

```dotenv
# ─── Razorpay credentials ────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=<the random hex you set in section 3.3>
RAZORPAY_ACCOUNT_NUMBER=<your RazorpayX virtual account, no spaces>

# ─── Frontend (Razorpay checkout modal, not used for payouts but required for the platform to earn money) ──
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx

# ─── Payout policy (env fallbacks; runtime values live in platform_settings) ──
PLATFORM_COMMISSION_RATE=0.15        # 15% platform fee
PLATFORM_MIN_PAYOUT_INR=500          # creator needs ≥ ₹500 pending to be eligible
PLATFORM_TDS_RATE=0.10
PLATFORM_TDS_THRESHOLD_INR=50000

# ─── Redis (BullMQ + cache; needed for the catalog, fine to enable here) ──
REDIS_URL=redis://default:<password>@<host>:<port>

# ─── Service port (already set; only change if you re-map ports) ──
PORT_PAYOUT=4008
```

Sanity rules the code enforces:
- `isRazorpayConfigured()` returns true only when **both** `RAZORPAY_KEY_ID`
  and `RAZORPAY_KEY_SECRET` are set (`backend/shared/razorpay.ts`).
- `dispatchRazorpayPayout()` needs `RAZORPAY_ACCOUNT_NUMBER` too. If either is
  missing, the bulk run falls into the **mock branch** — it inserts a
  `payout_debit` immediately so balances stay coherent for dev, but no real
  money moves.

After editing env, restart the backend:
```bash
# from project root
bash run.sh
```

---

## 5. Platform settings (admin UI)

`/admin/settings` exposes editable runtime values that take precedence over the
env fallbacks. Three are relevant to payouts:

| Setting | Default | Effect |
|---|---|---|
| `commission_rate` | `0.15` | Platform's cut. Applied in `verify_payment()` SQL fn at the moment of enrollment — changing it does **not** rewrite history, only future credits. |
| `min_payout_inr` | `500` | Creators below this aren't selected for bulk runs. |
| `payout_schedule` | `manual` | `manual` (admin button only), `monthly_1st` (auto on the 1st UTC), or `monthly_1st_15th` (auto on 1st and 15th UTC). |

Editing here writes to `platform_settings`. The next bulk run picks up the new
value on its first DB read (`getPlatformSetting` is uncached on the write
path).

---

## 6. Creator side: how a creator gets KYC'd

The creator self-serves from `/creator/finance` (see
`frontend/src/app/creator/finance/page.tsx`).

1. The page shows their pending balance and a **"Set up payouts"** card if
   `kyc_details` is empty.
2. They pick **Bank account** or **UPI**, fill the form, submit.
3. Frontend `POST /api/payouts/kyc/<creatorId>` with shape (`KycSchema` in
   `payout-service/src/index.ts:11`):
   ```jsonc
   {
     "type": "bank" | "upi",
     "accountHolderName": "Ananya Sharma",
     "email": "creator@example.com",
     "contactNumber": "9876543210",
     // bank:
     "accountNumber": "0123456789012",
     "ifsc": "HDFC0000123",
     // upi:
     "upiId": "ananya@okhdfcbank"
   }
   ```
4. Backend does, **in order**:
   - `POST https://api.razorpay.com/v1/contacts` → returns `cont_xxx`.
   - `POST https://api.razorpay.com/v1/fund_accounts` (account_type `bank_account` or `vpa`) → returns `fa_xxx`.
   - `UPSERT kyc_details` with both IDs and `kyc_status = 'pending'`.
5. Razorpay runs a penny-drop / account-validation in the background. When
   it finishes it fires `fund_account.validation.completed` → our webhook
   updates `kyc_status` to `approved` or `failed` and publishes
   `KYC_STATUS_CHANGED` (sent to the creator as in-app + email via Resend).

A creator with `kyc_status != 'approved'` will be **filtered out** of every
bulk run (`bulk.ts:74`).

If `RAZORPAY_KEY_*` aren't set (dev mode), the service short-circuits to
`kyc_status = 'approved'` with fake `cont_dev_*` / `fa_dev_*` IDs so you can
exercise the rest of the flow locally.

---

## 7. Running a bulk payout

Two entrypoints, same dispatcher (`runBulkPayout` in
`backend/payout-service/src/bulk.ts:70`).

### 7.1 Admin button — `/admin/payouts`

Logged-in admin opens the page (`frontend/src/app/admin/payouts/page.tsx`):

1. Top card calls `GET /api/wallet/eligible-for-payout` →
   shows the table of creators with `pending ≥ min_payout_inr` and
   `kyc_status='approved'`, with totals.
2. **"Initiate payout"** → confirmation modal → `POST /api/payouts/bulk`.
3. Backend:
   - Re-runs the eligibility query (no race against the UI).
   - Inserts a `payout_runs` row with `total_amount` and `creator_count`.
   - For each eligible creator: `POST` to Razorpay `/v1/payouts` with
     `mode=IMPS`, `queue_if_low_balance=true`, and the idempotency header.
     Inserts `payout_items` with `status='processing'`.
   - Returns the full per-creator result list. Failures don't roll back the
     run — successful creators are kept, failed ones go into the **Failed
     payouts** panel below for retry.

### 7.2 Scheduled — daily cron

`backend/payout-service/src/scheduler-worker.ts` is a one-shot script
designed to be run daily by `cron` / GitHub Actions / Render Cron / etc.

```cron
# crontab entry — run at 02:00 UTC every day
0 2 * * *  cd /srv/cs-ranger/backend && npm run payout:run-due >> /var/log/cs-ranger/payouts.log 2>&1
```

The worker calls `runDueScheduledPayouts({ initiatedBy: null })` which:

1. Reads `payout_schedule` from `platform_settings`.
2. If `manual`, returns immediately (`reason: 'manual_schedule'`).
3. Computes the current window key (e.g. `monthly_1st:2026-06-01`).
4. `SELECT payout_runs WHERE scheduled_window = window.key` — friendly
   precheck; the **real** guarantee is the unique index inside
   `runBulkPayout`. Even if two workers fire in the same second, only one
   `INSERT` succeeds; the loser's transaction throws `23505` and the
   function returns `window_already_processed` without dispatching anything.

Running the same cron more often than the schedule is **safe and intended**.

You can also trigger from the admin UI: `/admin/payouts` → "Run scheduled
window now" calls `POST /api/payouts/scheduler/run-due`.

---

## 8. Webhook lifecycle — making the ledger reflect reality

For each `payout_items` row we insert:

| Razorpay status | What our webhook does |
|---|---|
| `created`, `queued`, `pending`, `processing` | Status stays `processing`. No ledger change. |
| `processed` | Status → `processed`. `settled_at = now()`. **Insert a `wallet_ledger` row** with `type='payout_debit'`, `amount=-payout.amount`, `reference_id=razorpay_payout_id`. The trigger debits `creator_balances.pending`. Publish `PAYOUT_COMPLETED`. |
| `failed`, `rejected`, `reversed` | Status → `failed`, store `failure_reason`. Publish `PAYOUT_FAILED`. Pending balance is **unchanged** (no ledger entry was ever made for failures). |

Important: the `payout_debit` ledger row is the **only** thing that changes
`pending`. If Razorpay says success but our webhook never fires (firewall,
revoked secret), the creator received the money but our DB still shows the
pending balance — `/admin/payouts` will keep selecting them for the next run.
**Always reconcile webhook delivery in the Razorpay dashboard after a real run.**

If you ever need to manually reconcile, insert the missing ledger row directly:

```sql
insert into wallet_ledger (creator_id, type, amount, reference_id)
values ('<creator-uuid>', 'payout_debit', -<amount-in-paise>, '<rzp_payout_id>');
```

The balance trigger handles the rest.

---

## 9. Failed payouts — retry flow

Failed items surface in `/admin/payouts` → "Failed payouts" panel (powered by
`GET /api/payouts/failed`).

`POST /api/payouts/<payoutItemId>/retry`:
- Verifies the creator still has approved KYC.
- Builds a **fresh idempotency key** (`retry-<itemId>-<attemptN>`) — the
  original key would just make Razorpay replay the same failed payout instead
  of creating a new one (see `payout-service/src/index.ts:352`).
- Increments `retry_count`, updates `status` back to `processing`, stores the
  new `razorpay_payout_id`.
- Webhook lifecycle then takes over as in section 8.

Each retry is written to the admin audit log (`payout.retry` action).

---

## 10. Manual single-creator payout (dispute resolution, off-cycle)

`POST /api/payouts/manual` — admin only.

```json
{
  "creatorId": "<uuid>",
  "amountInr": 1250.00,
  "reason": "Refund of platform fee misapplied — ticket #SUP-1234",
  "override": false
}
```

- Without `override`, refuses if `creator_balances.pending < amount`.
- With `override: true`, dispatches anyway. Audited with the reason text.
- Same RazorpayX endpoint, idempotency key `manual-<runId>-<creatorId>`.
- Webhook lifecycle identical.

Use this sparingly — bulk + retry handle 99% of cases. Manual is for one-off
corrections where you need a specific amount, not the whole pending balance.

---

## 11. Annual statement (creator-facing tax document)

`/creator/finance` → **Download statement** → `GET /api/payouts/statements/annual/download?format=pdf&fy=2025-26`.

The PDF (built via `buildAnnualStatementPdf` in
`backend/shared/pdf.ts`) summarises, for one financial year (Apr 1 → Mar 31):

- Gross revenue, commission, refunds, TDS withheld, net earnings.
- Payouts made, pending balance carry-over.
- Per-month breakdown (Apr → Mar).

Available CSV too: `?format=csv`. Auth: only the creator themselves or an admin.

This is generated from `wallet_ledger` + `tds_records` at request time — there
is no separate "statement" table. As long as the ledger is intact, the
statement is recomputable forever.

---

## 12. Local development without Razorpay

If `RAZORPAY_KEY_ID` is unset or `RAZORPAY_ACCOUNT_NUMBER` is empty:

- KYC submission auto-approves with `fa_dev_*` IDs.
- Bulk / manual / retry dispatch falls into `settleMockPayout()` — inserts the
  `payout_debit` ledger row *immediately*, so `pending` drops and the run
  looks complete.
- All audit logs and DB rows are real; only the external HTTP call is skipped.
- Webhook endpoints still work — exercising them with synthetic JSON requires
  unsetting `RAZORPAY_WEBHOOK_SECRET` (or signing the payload yourself; see
  `verifyWebhookSignature` in `backend/shared/razorpay.ts`).

This is what the CI and the demo Supabase project run on.

---

## 13. Production checklist

Run through this **before** the first real bulk run.

- [ ] RazorpayX activated, virtual account number copied into
      `RAZORPAY_ACCOUNT_NUMBER`.
- [ ] Virtual account funded with ≥ 2× expected daily payout total.
- [ ] `RAZORPAY_KEY_*` set to **live mode** keys (not `rzp_test_*`).
- [ ] `RAZORPAY_WEBHOOK_SECRET` matches the secret configured in dashboard.
- [ ] Two webhooks (or one webhook with two URLs) configured, both pointing
      at the public gateway, both reachable from the internet — verify with
      "Test webhook" button in the Razorpay dashboard.
- [ ] `database/apply.sh` has been run against production DB — verify with
      `select count(*) from payout_runs;` (should not error).
- [ ] `platform_settings.payout_schedule` set to either `manual` or one of
      the auto modes; `min_payout_inr` matches your business decision.
- [ ] At least one creator has `kyc_details.kyc_status='approved'` AND a
      non-zero `pending` balance — otherwise the first bulk returns
      `no_eligible`.
- [ ] Cron job (or equivalent) scheduled for `npm run payout:run-due` if you
      picked an auto schedule. Daily is enough — the window-key lock handles
      duplicates.
- [ ] Admin audit log accessible at `/admin/audit-log` — every bulk/manual/retry
      shows up there with the initiating admin's user ID.
- [ ] On-call has the runbook: failed payouts → retry; webhook outage → manual
      ledger reconciliation; ledger out of sync → recompute from `wallet_ledger`.

### Smoke test (live mode, do this on a Friday morning, not at 5 PM)

1. Create a real creator account, complete KYC with **your own** bank/UPI.
   Wait for Razorpay to flip `kyc_status` to `approved`.
2. Enrol a learner in one of their courses with a real (₹5) payment so the
   ledger shows an `enrollment_credit`.
3. Refund the payment via the admin UI and confirm `refund_debit` appears.
4. Top up the creator's pending to just over `min_payout_inr` via another
   small enrolment.
5. From `/admin/payouts`, run the bulk. Confirm:
   - `payout_items.status='processing'` after the POST.
   - Razorpay dashboard shows the payout as `queued` / `processing` then
     `processed`.
   - Webhook log shows the success event arrived.
   - `creator_balances.pending` is now zero.
   - Money lands in your bank account within minutes (IMPS).

Only after this round-trip succeeds end-to-end should you announce payouts to
real creators.

---

## 14. Where to find the code

| Concern | File |
|---|---|
| RazorpayX dispatch + bulk loop | `backend/payout-service/src/bulk.ts` |
| HTTP routes (KYC, bulk, manual, retry, webhook, statements) | `backend/payout-service/src/index.ts` |
| Schedule math (window keys, next/current window) | `backend/payout-service/src/scheduler.ts` |
| Cron worker entrypoint | `backend/payout-service/src/scheduler-worker.ts` |
| Razorpay client + signature verification | `backend/shared/razorpay.ts` |
| Balance queries / eligibility list | `backend/wallet-service/src/index.ts` |
| Schema: ledger, balances, KYC, runs, items | `database/migrations/0005_money.sql` |
| Schema: scheduled_window unique index | `database/migrations/0032_payout_scheduler.sql` |
| Schema: atomic verify_payment + refund_payment | `database/migrations/0024_wallet_hardening.sql` |
| Admin payout UI | `frontend/src/app/admin/payouts/page.tsx` |
| Creator finance / KYC UI | `frontend/src/app/creator/finance/page.tsx` |
| API client | `frontend/src/lib/api.ts` (look for `api.payouts.*` and `api.wallet.*`) |

---

If something breaks: check `payout_runs` and `payout_items` first (DB is the
source of truth), then the Razorpay dashboard for the corresponding payout ID,
then the backend logs (`[payout]` prefix in the `run.sh` output). The webhook
delivery log in Razorpay is invaluable when balances and Razorpay's view of the
world disagree.
