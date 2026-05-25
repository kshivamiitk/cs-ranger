-- ============================================================
-- Content moderation: allow reporting whole courses (user_reports already
-- supports users / nodes / comments from 0008) and index the admin queue.
-- Owned by: course-service (report + moderation endpoints).
-- ============================================================

alter table user_reports add column if not exists target_course uuid references courses(id) on delete cascade;

-- Admin queue is read newest-first filtered by status.
create index if not exists idx_user_reports_status_created on user_reports(status, created_at desc);
create index if not exists idx_user_reports_reporter on user_reports(reporter_id, created_at desc);
