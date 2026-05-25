-- ============================================================
-- Wallet & payments hardening. Closes every "money correctness"
-- edge case in the audit:
--   * Idempotent state transitions (verify can be called N times,
--     creator only gets credited once).
--   * Single-row transactional functions so partial failures roll
--     back cleanly — no "user paid, no enrollment created" reports.
--   * Refund is now atomic: status flip + ledger debit + enrollment
--     removal + audit log in one transaction. Enforces refund window.
--   * Cleanup function for abandoned pending orders.
--
-- All functions are SECURITY DEFINER so the backend (service role)
-- can call them; the service layer is responsible for authorization
-- before invocation.
-- ============================================================

-- ─── verify_payment ───────────────────────────────────────────────
-- Single source of truth for "this Razorpay payment succeeded".
-- Returns transitioned=true exactly once per order_id; subsequent
-- calls (retried /verify, late webhook, concurrent tabs) return
-- transitioned=false so the backend can skip the event emit and not
-- double-credit the creator.
create or replace function verify_payment(
  p_order_id          text,
  p_payment_id        text,
  p_webhook_event_id  text          default null,
  p_commission_rate   numeric       default 0.15
)
returns table (
  transitioned   boolean,
  payment_id     uuid,
  course_id      uuid,
  learner_id     uuid,
  amount_paise   integer
)
language plpgsql security definer as $$
declare
  _payment   record;
  _course    record;
  _commission integer;
  _net        integer;
  _updated    integer;
begin
  select * into _payment from payments where razorpay_order_id = p_order_id;
  if not found then
    return query select false, null::uuid, null::uuid, null::uuid, null::integer;
    return;
  end if;

  -- Already terminal → nothing to do.
  if _payment.status in ('success', 'refunded') then
    return query select false, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  -- Atomic status transition. Without the status guard two concurrent
  -- /verify calls would both succeed; with it only one row gets updated.
  update payments set
    razorpay_payment_id = p_payment_id,
    status              = 'success',
    webhook_event_id    = coalesce(p_webhook_event_id, webhook_event_id),
    updated_at          = now()
  where id = _payment.id and status in ('pending', 'failed');
  get diagnostics _updated = row_count;

  if _updated = 0 then
    -- Lost the race or already advanced — no event emit.
    return query select false, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  update razorpay_orders set status = 'success' where razorpay_order_id = p_order_id;

  -- Enrollment row — idempotent thanks to (learner_id, course_id) PK.
  insert into enrollments (learner_id, course_id, progress_percent)
  values (_payment.learner_id, _payment.course_id, 0)
  on conflict (learner_id, course_id) do nothing;

  -- Ledger: creator gets net (paise), platform records the commission
  -- as a negative entry so balance trigger keeps both fields tidy.
  select creator_id into _course from courses where id = _payment.course_id;
  _commission := floor(_payment.amount * p_commission_rate);
  _net        := _payment.amount - _commission;
  insert into wallet_ledger (creator_id, type, amount, reference_id, notes) values
    (_course.creator_id, 'enrollment_credit', _net,        _payment.id::text, 'Enrollment payment ' || _payment.id::text),
    (_course.creator_id, 'commission_debit',  -_commission, _payment.id::text, 'Platform commission');

  return query select true, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
end;
$$;

-- ─── refund_payment ───────────────────────────────────────────────
-- Atomic admin refund. Enforces:
--   * payment exists and is currently 'success'
--   * within the refund window (env: PLATFORM_REFUND_WINDOW_DAYS)
--   * exactly one refund per payment (status guard)
-- Side effects on success: status flip, wallet_ledger refund_debit,
-- enrollment removal, audit log entry. All in one transaction.
create or replace function refund_payment(
  p_payment_id      uuid,
  p_admin_id        uuid,
  p_window_days     integer default 7,
  p_commission_rate numeric default 0.15
)
returns table (
  ok            boolean,
  reason        text,
  payment_id    uuid,
  course_id     uuid,
  learner_id    uuid,
  amount_paise  integer
)
language plpgsql security definer as $$
declare
  _payment    record;
  _course     record;
  _commission integer;
  _net        integer;
  _updated    integer;
