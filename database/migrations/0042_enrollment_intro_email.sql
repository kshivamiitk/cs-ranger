-- ============================================================
-- Enrollment intro email idempotency
-- ============================================================

-- The direct enrollment path and the async notification worker can both try to
-- process the same enrollment. Keep a single enrollment notification per
-- learner/course and use that insert as the "owns email delivery" sentinel.
delete from notifications n
using notifications older
where n.type = 'enrollment'
  and older.type = 'enrollment'
  and n.user_id = older.user_id
  and coalesce(n.href, '') = coalesce(older.href, '')
  and (n.created_at, n.id) > (older.created_at, older.id);

create unique index if not exists idx_notifications_enrollment_once
  on notifications(user_id, href)
  where type = 'enrollment';
