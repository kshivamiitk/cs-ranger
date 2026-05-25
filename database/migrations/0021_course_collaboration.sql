-- ============================================================
-- Course collaboration: owner + N accepted collaborators per course.
-- Single-writer lock — only one editor at a time, expires on idle.
-- See Docs/collaboration.md for the full design rationale.
-- ============================================================

-- Enums
do $$ begin
  create type collaborator_status as enum ('pending', 'accepted', 'declined', 'removed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type collaborator_role as enum ('editor');
exception when duplicate_object then null;
end $$;

-- ─── course_collaborators ─────────────────────────────────────────
create table if not exists course_collaborators (
  course_id     uuid not null references courses(id) on delete cascade,
  user_id       uuid not null references users(id)   on delete cascade,
  status        collaborator_status not null default 'pending',
  role          collaborator_role   not null default 'editor',
  invited_by    uuid not null references users(id)   on delete restrict,
  invited_at    timestamptz not null default now(),
  responded_at  timestamptz,
  primary key (course_id, user_id)
);

-- "Invitations sent to me" / "active collaborations for me" lookups.
create index if not exists idx_course_collaborators_user_status
  on course_collaborators(user_id, status, invited_at desc);

-- "Who collaborates on this course" lookups.
create index if not exists idx_course_collaborators_course_status
  on course_collaborators(course_id, status);

-- ─── course_edit_locks ────────────────────────────────────────────
-- One row per locked course. Absence = unlocked.
create table if not exists course_edit_locks (
  course_id          uuid primary key references courses(id) on delete cascade,
  held_by            uuid not null references users(id)      on delete cascade,
  acquired_at        timestamptz not null default now(),
  last_heartbeat_at  timestamptz not null default now(),
  expires_at         timestamptz not null
);

create index if not exists idx_course_edit_locks_user on course_edit_locks(held_by);

-- ─── acquire_course_lock (atomic) ─────────────────────────────────
-- One SQL statement decides: extend if mine, steal if expired, otherwise
-- leave whoever's holding it alone. Returning the resulting row lets the
-- caller know whether they got the lock without a second query.
create or replace function acquire_course_lock(p_course_id uuid, p_user_id uuid)
returns table (outcome text, held_by uuid, expires_at timestamptz, holder_name text)
language plpgsql security definer as $$
declare
  _new_expires timestamptz := now() + interval '10 minutes';
  _final_holder uuid;
  _final_expires timestamptz;
  _holder_name text;
begin
  insert into course_edit_locks (course_id, held_by, acquired_at, last_heartbeat_at, expires_at)
  values (p_course_id, p_user_id, now(), now(), _new_expires)
  on conflict (course_id) do update
    set
      held_by           = case
                            when course_edit_locks.held_by = excluded.held_by then excluded.held_by
                            when course_edit_locks.expires_at < now()          then excluded.held_by
                            else course_edit_locks.held_by
                          end,
      last_heartbeat_at = case
                            when course_edit_locks.held_by = excluded.held_by then excluded.last_heartbeat_at
                            when course_edit_locks.expires_at < now()          then excluded.last_heartbeat_at
                            else course_edit_locks.last_heartbeat_at
                          end,
      acquired_at       = case
                            when course_edit_locks.expires_at < now() and course_edit_locks.held_by <> excluded.held_by
                              then excluded.acquired_at
                            else course_edit_locks.acquired_at
                          end,
      expires_at        = case
                            when course_edit_locks.held_by = excluded.held_by then excluded.expires_at
                            when course_edit_locks.expires_at < now()          then excluded.expires_at
                            else course_edit_locks.expires_at
                          end
  returning course_edit_locks.held_by, course_edit_locks.expires_at into _final_holder, _final_expires;

  select coalesce(p.display_name, 'Someone') into _holder_name
    from profiles p where p.user_id = _final_holder;

  return query select
    case when _final_holder = p_user_id then 'acquired' else 'held_by_other' end,
    _final_holder,
    _final_expires,
    _holder_name;
end;
$$;

-- ─── course_editors view ──────────────────────────────────────────
-- Unified list of "who is allowed to edit this course" — the owner plus any
-- accepted collaborator. Lets call sites query a single source of truth
-- instead of UNIONing in application code.
create or replace view course_editors as
select c.id as course_id, c.creator_id as user_id, 'owner'::text as role
from courses c
union all
select cc.course_id, cc.user_id, cc.role::text
from course_collaborators cc
where cc.status = 'accepted';

-- ─── RLS ──────────────────────────────────────────────────────────
-- Service-role bypasses RLS (the backend uses it), so these policies are
-- belt-and-suspenders for direct-Supabase reads. Backend enforces its own
-- checks via assertCanEditCourse() in course-service.
alter table course_collaborators enable row level security;
alter table course_edit_locks    enable row level security;

-- 0010_rls.sql drops all public-schema policies on re-run, so we mirror its
-- "drop if exists; create" pattern to stay idempotent on its terms too.
drop policy if exists course_collaborators_read on course_collaborators;
create policy course_collaborators_read on course_collaborators
  for select using (
    user_id = auth.uid()
    or exists (select 1 from courses c where c.id = course_id and c.creator_id = auth.uid())
    or is_admin()
  );

drop policy if exists course_collaborators_owner_write on course_collaborators;
create policy course_collaborators_owner_write on course_collaborators
  for all using (
    exists (select 1 from courses c where c.id = course_id and c.creator_id = auth.uid())
    or is_admin()
  );

drop policy if exists course_collaborators_self_update on course_collaborators;
create policy course_collaborators_self_update on course_collaborators
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists course_edit_locks_editor_read on course_edit_locks;
create policy course_edit_locks_editor_read on course_edit_locks
  for select using (
    exists (select 1 from course_editors e where e.course_id = course_edit_locks.course_id and e.user_id = auth.uid())
    or is_admin()
  );

drop policy if exists course_edit_locks_editor_write on course_edit_locks;
create policy course_edit_locks_editor_write on course_edit_locks
  for all using (
    exists (select 1 from course_editors e where e.course_id = course_edit_locks.course_id and e.user_id = auth.uid())
    or is_admin()
  );