begin
  select * into _payment from payments where id = p_payment_id;
  if not found then
    return query select false, 'Payment not found'::text, null::uuid, null::uuid, null::uuid, null::integer;
    return;
  end if;

  if _payment.status <> 'success' then
    return query select false, 'Payment is not in success state'::text, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  if p_window_days > 0 and _payment.created_at < now() - (p_window_days || ' days')::interval then
    return query select false, ('Refund window of ' || p_window_days || ' days has passed')::text, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  update payments set status = 'refunded', updated_at = now()
  where id = p_payment_id and status = 'success';
  get diagnostics _updated = row_count;

  if _updated = 0 then
    return query select false, 'Already refunded'::text, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  select creator_id into _course from courses where id = _payment.course_id;
  _commission := floor(_payment.amount * p_commission_rate);
  _net        := _payment.amount - _commission;
  insert into wallet_ledger (creator_id, type, amount, reference_id, notes)
  values (_course.creator_id, 'refund_debit', -_net, _payment.id::text, 'Refund reversal');

  delete from enrollments where learner_id = _payment.learner_id and course_id = _payment.course_id;

  insert into admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (p_admin_id, 'payment.refund', 'payment', _payment.id::text,
          jsonb_build_object('amount_paise', _payment.amount, 'reason', 'admin_refund'));

  return query select true, ''::text, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
end;
$$;

-- ─── grant_storage ────────────────────────────────────────────────
-- Atomic storage purchase apply. Returns already_applied=true on
-- repeat calls so the verify endpoint stays idempotent.
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
  if _purchase.status = 'success' then
    return query select true, ''::text, _purchase.mb, null::timestamptz, true;
    return;
  end if;
  if _purchase.status <> 'pending' then
    return query select false, 'Order not in pending state'::text, _purchase.mb, null::timestamptz, false;
    return;
  end if;

  _new_until := now() + (p_duration_days || ' days')::interval;

  insert into creator_storage (creator_id, extra_bytes, extra_until, updated_at)
  values (p_caller_id, _purchase.mb::bigint * 1024 * 1024, _new_until, now())
  on conflict (creator_id) do update set
    extra_bytes = creator_storage.extra_bytes + (_purchase.mb::bigint * 1024 * 1024),
    extra_until = _new_until,
    updated_at  = now();

  update storage_purchases set
    status               = 'success',
    razorpay_payment_id  = p_payment_id,
    completed_at         = now()
  where id = _purchase.id and status = 'pending';
  get diagnostics _updated = row_count;

  -- If the guard above missed (concurrent verify), nothing was applied
  -- here; the creator_storage row is over-counted by the upsert above.
  -- Roll it back.
  if _updated = 0 then
    update creator_storage set
      extra_bytes = greatest(creator_storage.extra_bytes - (_purchase.mb::bigint * 1024 * 1024), 0)
      where creator_id = p_caller_id;
    return query select true, ''::text, _purchase.mb, null::timestamptz, true;
    return;
  end if;

  return query select true, ''::text, _purchase.mb, _new_until, false;
end;
$$;

-- ─── expire_pending_orders ───────────────────────────────────────
-- Sweep abandoned orders older than cutoff_minutes. Razorpay orders
-- themselves expire ~15 min server-side, but we keep our local rows
-- alive for visibility — this function flips them to 'failed' so
-- they stop showing up as "pending" on the user's Transactions page.
create or replace function expire_pending_orders(p_minutes integer default 60)
returns integer language plpgsql security definer as $$
declare _expired integer;
begin
  with payments_expired as (
    update payments set
      status         = 'failed',
      failure_reason = coalesce(failure_reason, 'expired'),
      updated_at     = now()
    where status = 'pending' and created_at < now() - (p_minutes || ' minutes')::interval
    returning id
  )
  select count(*) into _expired from payments_expired;

  update razorpay_orders set status = 'failed'
  where status = 'pending' and created_at < now() - (p_minutes || ' minutes')::interval;

  update storage_purchases set status = 'failed'
  where status = 'pending' and created_at < now() - (p_minutes || ' minutes')::interval;

  return _expired;
end;
$$;

-- Try to schedule the sweep every 15 minutes via pg_cron if available.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire_pending_orders';
    perform cron.schedule(
      'expire_pending_orders',
      '*/15 * * * *',
      $sql$select expire_pending_orders(60)$sql$
    );
  end if;
exception when others then null;
end;
$cron$;
