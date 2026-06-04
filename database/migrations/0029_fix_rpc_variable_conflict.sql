-- ============================================================
-- 0029 — Fix "column reference is ambiguous" in the money RPCs.
--
-- verify_payment() and refund_payment() declare RETURNS TABLE (… learner_id,
-- course_id …). Those OUT names collide with the enrollments columns referenced
-- bare inside the function:
--   * verify_payment: `on conflict (learner_id, course_id)`
--   * refund_payment: `delete from enrollments where learner_id = … and course_id = …`
-- On current Postgres the default plpgsql.variable_conflict is `error`, so EVERY
-- call threw `column reference "learner_id" is ambiguous` — which meant no
-- payment ever transitioned to success and no enrollment was ever created
-- ("paid but no access"). Re-created here, byte-identical except for the
-- `#variable_conflict use_column` directive that resolves bare references to the
-- table column (the intended target). Pure CREATE OR REPLACE — no data touched.
-- ============================================================

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
#variable_conflict use_column
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
#variable_conflict use_column
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
