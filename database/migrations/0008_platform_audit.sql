-- ============================================================
-- Platform-level configuration and admin audit log
-- ============================================================

create table if not exists platform_settings (
  key         text primary key,                       -- 'commission_rate', 'min_payout_inr', 'refund_window_days', 'creator_terms_version', etc.
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

insert into platform_settings (key, value, description) values
  ('site_name',              '"LearnRift"'::jsonb,        'Public site name'),
  ('commission_rate',        '0.15'::jsonb,                'Platform fee as a fraction (0.15 = 15%)'),
  ('min_payout_inr',         '500'::jsonb,                 'Minimum pending balance (₹) before payout'),
  ('refund_window_days',     '7'::jsonb,                   'No-questions-asked refund window in days'),
  ('creator_terms_version',  '"2026-05-01"'::jsonb,        'Current Creator T&C version'),
  ('tds_threshold_inr',      '50000'::jsonb,               'Annual gross over which TDS applies'),
  ('tds_rate',               '0.10'::jsonb,                'TDS withholding rate')
on conflict (key) do nothing;

-- Immutable audit log of all admin actions
create table if not exists admin_audit_log (
  id           bigserial primary key,
  admin_id     uuid not null references users(id) on delete restrict,
  action       text not null,                          -- 'course.approve', 'course.reject', 'commission.update', 'user.ban', ...
  target_type  text,                                   -- 'course', 'user', 'payout_run', 'setting'
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_admin_created on admin_audit_log(admin_id, created_at desc);
create index if not exists idx_audit_target        on admin_audit_log(target_type, target_id);

-- Prevent updates and deletes on the audit log (true immutability)
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;

drop trigger if exists trg_audit_no_update on admin_audit_log;
create trigger trg_audit_no_update before update on admin_audit_log
  for each row execute function audit_log_immutable();
drop trigger if exists trg_audit_no_delete on admin_audit_log;
create trigger trg_audit_no_delete before delete on admin_audit_log
  for each row execute function audit_log_immutable();

-- User reports (abuse / spam flags)
create table if not exists user_reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references users(id) on delete set null,
  target_user   uuid references users(id) on delete cascade,
  target_node   uuid references nodes(id) on delete cascade,
  target_comment uuid references comments(id) on delete cascade,
  reason        text not null,
  status        text not null default 'open',         -- 'open', 'dismissed', 'actioned'
  reviewed_by   uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
