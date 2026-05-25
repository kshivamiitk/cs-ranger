-- ============================================================
-- Round-2 hardening on the payment + storage paths.
--   * Storage: reservation column + atomic reserve_storage RPC so two
--     concurrent /uploads/pdf-url calls can't both pass the quota check.
--     Trigger updated to release the reservation when the upload lands.
--   * grant_storage reordered: status-guard before the bytes upsert,
--     so a race can't even briefly over-count extra_bytes.
-- ============================================================

-- ─── Storage reservations ─────────────────────────────────────────
-- pending_bytes = sum of bytes the creator has reserved for in-flight
-- uploads. Quota check counts this against the cap, so concurrent
-- reservations see each other. The trigger drains pending_bytes when
-- the upload finally hits storage.objects.
alter table creator_storage
  add column if not exists pending_bytes bigint not null default 0 check (pending_bytes >= 0);

-- Atomic reserve. SELECT FOR UPDATE serializes concurrent callers, and
-- the quota math counts bytes_used + pending_bytes against the cap, so
-- two parallel requests can't both pass when only one fits.
create or replace function reserve_storage(
  p_creator_id  uuid,
  p_bytes       bigint,
  p_free_mb     integer
)
returns table (ok boolean, reason text, bytes_used bigint, quota_bytes bigint)
language plpgsql security definer as $$
declare
  _row    creator_storage;
  _quota  bigint;
  _used   bigint;
begin
  -- Ensure row exists, then lock it for the duration of this txn.
  insert into creator_storage (creator_id, bytes_used, pending_bytes, extra_bytes, updated_at)
  values (p_creator_id, 0, 0, 0, now())
  on conflict (creator_id) do nothing;

  select * into _row from creator_storage where creator_id = p_creator_id for update;

  _quota := (p_free_mb::bigint * 1024 * 1024)
          + case when _row.extra_until > now() then _row.extra_bytes else 0 end;
  _used  := _row.bytes_used + _row.pending_bytes;

  if _used + p_bytes > _quota then
    return query select false, 'over_quota'::text, _row.bytes_used, _quota;
    return;
  end if;

  update creator_storage
     set pending_bytes = pending_bytes + p_bytes,
         updated_at    = now()
   where creator_id = p_creator_id;

  return query select true, ''::text, _row.bytes_used, _quota;
end;
$$;

-- ─── Trigger refresh: release reservation when upload lands ──────
-- Same logic as bump_creator_storage from migration 0022, plus a
-- pending_bytes drain. We can't tell exactly which reservation this
-- file consumed (multiple reservations per creator are possible), so
-- we drain by the new file's actual size, capped at pending_bytes
-- so it never goes negative.
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
        bytes_used    = creator_storage.bytes_used + excluded.bytes_used,
        -- Drain the reservation. min(pending, actual) avoids drift if the
        -- uploaded file was smaller than what was reserved.
        pending_bytes = greatest(creator_storage.pending_bytes - excluded.bytes_used, 0),
        updated_at    = now();
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

-- Sweep stale reservations — if a creator's pending_bytes hasn't been
-- touched by a real upload for a while, the reservations were almost
-- certainly abandoned. Conservative cutoff (30 min) covers a slow
-- network upload of a 25 MB PDF on a bad connection.
create or replace function sweep_storage_reservations(p_minutes integer default 30)
returns integer language plpgsql security definer as $$
declare _affected integer;
begin
  with reset as (
    update creator_storage
       set pending_bytes = 0, updated_at = now()
     where pending_bytes > 0
       and updated_at < now() - (p_minutes || ' minutes')::interval
    returning creator_id
  )
  select count(*) into _affected from reset;
  return _affected;
end;
$$;

-- Schedule via pg_cron alongside the other sweepers.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sweep_storage_reservations';
    perform cron.schedule(
      'sweep_storage_reservations',
      '*/15 * * * *',
      $sql$select sweep_storage_reservations(30)$sql$
    );
  end if;
exception when others then null;
end;
$cron$;

-- ─── grant_storage: reorder status guard before bytes upsert ─────
-- Previous version upserted creator_storage BEFORE checking the
-- storage_purchases status guard, so two concurrent verifies could
-- both inflate extra_bytes and then the loser tried to roll it back.
-- New version: claim the status atomically first, then apply the bytes.
create or replace function grant_storage(
  p_order_id        text,
  p_payment_id      text,
  p_caller_id       uuid,
  p_duration_days   integer default 30
)
returns table (
  ok               boolean,
  reason           text,
  granted_mb       integer,
  extra_until      timestamptz,
  already_applied  boolean
)
language plpgsql security definer as $$
declare
  _purchase  record;
  _new_until timestamptz;
  _updated   integer;
begin
  select * into _purchase from storage_purchases where razorpay_order_id = p_order_id;
  if not found then
    return query select false, 'Order not found'::text, null::integer, null::timestamptz, false;
    return;
  end if;
  if _purchase.creator_id <> p_caller_id then
    return query select false, 'Not your order'::text, null::integer, null::timestamptz, false;
    return;
  end if;

  -- Claim the order BEFORE touching creator_storage. If we lose the race
  -- here, no bytes have moved — clean exit, no rollback needed.
  update storage_purchases set
    status               = 'success',
    razorpay_payment_id  = p_payment_id,
    completed_at         = now()
  where id = _purchase.id and status = 'pending';
  get diagnostics _updated = row_count;

  if _updated = 0 then
    -- Already processed by a concurrent caller (or in a non-pending state).
    if _purchase.status = 'success' then
      return query select true, ''::text, _purchase.mb, null::timestamptz, true;
    else
      return query select false, ('Order in ' || _purchase.status || ' state')::text, _purchase.mb, null::timestamptz, false;
    end if;
    return;
  end if;

  _new_until := now() + (p_duration_days || ' days')::interval;
  insert into creator_storage (creator_id, extra_bytes, extra_until, updated_at)
  values (p_caller_id, _purchase.mb::bigint * 1024 * 1024, _new_until, now())
  on conflict (creator_id) do update set
    extra_bytes = creator_storage.extra_bytes + (_purchase.mb::bigint * 1024 * 1024),
    extra_until = _new_until,
    updated_at  = now();

  return query select true, ''::text, _purchase.mb, _new_until, false;
end;
$$;
