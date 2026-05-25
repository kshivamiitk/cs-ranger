-- ============================================================
-- Identity: users, profiles, sessions
-- Owned by: auth-service (users, *_tokens) + user-service (profiles)
-- ============================================================

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           citext unique not null,
  password_hash   text,                              -- null when only OAuth
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create table if not exists user_roles (
  user_id   uuid not null references users(id) on delete cascade,
  role      user_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists profiles (
  user_id          uuid primary key references users(id) on delete cascade,
  display_name     text not null check (char_length(display_name) between 2 and 60),
  username         citext unique not null check (username ~ '^[a-z0-9_]{3,30}$'),
  bio              text check (char_length(bio) <= 500),
  college          text check (char_length(college) <= 100),
  avatar_url       text,
  cover_url        text,
  social_links     jsonb not null default '{}'::jsonb,
  theme_preference theme_preference not null default 'system',
  has_completed_onboarding boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists refresh_tokens (
  token_hash      text primary key,                  -- store bcrypt/SHA, not raw
  user_id         uuid not null references users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);
create index if not exists idx_refresh_tokens_user on refresh_tokens(user_id);

create table if not exists email_verification_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists password_reset_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists subscriptions (
  learner_id   uuid not null references users(id) on delete cascade,
  creator_id   uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (learner_id, creator_id),
  check (learner_id <> creator_id)
);
create index if not exists idx_subscriptions_creator on subscriptions(creator_id);

-- Trigger: keep profiles.updated_at fresh
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
  before update on profiles for each row
  execute function set_updated_at();
