-- Extensions required across the schema
create extension if not exists "pgcrypto";        -- gen_random_uuid()
create extension if not exists "pg_trgm";         -- trigram indexes for search
create extension if not exists "uuid-ossp";
create extension if not exists "citext";          -- case-insensitive email columns (used in 0002_identity.sql)

-- Custom enums
do $$ begin
  create type user_role        as enum ('learner', 'creator', 'admin');
  create type course_status    as enum ('draft', 'under_review', 'published', 'archived');
  create type course_level     as enum ('Beginner', 'Intermediate', 'Advanced', 'All Levels');
  create type node_type        as enum ('video', 'markdown', 'quiz', 'pdf', 'static_website');
  create type payment_status   as enum ('pending', 'success', 'failed', 'refunded');
  create type ledger_type      as enum ('enrollment_credit', 'commission_debit', 'refund_debit', 'payout_debit', 'tds_debit');
  create type payout_status    as enum ('processing', 'processed', 'failed');
  create type kyc_status       as enum ('pending', 'approved', 'failed');
  create type ticket_status    as enum ('open', 'in_progress', 'resolved');
  create type theme_preference as enum ('light', 'dark', 'system');
  create type badge_rarity     as enum ('common', 'rare', 'epic', 'legendary');
exception when duplicate_object then null;
end $$;
