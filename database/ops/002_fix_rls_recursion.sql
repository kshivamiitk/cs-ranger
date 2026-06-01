-- ============================================================
-- Fix RLS infinite recursion → "stack depth limit exceeded" (SQLSTATE 54001).
--
-- `has_role()` runs `select ... from user_roles`, and the user_roles SELECT
-- policy is `(user_id = auth.uid()) OR is_admin()` → is_admin() → has_role() →
-- reads user_roles → re-triggers the policy → … infinite recursion. Any anon/
-- authenticated read of a table whose policy calls is_admin()/has_role() 500s.
-- (The backend uses the service_role key, which bypasses RLS, so this only bit
-- direct anon/authenticated reads — e.g. the public site.)
--
-- Fix: mark the two role-check helpers SECURITY DEFINER with a locked
-- search_path. They then run as the owner (postgres, the table owner, which is
-- not subject to RLS since FORCE ROW LEVEL SECURITY is off), so their internal
-- read of user_roles does NOT re-enter the policy. Standard Supabase pattern.
--
-- Idempotent: plain CREATE OR REPLACE. Safe to re-run.
-- ============================================================

create or replace function public.has_role(target_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = target_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_role('admin');
$$;
