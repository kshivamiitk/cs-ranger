-- ============================================================
-- Scheduled payout runner.
-- Owned by: payout-service.
--
-- * initiated_by becomes nullable: runs triggered by the cron worker have no
--   admin user behind them (admin-triggered runs keep recording the admin).
-- * scheduled_window stores the window key (e.g. "monthly_1st:2026-06-01").
--   The partial unique index is the idempotency lock — a payout window can be
--   disbursed at most once, even if two run-due calls race.
-- Idempotent.
-- ============================================================

alter table payout_runs alter column initiated_by drop not null;
alter table payout_runs add column if not exists scheduled_window text;

create unique index if not exists uq_payout_runs_scheduled_window
  on payout_runs(scheduled_window)
  where scheduled_window is not null;
