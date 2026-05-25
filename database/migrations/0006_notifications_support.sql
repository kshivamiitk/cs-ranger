-- ============================================================
-- Notifications (notification-service) + Support tickets (support-service)
-- ============================================================

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null,                       -- 'enrollment', 'doubt_reply', 'new_course', 'payout', 'badge', etc.
  title       text not null,
  body        text not null,
  href        text,
  payload     jsonb not null default '{}'::jsonb,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user_unread on notifications(user_id, is_read, created_at desc);

create table if not exists notification_preferences (
  user_id        uuid not null references users(id) on delete cascade,
  event_type     text not null,                    -- maps to event keys
  email_enabled  boolean not null default true,
  inapp_enabled  boolean not null default true,
  primary key (user_id, event_type)
);

-- ====== Support tickets ======

create table if not exists support_tickets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  subject            text not null check (char_length(subject) between 3 and 120),
  status             ticket_status not null default 'open',
  assigned_admin_id  uuid references users(id) on delete set null,
  related_payment_id uuid references payments(id) on delete set null,  -- for refund tickets
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_tickets_user   on support_tickets(user_id, updated_at desc);
create index if not exists idx_tickets_status on support_tickets(status, updated_at desc);
create index if not exists idx_tickets_admin  on support_tickets(assigned_admin_id);

drop trigger if exists trg_tickets_updated_at on support_tickets;
create trigger trg_tickets_updated_at before update on support_tickets
  for each row execute function set_updated_at();

create table if not exists ticket_messages (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references support_tickets(id) on delete cascade,
  author_id         uuid not null references users(id) on delete cascade,
  body              text not null,
  is_internal_note  boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists idx_ticket_messages on ticket_messages(ticket_id, created_at);

create table if not exists canned_responses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
