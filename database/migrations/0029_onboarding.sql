-- ============================================================
-- 4-step onboarding: resumable step pointer + free-form answers.
-- Owned by: user-service. profiles.has_completed_onboarding (0002) stays the
-- single completion flag; these columns add resume + collected preferences.
-- ============================================================

alter table profiles add column if not exists onboarding_step integer not null default 0 check (onboarding_step between 0 and 4);
alter table profiles add column if not exists onboarding_data jsonb not null default '{}'::jsonb;
