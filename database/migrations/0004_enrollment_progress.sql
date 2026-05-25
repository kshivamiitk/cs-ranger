-- ============================================================
-- Enrollment & progress
-- Owned by: enrollment-service
-- ============================================================

create table if not exists enrollments (
  id                 uuid primary key default gen_random_uuid(),
  learner_id         uuid not null references users(id) on delete cascade,
  course_id          uuid not null references courses(id) on delete cascade,
  enrolled_at        timestamptz not null default now(),
  completed_at       timestamptz,
  progress_percent   integer not null default 0 check (progress_percent between 0 and 100),
  last_node_id       uuid references nodes(id) on delete set null,
  last_accessed_at   timestamptz not null default now(),
  unique (learner_id, course_id)
);
create index if not exists idx_enrollments_learner    on enrollments(learner_id, last_accessed_at desc);
create index if not exists idx_enrollments_course     on enrollments(course_id);
create index if not exists idx_enrollments_completed  on enrollments(completed_at) where completed_at is not null;

create table if not exists node_progress (
  learner_id        uuid not null references users(id) on delete cascade,
  node_id           uuid not null references nodes(id) on delete cascade,
  is_completed      boolean not null default false,
  completed_at      timestamptz,
  watch_position_s  integer not null default 0,
  last_accessed_at  timestamptz not null default now(),
  primary key (learner_id, node_id)
);
create index if not exists idx_node_progress_completed
  on node_progress(learner_id, completed_at)
  where is_completed = true;

create table if not exists quiz_attempts (
  id                uuid primary key default gen_random_uuid(),
  learner_id        uuid not null references users(id) on delete cascade,
  node_id           uuid not null references nodes(id) on delete cascade,
  answers           jsonb not null,                    -- [{ questionId, pickedIndex }]
  score             integer not null,
  max_score         integer not null,
  duration_seconds  integer,
  attempted_at      timestamptz not null default now()
);
create index if not exists idx_quiz_attempts_learner on quiz_attempts(learner_id, attempted_at desc);
create index if not exists idx_quiz_attempts_node    on quiz_attempts(node_id);

-- Notes written by learner during a video lesson
create table if not exists learner_notes (
  id            uuid primary key default gen_random_uuid(),
  learner_id    uuid not null references users(id) on delete cascade,
  node_id       uuid not null references nodes(id) on delete cascade,
  body          text not null,
  timestamp_s   integer,                               -- video timestamp the note was anchored at
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_learner_notes_owner on learner_notes(learner_id, node_id);
drop trigger if exists trg_learner_notes_updated_at on learner_notes;
create trigger trg_learner_notes_updated_at before update on learner_notes
  for each row execute function set_updated_at();
