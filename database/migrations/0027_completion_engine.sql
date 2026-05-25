-- ============================================================
-- Learner completion engine, certificate PDFs, realtime notifications.
-- Owned by: enrollment-service (progress), achievement-service (certificates),
--           notification-service (realtime).
-- ============================================================

-- ====== Per-node progress metadata ======
-- Existing rows keep working: new columns default to 0/null and the policy
-- engine treats missing metadata as "no signal yet".
alter table node_progress add column if not exists scroll_percent    integer not null default 0 check (scroll_percent between 0 and 100);
alter table node_progress add column if not exists watch_seconds     integer not null default 0 check (watch_seconds >= 0);
alter table node_progress add column if not exists duration_seconds  integer check (duration_seconds is null or duration_seconds >= 0);
alter table node_progress add column if not exists completed_by_rule text;       -- 'manual' | 'scroll_80' | 'watch_80' | 'quiz_pass'
alter table node_progress add column if not exists quiz_attempt_id   uuid references quiz_attempts(id) on delete set null;

-- ====== Quiz attempts: store the pass/fail verdict for review mode ======
alter table quiz_attempts add column if not exists passed boolean;

-- ====== Certificate PDFs ======
-- Private bucket — downloads go through achievement-service (ownership-gated),
-- never a public CDN URL. The service also generates PDFs on the fly when the
-- bucket isn't available (local/dev fallback).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', false, 5242880, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ====== Realtime notifications ======
-- Used as a wake-up signal only (the client refetches via the API on receipt),
-- but adding the table to the publication also enables postgres_changes for
-- deployments that use Supabase Auth sessions. Guarded: plain Postgres (no
-- supabase_realtime publication) and re-runs both no-op cleanly.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table notifications;
    end if;
  end if;
exception when others then
  raise notice 'skipping realtime publication setup: %', sqlerrm;
end $$;
