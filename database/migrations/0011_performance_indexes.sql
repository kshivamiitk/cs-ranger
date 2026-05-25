-- ============================================================
-- Performance-critical indexes for hot paths
-- All p95 < 50ms targets in design.md §6.3 depend on these.
-- ============================================================

-- Course catalog: sort by enrollment_count, filter by status (covered by composite)
create index if not exists idx_courses_status_enrollment on courses(status, enrollment_count desc) where status = 'published';
create index if not exists idx_courses_status_rating     on courses(status, rating_avg desc)        where status = 'published';
create index if not exists idx_courses_status_published_at on courses(status, published_at desc)   where status = 'published';
create index if not exists idx_courses_status_price      on courses(status, price)                  where status = 'published';

-- Course detail aggregation: parent → children
create index if not exists idx_modules_course_position   on modules(course_id, position);
create index if not exists idx_nodes_module_position     on nodes(module_id, position);

-- Per-learner hot queries
create index if not exists idx_enrollments_learner_last  on enrollments(learner_id, last_accessed_at desc);
create index if not exists idx_enrollments_course_enrolled_at on enrollments(course_id, enrolled_at desc);
create index if not exists idx_node_progress_learner_completed_at on node_progress(learner_id, completed_at desc) where is_completed = true;

-- Comments / doubts: most-recent ordering per node, plus author lookup
create index if not exists idx_comments_node_upvotes     on comments(node_id, upvotes desc, created_at desc);
create index if not exists idx_comments_author_unresolved on comments(author_id, is_resolved) where parent_id is null;

-- Reviews aggregation by course
create index if not exists idx_reviews_course_rating     on reviews(course_id, rating);

-- Payments: status + recent (for analytics)
create index if not exists idx_payments_success_created  on payments(status, created_at desc) where status = 'success';
create index if not exists idx_payments_learner_status   on payments(learner_id, status);

-- Wallet ledger: per-creator type breakdown for analytics
create index if not exists idx_ledger_creator_type_created on wallet_ledger(creator_id, type, created_at desc);

-- Notifications: unread-count is the most-called endpoint
create index if not exists idx_notifications_user_unread_v2 on notifications(user_id, created_at desc) where is_read = false;

-- Payouts: admin "failed payouts" view
create index if not exists idx_payout_items_failed       on payout_items(status, created_at desc) where status = 'failed';

-- Subscriptions: creator's subscriber count
create index if not exists idx_subscriptions_creator_v2  on subscriptions(creator_id, created_at desc);

-- Support tickets: admin dashboard
create index if not exists idx_tickets_status_updated    on support_tickets(status, updated_at desc);
create index if not exists idx_tickets_assigned          on support_tickets(assigned_admin_id, updated_at desc) where assigned_admin_id is not null;

-- Quiz attempts: report card per-learner
create index if not exists idx_quiz_attempts_learner_node on quiz_attempts(learner_id, node_id, attempted_at desc);

-- ANALYZE everything we touched so the planner picks up the new indexes immediately
analyze courses;
analyze modules;
analyze nodes;
analyze enrollments;
analyze node_progress;
analyze comments;
analyze reviews;
analyze payments;
analyze wallet_ledger;
analyze notifications;
analyze payout_items;
analyze subscriptions;
analyze support_tickets;
analyze quiz_attempts;
