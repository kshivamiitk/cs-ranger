-- ============================================================
-- 0036_course_write_check — one-round-trip write authorization.
--
-- The write paths (create/patch/delete module & node) previously did 2-3
-- SEQUENTIAL Supabase round-trips just to authorize a write: read courses for
-- the owner, maybe read course_collaborators, then read course_edit_locks.
-- Over a high-latency app→DB link that dominated write latency and capped
-- throughput (see the load test). This folds all of it into a single STABLE
-- read function so assertCanWriteCourse() needs exactly one round-trip.
--
-- Pure read — no mutation. Returns the caller's editor role (matching the old
-- courseEditorRole output: 'owner' | 'collaborator' | null) plus the current
-- edit-lock state, so the JS can reproduce the exact WriteCheck contract
-- (NOT_EDITOR / LOCK_REQUIRED / LOCK_HELD_BY_OTHER). Admins keep their
-- zero-query fast path in JS and never call this.
-- ============================================================

create or replace function course_write_check(p_course_id uuid, p_user_id uuid)
returns table (
  role             text,          -- 'owner' | 'collaborator' | null
  lock_held_by     uuid,
  lock_expires_at  timestamptz,
  lock_holder_name text,
  lock_expired     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when e.role = 'owner'   then 'owner'
      when e.role is not null  then 'collaborator'  -- course_editors gives 'editor' for collaborators
      else null
    end                                   as role,
    l.held_by                             as lock_held_by,
    l.expires_at                          as lock_expires_at,
    coalesce(p.display_name, 'Someone')   as lock_holder_name,
    coalesce(l.expires_at < now(), true)  as lock_expired
  -- (select 1) base row guarantees exactly one result row even when the course
  -- doesn't exist / the user isn't an editor / there's no lock — the caller then
  -- sees role=null and treats it as NOT_EDITOR, exactly like the old code path.
  from (select 1) base
  left join course_editors    e on e.course_id = p_course_id and e.user_id = p_user_id
  left join course_edit_locks l on l.course_id = p_course_id
  left join profiles          p on p.user_id   = l.held_by;
$$;
