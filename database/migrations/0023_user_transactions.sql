-- ============================================================
-- Unified user-facing transactions log.
--
-- One row per spending event for any user, no matter which kind of
-- purchase. Today that's:
--   * course payments  (learner buys a course)
--   * storage purchases (creator buys MB)
-- New revenue lines just add a UNION arm here — the frontend's
-- /transactions page never has to change.
--
-- Stored as a view (not a table) so we don't have to maintain a
-- counter or replicate rows. PostgREST can sort + paginate it like
-- any table. If it ever becomes a hot read with millions of rows,
-- swap to MATERIALIZED VIEW with a periodic refresh — same SQL.
-- ============================================================

create or replace view user_transactions as
select
  p.id::text                                 as id,
  p.learner_id                               as user_id,
  'course'::text                             as kind,
  p.amount                                   as amount_paise,
  p.currency,
  p.status::text                             as status,
  coalesce(c.title, 'Course purchase')       as description,
  p.course_id::text                          as reference_id,
  p.razorpay_order_id,
  p.razorpay_payment_id,
  p.created_at
from payments p
left join courses c on c.id = p.course_id

union all

select
  sp.id::text                                as id,
  sp.creator_id                              as user_id,
  'storage'::text                            as kind,
  sp.amount_paise                            as amount_paise,
  'INR'::text                                as currency,
  sp.status                                  as status,
  (sp.mb || ' MB storage')                   as description,
  null::text                                 as reference_id,
  sp.razorpay_order_id,
  sp.razorpay_payment_id,
  sp.created_at
from storage_purchases sp;
