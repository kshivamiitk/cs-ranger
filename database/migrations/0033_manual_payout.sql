-- ============================================================
-- Off-platform manual payouts.
-- Owned by: payout-service.
--
-- Interim flow used while bulk Razorpay payouts are unavailable: admin sends
-- money to the creator via their own bank / UPI app, then records the payout
-- here. The ledger row triggers the same balance update as a Razorpay payout
-- (pending -> 0, total_paid_out += amount).
--
-- * Three columns added to kyc_details so the admin queue can show enough
--   info to actually send the money: full account number, account-holder
--   name, contact phone. Nullable — legacy rows stay valid; new submissions
--   from /creator/finance populate them going forward.
-- * manual_payouts is a flat audit log of each off-platform disbursement.
--   It links back to the wallet_ledger row that did the balance move, so the
--   ledger remains the source of truth and this table is purely descriptive.
-- Idempotent.
-- ============================================================

alter table kyc_details add column if not exists account_number      text;
alter table kyc_details add column if not exists account_holder_name text;
alter table kyc_details add column if not exists contact_number      text;

create table if not exists manual_payouts (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references users(id) on delete restrict,
  amount          integer not null check (amount > 0),  -- paise
  method          text not null check (method in ('bank', 'upi', 'other')),
  txn_reference   text,                                  -- e.g. admin's UTR / UPI ref
  note            text,
  marked_paid_by  uuid not null references users(id) on delete restrict,
  marked_paid_at  timestamptz not null default now(),
  ledger_id       uuid references wallet_ledger(id) on delete set null
);

create index if not exists idx_manual_payouts_creator on manual_payouts(creator_id, marked_paid_at desc);
create index if not exists idx_manual_payouts_marked_at on manual_payouts(marked_paid_at desc);
