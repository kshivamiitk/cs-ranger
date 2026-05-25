-- ============================================================
-- Achievements: badges, streaks, certificates
-- Owned by: achievement-service
-- ============================================================

create table if not exists badges (
  id           uuid primary key default gen_random_uuid(),
  rule_key     text unique not null,                 -- 'first_lesson', 'streak_7', etc.
  name         text not null,
  description  text not null,
  icon         text not null,
  rarity       badge_rarity not null default 'common',
  position     integer not null default 0
);

create table if not exists user_badges (
  user_id     uuid not null references users(id) on delete cascade,
  badge_id    uuid not null references badges(id) on delete cascade,
  earned_at   timestamptz not null default now(),
  primary key (user_id, badge_id)
);
create index if not exists idx_user_badges_earned on user_badges(user_id, earned_at desc);

create table if not exists user_streaks (
  user_id             uuid primary key references users(id) on delete cascade,
  current_streak      integer not null default 0,
  longest_streak      integer not null default 0,
  last_activity_date  date,
  updated_at          timestamptz not null default now()
);
drop trigger if exists trg_streaks_updated_at on user_streaks;
create trigger trg_streaks_updated_at before update on user_streaks
  for each row execute function set_updated_at();

create table if not exists certificates (
  id                  uuid primary key default gen_random_uuid(),
  learner_id          uuid not null references users(id) on delete cascade,
  course_id           uuid not null references courses(id) on delete cascade,
  pdf_url             text,
  verification_token  text unique not null,           -- random opaque token (UUID/ULID)
  issued_at           timestamptz not null default now(),
  unique (learner_id, course_id)
);
create index if not exists idx_certificates_learner on certificates(learner_id);
create index if not exists idx_certificates_course  on certificates(course_id);
