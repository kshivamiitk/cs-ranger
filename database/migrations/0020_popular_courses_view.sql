-- ============================================================
-- Materialized view for the catalog's hot path. The catalog feed defaults to
-- "popular" sort with no text query — easily 90%+ of catalog requests look
-- like that, and they all hit the same handful of rows. Pre-rank them once,
-- read off the snapshot, refresh on a short cadence.
--
-- The view holds exactly the columns the catalog endpoint already selects
-- plus a `hot_score` that combines:
--   * ln(enrollment_count)   — log-scaled popularity (a 10× bigger course
--                              shouldn't dominate by 10×)
--   * rating_avg * sqrt(rating_count) — quality, weighted so a single
--                              5-star review doesn't outrank a 4.5/200
--   * time decay             — gentle pressure pushing very old courses
--                              gradually down so the feed stays fresh
--
-- Refresh strategy:
--   * Production should schedule REFRESH MATERIALIZED VIEW CONCURRENTLY
--     popular_courses every 5–10 minutes (pg_cron block at the bottom does
--     this if the extension is available).
--   * course-service also calls refresh_popular_courses() right after a
--     publish / unpublish so newly-live courses appear without waiting for
--     the next cron tick. Cheap because the view is tiny.
-- ============================================================

create materialized view if not exists popular_courses as
select
  id, title, subtitle, thumbnail_url, price, discounted_price, rating_avg,
  rating_count, enrollment_count, category_id, language, level, creator_id,
  duration_seconds, published_at,
  (
    ln(greatest(enrollment_count, 1)) * 10
    + (coalesce(rating_avg, 0)::numeric * sqrt(greatest(rating_count, 1)))
    + (extract(epoch from (now() - coalesce(published_at, created_at))) * -0.0000001)
  )::numeric as hot_score
from courses
where status = 'published';

-- Unique index is REQUIRED for REFRESH CONCURRENTLY (no read downtime).
create unique index if not exists idx_popular_courses_id on popular_courses(id);

-- Catalog sort indexes — mirror the live catalog query patterns. id is the
-- tiebreaker so pagination stays stable across pages even when many rows
-- share the primary sort value.
create index if not exists idx_popular_courses_hot     on popular_courses(hot_score desc, id desc);
create index if not exists idx_popular_courses_rating  on popular_courses(rating_avg desc, rating_count desc, id desc);
create index if not exists idx_popular_courses_enroll  on popular_courses(enrollment_count desc, id desc);
create index if not exists idx_popular_courses_cat_hot on popular_courses(category_id, hot_score desc);
create index if not exists idx_popular_courses_price   on popular_courses(price);

-- Manual refresh entrypoint. CONCURRENTLY so readers never see an empty
-- view mid-refresh — costs a bit more I/O but the public catalog cannot go
-- blank for a few seconds during refresh.
create or replace function refresh_popular_courses() returns void
language plpgsql security definer as $$
begin
  refresh materialized view concurrently popular_courses;
end;
$$;

-- Schedule via pg_cron when the extension is present (Supabase ships with
-- it). Wrapped in DO + exception block so this migration still applies
-- cleanly on databases without pg_cron.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Cancel any prior version of the schedule, then install fresh.
    perform cron.unschedule(jobid) from cron.job where jobname = 'refresh_popular_courses';
    perform cron.schedule(
      'refresh_popular_courses',
      '*/10 * * * *',
      $sql$select refresh_popular_courses()$sql$
    );
  end if;
exception when others then null;
end;
$cron$;

-- Initial population — REFRESH NOT CONCURRENTLY is required for the first
-- refresh of a fresh materialized view (CONCURRENTLY needs prior data).
refresh materialized view popular_courses;
