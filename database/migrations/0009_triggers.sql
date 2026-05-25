-- ============================================================
-- Derived-counter triggers and progress recompute helpers
-- ============================================================

-- Keep courses.enrollment_count in sync
create or replace function bump_enrollment_count() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update courses set enrollment_count = enrollment_count + 1 where id = new.course_id;
  elsif tg_op = 'DELETE' then
    update courses set enrollment_count = greatest(enrollment_count - 1, 0) where id = old.course_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_enrollments_count on enrollments;
create trigger trg_enrollments_count after insert or delete on enrollments
  for each row execute function bump_enrollment_count();

-- Keep courses.rating_avg / rating_count in sync
create or replace function refresh_course_rating() returns trigger language plpgsql as $$
declare
  v_course uuid;
begin
  v_course := coalesce(new.course_id, old.course_id);
  update courses c set
    rating_avg = coalesce((select avg(rating)::numeric(3,2) from reviews where course_id = v_course), 0),
    rating_count = (select count(*) from reviews where course_id = v_course)
  where c.id = v_course;
  return null;
end $$;

drop trigger if exists trg_reviews_refresh on reviews;
create trigger trg_reviews_refresh after insert or update or delete on reviews
  for each row execute function refresh_course_rating();

-- When a node is marked complete, bump enrollment.progress_percent atomically
create or replace function recompute_enrollment_progress() returns trigger language plpgsql as $$
declare
  v_course uuid;
  v_total int;
  v_done int;
  v_percent int;
begin
  select m.course_id into v_course from nodes n join modules m on m.id = n.module_id where n.id = new.node_id;
  if v_course is null then return new; end if;

  select count(*) into v_total
    from nodes n join modules m on m.id = n.module_id where m.course_id = v_course;

  select count(*) into v_done
    from node_progress np
    join nodes n on n.id = np.node_id
    join modules m on m.id = n.module_id
    where np.learner_id = new.learner_id and m.course_id = v_course and np.is_completed = true;

  v_percent := case when v_total = 0 then 0 else round((v_done::numeric / v_total) * 100)::int end;

  update enrollments
    set progress_percent = v_percent,
        completed_at = case when v_percent = 100 and completed_at is null then now() else completed_at end,
        last_node_id = new.node_id,
        last_accessed_at = now()
    where learner_id = new.learner_id and course_id = v_course;

  return new;
end $$;

drop trigger if exists trg_node_progress_recompute on node_progress;
create trigger trg_node_progress_recompute after insert or update on node_progress
  for each row when (new.is_completed = true)
  execute function recompute_enrollment_progress();
