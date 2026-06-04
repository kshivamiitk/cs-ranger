-- ============================================================
-- 0030 — Per-month course access.
--
-- Course price is now "per 30 days". Each successful payment grants/extends
-- 30 days of access. Model:
--   * access_expires_at NULL  → PERMANENT access. All pre-existing enrollments
--     get NULL (grandfathered — we never revoke what they already bought), and
--     free-course enrollments stay NULL too.
--   * access_expires_at set   → access ends at that instant; re-purchase stacks
--     another 30 days on whatever is left (or from now if already lapsed).
--
-- Additive: just adds a nullable column + re-creates verify_payment. No existing
-- row changes (NULL = permanent), so no buyer loses access.
-- ============================================================

alter table enrollments add column if not exists access_expires_at timestamptz;

comment on column enrollments.access_expires_at is
  'When timed access ends. NULL = permanent (grandfathered pre-subscription buyers + free courses).';

-- Re-create verify_payment: identical to 0029 (keeps #variable_conflict
-- use_column) except the enrollment row now carries a 30-day access window that
-- stacks on re-purchase and never downgrades a permanent (NULL) enrollment.
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

  if _payment.status in ('success', 'refunded') then
    return query select false, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  update payments set
    razorpay_payment_id = p_payment_id,
    status              = 'success',
    webhook_event_id    = coalesce(p_webhook_event_id, webhook_event_id),
    updated_at          = now()
  where id = _payment.id and status in ('pending', 'failed');
  get diagnostics _updated = row_count;

  if _updated = 0 then
    return query select false, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
    return;
  end if;

  update razorpay_orders set status = 'success' where razorpay_order_id = p_order_id;

  -- Per-month access: 30 days per payment. New enrollment → 30 days from now;
  -- re-purchase → stack 30 days onto remaining time (or from now if lapsed).
  -- A permanent (NULL) enrollment is never downgraded to a timed window.
  insert into enrollments (learner_id, course_id, progress_percent, access_expires_at)
  values (_payment.learner_id, _payment.course_id, 0, now() + interval '30 days')
  on conflict (learner_id, course_id) do update set
    access_expires_at = case
      when enrollments.access_expires_at is null then null
      else greatest(enrollments.access_expires_at, now()) + interval '30 days'
    end;

  select creator_id into _course from courses where id = _payment.course_id;
  _commission := floor(_payment.amount * p_commission_rate);
  _net        := _payment.amount - _commission;
  insert into wallet_ledger (creator_id, type, amount, reference_id, notes) values
    (_course.creator_id, 'enrollment_credit', _net,        _payment.id::text, 'Enrollment payment ' || _payment.id::text),
    (_course.creator_id, 'commission_debit',  -_commission, _payment.id::text, 'Platform commission');

  return query select true, _payment.id, _payment.course_id, _payment.learner_id, _payment.amount;
end;
$$;
