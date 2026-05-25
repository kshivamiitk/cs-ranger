-- ============================================================
-- Admin governance: account suspension, full platform-settings
-- key set, and two-person admin role grants.
-- Owned by: user-service (admin endpoints) + auth-service (login gate)
-- ============================================================

-- ====== Account suspension ======
-- Suspension is an auth-level concern: a suspended user cannot log in or
-- refresh a session. The reason is required and mirrored into the audit log.
alter table users add column if not exists is_suspended      boolean not null default false;
alter table users add column if not exists suspended_at      timestamptz;
alter table users add column if not exists suspension_reason text;

-- Hot path for the admin user list "suspended" filter.
create index if not exists idx_users_suspended on users(is_suspended) where is_suspended;

-- ====== Platform settings: complete the key set ======
-- 0008 seeded the monetisation/legal keys; these complete the set the admin
-- settings page manages. Values are jsonb, one row per key.
insert into platform_settings (key, value, description) values
  ('payout_schedule',      '"manual"'::jsonb, 'Bulk payout cadence: manual | monthly_1st | monthly_1st_15th'),
  ('refund_auto_approval', 'false'::jsonb,    'Auto-approve refund requests inside the refund window'),
  ('feature_flags',        '{}'::jsonb,       'Boolean toggles for experimental features')
on conflict (key) do nothing;

-- ====== Two-person admin grants ======
-- Granting admin is never a single API call: one admin requests, a DIFFERENT
-- admin approves. Approval flips profiles.is_admin, which the 0012 trigger
-- turns into the actual user_roles row.
create table if not exists admin_role_requests (
  id            uuid primary key default gen_random_uuid(),
  target_user   uuid not null references users(id) on delete cascade,
  requested_by  uuid not null references users(id) on delete restrict,
  reason        text not null,
  status        text not null default 'pending',     -- 'pending', 'approved', 'rejected'
  reviewed_by   uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  check (target_user <> requested_by)
);
create index if not exists idx_admin_role_requests_status on admin_role_requests(status, created_at desc);

alter table admin_role_requests enable row level security;
drop policy if exists admin_role_requests_admin_all on admin_role_requests;
create policy admin_role_requests_admin_all on admin_role_requests
  for all using (is_admin()) with check (is_admin());
