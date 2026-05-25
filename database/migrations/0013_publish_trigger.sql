-- ============================================================
-- Auto-stamp courses.published_at when status flips to 'published'.
-- Lets the creator hit a "Publish" button without the service layer
-- having to compute the timestamp. Re-publishing a course preserves
-- the original published_at (only sets when currently NULL), so the
-- "since when" badge on the catalog stays accurate.
-- ============================================================

create or replace function set_course_published_at() returns trigger language plpgsql as $$
begin
  if new.status = 'published'
     and (old.status is distinct from 'published')
     and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_courses_published_at on courses;
create trigger trg_courses_published_at before update of status on courses
  for each row execute function set_course_published_at();
