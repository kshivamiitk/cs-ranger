-- ============================================================
-- Per-creator storage quota.
-- Hot path: every PDF upload checks "is this creator over their cap?"
-- Need this to be O(1), so we keep a denormalized `bytes_used` counter
-- that a trigger on storage.objects keeps in sync. The upload handler
-- just reads one row of creator_storage — no SUM(), no scans.
--
-- Quota = free baseline (env) + any purchased extra that hasn't yet
-- lapsed. Purchases extend `extra_until`; if expired, only the free
-- baseline applies.
-- ============================================================

create table if not exists creator_storage (
  creator_id   uuid primary key references users(id) on delete cascade,
  bytes_used   bigint not null default 0 check (bytes_used >= 0),
  extra_bytes  bigint not null default 0 check (extra_bytes >= 0),
  extra_until  timestamptz,
  updated_at   timestamptz not null default now()
);

-- Tracks every storage purchase, including pending Razorpay orders so we
-- can reconcile via webhook/return-trip even if the client never confirms.
create table if not exists storage_purchases (
  id                   uuid primary key default gen_random_uuid(),
  creator_id           uuid not null references users(id) on delete cascade,
  mb                   integer not null check (mb > 0),
  amount_paise         integer not null check (amount_paise > 0),
  razorpay_order_id    text unique not null,
  razorpay_payment_id  text,
  status               text not null default 'pending' check (status in ('pending','success','failed')),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index if not exists idx_storage_purchases_creator on storage_purchases(creator_id, created_at desc);

-- ─── Trigger: keep bytes_used in sync with the bucket ────────────
-- Path convention is "<creatorId>/<uuid>.<ext>" — see course-service's
-- /uploads/pdf-url which mints these. We pull the creator_id straight
-- from the path so this works even when the upload happens via a
-- signed URL (where storage.objects.owner is NULL).
create or replace function bump_creator_storage() returns trigger language plpgsql security definer as $$
declare _bytes bigint; _creator uuid;
begin
  if tg_op = 'INSERT' then
    if new.bucket_id = 'node-pdfs' then
      begin _creator := split_part(new.name, '/', 1)::uuid; exception when others then return null; end;
      _bytes := coalesce((new.metadata->>'size')::bigint, 0);
      insert into creator_storage (creator_id, bytes_used, updated_at)
      values (_creator, _bytes, now())
      on conflict (creator_id) do update set
        bytes_used = creator_storage.bytes_used + excluded.bytes_used,
        updated_at = now();
    end if;
  elsif tg_op = 'DELETE' then
    if old.bucket_id = 'node-pdfs' then
      begin _creator := split_part(old.name, '/', 1)::uuid; exception when others then return null; end;
      _bytes := coalesce((old.metadata->>'size')::bigint, 0);
      update creator_storage set
        bytes_used = greatest(bytes_used - _bytes, 0),
        updated_at = now()
        where creator_id = _creator;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_creator_storage_changes on storage.objects;
create trigger trg_creator_storage_changes
after insert or delete on storage.objects
for each row execute function bump_creator_storage();

-- ─── One-time backfill ──────────────────────────────────────────
-- Compute current usage from every existing file in node-pdfs whose
-- path matches the "<creatorId>/" prefix. Idempotent — re-running
-- the migration overwrites with the fresh sum.
do $$
declare
  _bucket text := 'node-pdfs';
begin
  insert into creator_storage (creator_id, bytes_used, updated_at)
  select
    split_part(name, '/', 1)::uuid as creator_id,
    coalesce(sum((metadata->>'size')::bigint), 0) as bytes_used,
    now()
  from storage.objects
  where bucket_id = _bucket
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  group by split_part(name, '/', 1)
  on conflict (creator_id) do update set
    bytes_used = excluded.bytes_used,
    updated_at = now();
exception when others then
  -- Storage schema not accessible in some local setups — skip backfill.
  null;
end;
$$;

-- ─── RLS ────────────────────────────────────────────────────────
alter table creator_storage     enable row level security;
alter table storage_purchases   enable row level security;

drop policy if exists creator_storage_self_read on creator_storage;
create policy creator_storage_self_read on creator_storage
  for select using (creator_id = auth.uid() or is_admin());

drop policy if exists storage_purchases_self_read on storage_purchases;
create policy storage_purchases_self_read on storage_purchases
  for select using (creator_id = auth.uid() or is_admin());
