-- ============================================================
-- profiles.is_admin — grant/revoke admin straight from the database.
--
-- Flip this boolean on a profile row (SQL or the Supabase table editor) and a
-- trigger keeps user_roles in sync:
--   is_admin = true  → grants admin (and learner + creator, since an admin is both)
--   is_admin = false → revokes admin only (leaves learner/creator intact)
-- No application code change is needed — the existing auth flow reads user_roles,
-- so the change takes effect on the user's next login.
-- ============================================================

alter table profiles add column if not exists is_admin boolean not null default false;

-- Sync function: reconcile user_roles with profiles.is_admin.
create or replace function sync_admin_role() returns trigger language plpgsql as $$
begin
  if new.is_admin then
    insert into user_roles (user_id, role) values
      (new.user_id, 'learner'),
      (new.user_id, 'creator'),
      (new.user_id, 'admin')
    on conflict (user_id, role) do nothing;
  else
    delete from user_roles where user_id = new.user_id and role = 'admin';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_sync_admin on profiles;
create trigger trg_profiles_sync_admin
  after insert or update of is_admin on profiles
  for each row execute function sync_admin_role();

-- Backfill: reflect existing admins into the new column. This fires the trigger,
-- which also ensures each existing admin holds learner + creator.
update profiles p set is_admin = true
where is_admin = false
  and exists (select 1 from user_roles r where r.user_id = p.user_id and r.role = 'admin');
