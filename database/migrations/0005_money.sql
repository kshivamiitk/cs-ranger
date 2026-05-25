-- ============================================================
-- Money: payments (payment-service), wallet ledger (wallet-service),
--        payouts + KYC (payout-service)
-- ============================================================

create table if not exists razorpay_orders (
  id                   uuid primary key default gen_random_uuid(),
  learner_id           uuid not null references users(id) on delete restrict,
  course_id            uuid not null references courses(id) on delete restrict,
  razorpay_order_id    text unique not null,
  amount               integer not null,             -- paise
  currency             text not null default 'INR',
  status               payment_status not null default 'pending',
  created_at           timestamptz not null default now()
);
create index if not exists idx_orders_learner on razorpay_orders(learner_id, created_at desc);

create table if not exists payments (
  id                   uuid primary key default gen_random_uuid(),
  learner_id           uuid not null references users(id) on delete restrict,
  course_id            uuid not null references courses(id) on delete restrict,
  razorpay_order_id    text not null references razorpay_orders(razorpay_order_id) on delete restrict,
  razorpay_payment_id  text unique,
  amount               integer not null,             -- paise
  currency             text not null default 'INR',
  status               payment_status not null default 'pending',
  failure_reason       text,
  webhook_event_id     text,                         -- idempotency for webhook replays
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_payments_learner on payments(learner_id, created_at desc);
create index if not exists idx_payments_status  on payments(status);
create unique index if not exists uniq_payments_webhook_event on payments(webhook_event_id) where webhook_event_id is not null;

drop trigger if exists trg_payments_updated_at on payments;
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

-- ====== Wallet ======

create table if not exists wallet_ledger (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references users(id) on delete restrict,
  type            ledger_type not null,
  amount          integer not null,                 -- paise; sign reflects direction
  reference_id    text not null,                    -- payment_id, payout_id, etc.
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ledger_creator_created on wallet_ledger(creator_id, created_at desc);
create index if not exists idx_ledger_reference       on wallet_ledger(reference_id);

-- Denormalised running balance, kept in sync by trigger below
create table if not exists creator_balances (
  creator_id        uuid primary key references users(id) on delete cascade,
  pending           integer not null default 0,
  total_earned      integer not null default 0,
  total_paid_out    integer not null default 0,
  total_commission  integer not null default 0,
  updated_at        timestamptz not null default now()
);

create or replace function apply_ledger_to_balance() returns trigger language plpgsql as $$
begin
  insert into creator_balances(creator_id) values (new.creator_id) on conflict do nothing;
  update creator_balances set
    pending          = pending          + case when new.type in ('enrollment_credit') then new.amount
                                              when new.type in ('refund_debit', 'payout_debit') then new.amount
                                              else 0 end,
    total_earned     = total_earned     + case when new.type = 'enrollment_credit' then new.amount else 0 end,
    total_paid_out   = total_paid_out   - case when new.type = 'payout_debit' then new.amount else 0 end,  -- payout_debit stored negative
    total_commission = total_commission - case when new.type = 'commission_debit' then new.amount else 0 end,
    updated_at       = now()
  where creator_id = new.creator_id;
  return new;
end $$;

drop trigger if exists trg_ledger_to_balance on wallet_ledger;
create trigger trg_ledger_to_balance after insert on wallet_ledger
  for each row execute function apply_ledger_to_balance();

-- ====== KYC & Payouts ======

create table if not exists kyc_details (
  creator_id                uuid primary key references users(id) on delete cascade,
  razorpay_contact_id       text,
  razorpay_fund_account_id  text,
  kyc_status                kyc_status not null default 'pending',
  bank_name                 text,
  account_number_last4      text,
  ifsc                      text,
  upi_id                    text,
  verified_at               timestamptz,
  failure_reason            text,
  updated_at                timestamptz not null default now(),
  check ((account_number_last4 is not null and ifsc is not null) or upi_id is not null)
);

drop trigger if exists trg_kyc_updated_at on kyc_details;
create trigger trg_kyc_updated_at before update on kyc_details
  for each row execute function set_updated_at();

create table if not exists payout_runs (
  id              uuid primary key default gen_random_uuid(),
  initiated_by    uuid not null references users(id) on delete restrict,
  initiated_at    timestamptz not null default now(),
  total_amount    integer not null,
  creator_count   integer not null,
  notes           text
);

create table if not exists payout_items (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references payout_runs(id) on delete cascade,
  creator_id          uuid not null references users(id) on delete restrict,
  amount              integer not null,
  status              payout_status not null default 'processing',
  razorpay_payout_id  text unique,
  failure_reason      text,
  retry_count         integer not null default 0,
  created_at          timestamptz not null default now(),
  settled_at          timestamptz
);
create index if not exists idx_payout_items_creator on payout_items(creator_id, created_at desc);
create index if not exists idx_payout_items_status  on payout_items(status);

create table if not exists tds_records (
  id              uuid primary key default gen_random_uuid(),
  creator_id      uuid not null references users(id) on delete cascade,
  financial_year  text not null,                     -- e.g. "2026-27"
  gross           integer not null default 0,
  tds_withheld    integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (creator_id, financial_year)
);

-- Creator Terms acceptance — required before a creator can publish
create table if not exists creator_terms_acceptance (
  creator_id                   uuid not null references users(id) on delete cascade,
  terms_version                text not null,
  commission_rate_at_acceptance numeric(5,4) not null,    -- 0.1500 = 15%
  accepted_at                  timestamptz not null default now(),
  primary key (creator_id, terms_version)
);
