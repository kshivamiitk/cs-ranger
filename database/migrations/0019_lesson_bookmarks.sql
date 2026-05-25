-- ============================================================
-- Per-lesson bookmarks. Distinct from `bookmarks` (course-level "save this
-- course for later") — this captures the learner's intent to come back to a
-- specific lesson. Clicking the bookmark in /bookmarks deep-links to
--   /course/<course_id>/learn/<node_id>
-- rather than the course landing.
-- ============================================================

create table if not exists lesson_bookmarks (
  learner_id uuid not null references users(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  node_id    uuid not null references nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (learner_id, node_id)
);

-- Covers the bookmarks-page query: per-learner, newest first.
create index if not exists idx_lesson_bookmarks_learner_created
  on lesson_bookmarks(learner_id, created_at desc);

alter table lesson_bookmarks enable row level security;

-- 0010_rls.sql drops all public-schema policies at the top so it can be
-- re-applied; idempotent here too.
drop policy if exists lesson_bookmarks_self_all on lesson_bookmarks;
create policy lesson_bookmarks_self_all on lesson_bookmarks
  for all using (learner_id = auth.uid()) with check (learner_id = auth.uid());
