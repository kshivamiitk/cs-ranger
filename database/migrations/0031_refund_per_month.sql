-- ============================================================
-- 0031 — Refunds must remove ONE month, not all access.
--
-- Under per-month pricing each payment grants +30 days (stacking). The old
-- refund_payment() deleted the whole enrollment, so refunding one of two stacked
-- payments left the learner with 0 access instead of the 30 days they still paid
-- for. Fix: a refund subtracts 30 days from access_expires_at; access is removed
-- only when nothing remains (a permanent/NULL enrollment, or a window now fully
-- consumed). Identical to the 0029 version otherwise (keeps #variable_conflict).
-- ============================================================

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

  -- Per-month access: this payment granted 30 days, so the refund removes 30
  -- days — not all access (the learner may have stacked several months).
  update enrollments
     set access_expires_at = access_expires_at - interval '30 days'
   where learner_id = _payment.learner_id and course_id = _payment.course_id
     and access_expires_at is not null;
  -- Remove access only when nothing is left: a permanent (NULL) enrollment being
  -- refunded, or a timed window that's now fully in the past.
  delete from enrollments
   where learner_id = _payment.learner_id and course_id = _payment.course_id
     and (access_expires_at is null or access_expires_at <= now());

  insert into admin_audit_log (admin_id, action, target_type, target_id, metadata)
  values (p_admin_id, 'payment.refund', 'payment', _payment.id::text,
          jsonb_build_object('amount_paise', _payment.amount, 'reason', 'admin_refund'));

  return query select true, ''::text, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
end;
$$;
