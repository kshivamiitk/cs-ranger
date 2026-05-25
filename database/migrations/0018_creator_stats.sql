-- ============================================================
-- Creator directory aggregate. A SQL view so PostgREST/Supabase can sort and
-- paginate by any column without an extra round trip. The aggregates use
-- correlated sub-selects rather than GROUP BY so creators with zero
-- subscriptions/courses still show up (LEFT JOIN-style behaviour) without
-- duplicating profile rows.
--
-- Scale plan: at low/medium creator counts the per-row sub-selects are fine
-- with the existing indexes (idx_subscriptions_creator, idx_courses_creator,
-- idx_courses_status_*). If creator count goes past ~100k or the directory
-- becomes a hot read, swap this to a MATERIALIZED VIEW refreshed every few
-- minutes (CONCURRENTLY) — same SQL, different storage.
-- ============================================================

create or replace view creator_stats as
select
  p.user_id, p.display_name, p.username, p.bio, p.college, p.avatar_url,
  coalesce((select count(*)::int from subscriptions s where s.creator_id = p.user_id), 0) as subscriber_count,
  coalesce((select count(*)::int from courses c where c.creator_id = p.user_id and c.status = 'published'), 0) as course_count,
  coalesce((select sum(c.enrollment_count)::int from courses c where c.creator_id = p.user_id and c.status = 'published'), 0) as total_enrollments,
  coalesce(
    (select round(avg(c.rating_avg)::numeric, 2)
       from courses c
      where c.creator_id = p.user_id and c.status = 'published' and c.rating_count > 0),
    0
  ) as avg_rating
from profiles p
where exists (select 1 from user_roles ur where ur.user_id = p.user_id and ur.role = 'creator');
