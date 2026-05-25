-- ============================================================
-- Row-Level Security
-- Assumes Supabase auth — auth.uid() returns the JWT sub claim.
-- For non-Supabase deployments, replace with current_setting('app.user_id').
-- ============================================================

-- Helpers
create or replace function has_role(target_role user_role) returns boolean
language sql stable as $$
  select exists(select 1 from user_roles where user_id = auth.uid() and role = target_role);
$$;

create or replace function is_admin() returns boolean
language sql stable as $$
  select has_role('admin');
$$;

-- Make the rest of this file re-runnable. `CREATE POLICY` lacks IF NOT EXISTS
-- before Postgres 17, so a second `apply.sh` run errored on every policy that
-- already existed. Drop every policy in the public schema up front; the file
-- below recreates them all.
do $rls$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$rls$;

-- ====== USERS / PROFILES ======
alter table users    enable row level security;
alter table profiles enable row level security;

create policy users_self_or_admin_read on users
  for select using (id = auth.uid() or is_admin());
create policy users_self_or_admin_update on users
  for update using (id = auth.uid() or is_admin());

-- Profiles: public read, self/admin write
create policy profiles_public_read on profiles for select using (true);
create policy profiles_self_update on profiles
  for update using (user_id = auth.uid() or is_admin());
create policy profiles_self_insert on profiles
  for insert with check (user_id = auth.uid());

alter table user_roles enable row level security;
create policy user_roles_self_read on user_roles for select using (user_id = auth.uid() or is_admin());
create policy user_roles_admin_write on user_roles for all using (is_admin()) with check (is_admin());

alter table subscriptions enable row level security;
create policy subs_self_read on subscriptions for select using (learner_id = auth.uid() or creator_id = auth.uid() or is_admin());
create policy subs_self_write on subscriptions
  for insert with check (learner_id = auth.uid());
create policy subs_self_delete on subscriptions
  for delete using (learner_id = auth.uid());

-- ====== COURSES ======
alter table categories enable row level security;
create policy categories_public_read on categories for select using (true);
create policy categories_admin_write on categories for all using (is_admin()) with check (is_admin());

alter table courses  enable row level security;
alter table modules  enable row level security;
alter table nodes    enable row level security;
alter table node_attachments enable row level security;
alter table reviews  enable row level security;
alter table comments enable row level security;
alter table bookmarks enable row level security;

-- Public can read published courses; creator can read all their own; admin reads all.
create policy courses_read on courses
  for select using (
    status = 'published' or creator_id = auth.uid() or is_admin()
  );
create policy courses_creator_write on courses
  for insert with check (creator_id = auth.uid() and has_role('creator'));
create policy courses_creator_update on courses
  for update using (creator_id = auth.uid() or is_admin());
create policy courses_admin_delete on courses
  for delete using (is_admin());

-- Modules / nodes: visible if parent course is visible
create policy modules_read on modules
  for select using (exists(
    select 1 from courses c where c.id = course_id
      and (c.status = 'published' or c.creator_id = auth.uid() or is_admin())
  ));
create policy modules_owner_write on modules
  for all using (exists(select 1 from courses c where c.id = course_id and (c.creator_id = auth.uid() or is_admin())))
  with check (exists(select 1 from courses c where c.id = course_id and (c.creator_id = auth.uid() or is_admin())));

create policy nodes_read on nodes
  for select using (exists(
    select 1 from modules m join courses c on c.id = m.course_id
    where m.id = module_id and (c.status = 'published' or c.creator_id = auth.uid() or is_admin())
  ));
create policy nodes_owner_write on nodes
  for all using (exists(
    select 1 from modules m join courses c on c.id = m.course_id
    where m.id = module_id and (c.creator_id = auth.uid() or is_admin())
  )) with check (exists(
    select 1 from modules m join courses c on c.id = m.course_id
    where m.id = module_id and (c.creator_id = auth.uid() or is_admin())
  ));

create policy attachments_read on node_attachments for select using (true);
create policy attachments_write on node_attachments
  for all using (exists(
    select 1 from nodes n join modules m on m.id = n.module_id join courses c on c.id = m.course_id
    where n.id = node_id and (c.creator_id = auth.uid() or is_admin())
  ));

-- Reviews: public read, learner can only write their own, must be enrolled.
create policy reviews_read on reviews for select using (true);
create policy reviews_learner_write on reviews
  for insert with check (learner_id = auth.uid() and exists(
    select 1 from enrollments e where e.learner_id = auth.uid() and e.course_id = reviews.course_id
  ));
create policy reviews_self_update on reviews
  for update using (learner_id = auth.uid());
create policy reviews_self_delete on reviews
  for delete using (learner_id = auth.uid() or is_admin());

-- Comments: public read on published courses, authenticated can write
create policy comments_read on comments
  for select using (exists(
    select 1 from nodes n join modules m on m.id = n.module_id join courses c on c.id = m.course_id
    where n.id = node_id and (c.status = 'published' or c.creator_id = auth.uid() or is_admin())
  ));
create policy comments_auth_write on comments
  for insert with check (author_id = auth.uid());
create policy comments_self_or_creator_or_admin on comments
  for update using (
    author_id = auth.uid()
    or is_admin()
    or exists(
      select 1 from nodes n join modules m on m.id = n.module_id join courses c on c.id = m.course_id
      where n.id = node_id and c.creator_id = auth.uid()
    )
  );
create policy comments_self_or_admin_delete on comments
  for delete using (author_id = auth.uid() or is_admin());

-- Bookmarks: each learner sees only their own
create policy bookmarks_self_all on bookmarks
  for all using (learner_id = auth.uid()) with check (learner_id = auth.uid());

-- ====== ENROLLMENTS / PROGRESS ======
alter table enrollments     enable row level security;
alter table node_progress   enable row level security;
alter table quiz_attempts   enable row level security;
alter table learner_notes   enable row level security;

-- Learner sees their own enrollments; creator can see who enrolled in their course; admin sees all.
create policy enrollments_read on enrollments
  for select using (
    learner_id = auth.uid()
    or exists(select 1 from courses c where c.id = course_id and c.creator_id = auth.uid())
    or is_admin()
  );
create policy enrollments_self_write on enrollments
  for insert with check (learner_id = auth.uid());

create policy node_progress_self_all on node_progress
  for all using (learner_id = auth.uid()) with check (learner_id = auth.uid());

create policy quiz_attempts_self on quiz_attempts
  for all using (learner_id = auth.uid() or is_admin()) with check (learner_id = auth.uid());

create policy learner_notes_self on learner_notes
  for all using (learner_id = auth.uid()) with check (learner_id = auth.uid());

-- ====== MONEY ======
alter table razorpay_orders enable row level security;
alter table payments        enable row level security;
alter table wallet_ledger   enable row level security;
alter table creator_balances enable row level security;
alter table kyc_details     enable row level security;
alter table payout_runs     enable row level security;
alter table payout_items    enable row level security;
alter table tds_records     enable row level security;
alter table creator_terms_acceptance enable row level security;

create policy orders_self_read on razorpay_orders
  for select using (learner_id = auth.uid() or is_admin());

create policy payments_self_read on payments
  for select using (learner_id = auth.uid() or is_admin());

-- Wallet ledger: only the creator or admin can read
create policy ledger_owner_read on wallet_ledger
  for select using (creator_id = auth.uid() or is_admin());

create policy balances_owner_read on creator_balances
  for select using (creator_id = auth.uid() or is_admin());

create policy kyc_owner on kyc_details
  for all using (creator_id = auth.uid() or is_admin())
  with check (creator_id = auth.uid() or is_admin());

create policy payout_runs_admin on payout_runs
  for select using (is_admin());

create policy payout_items_read on payout_items
  for select using (creator_id = auth.uid() or is_admin());

create policy tds_owner_read on tds_records
  for select using (creator_id = auth.uid() or is_admin());

create policy terms_self on creator_terms_acceptance
  for all using (creator_id = auth.uid() or is_admin())
  with check (creator_id = auth.uid());

-- ====== NOTIFICATIONS / SUPPORT ======
alter table notifications            enable row level security;
alter table notification_preferences enable row level security;
alter table support_tickets          enable row level security;
alter table ticket_messages          enable row level security;
alter table canned_responses         enable row level security;

create policy notif_self on notifications for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy notif_prefs_self on notification_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy tickets_self_or_admin_read on support_tickets
  for select using (user_id = auth.uid() or is_admin());
create policy tickets_self_create on support_tickets
  for insert with check (user_id = auth.uid());
create policy tickets_admin_update on support_tickets
  for update using (is_admin() or user_id = auth.uid());

create policy ticket_msgs_read on ticket_messages
  for select using (
    is_admin()
    or exists(select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid() and not is_internal_note)
  );
create policy ticket_msgs_write on ticket_messages
  for insert with check (
    author_id = auth.uid()
    and (is_admin() or exists(select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid()))
  );

create policy canned_admin on canned_responses for all using (is_admin()) with check (is_admin());

-- ====== ACHIEVEMENTS ======
alter table badges        enable row level security;
alter table user_badges   enable row level security;
alter table user_streaks  enable row level security;
alter table certificates  enable row level security;

create policy badges_public on badges for select using (true);
create policy badges_admin_write on badges for all using (is_admin()) with check (is_admin());

create policy user_badges_read on user_badges for select using (true);   -- profile pages show badges publicly
create policy streaks_self_read on user_streaks for select using (user_id = auth.uid() or is_admin());

-- Certificate lookup by verification token must be public; downloads gated by ownership at the API layer.
create policy certificates_public_read on certificates for select using (true);

-- ====== ADMIN ======
alter table platform_settings enable row level security;
alter table admin_audit_log   enable row level security;
alter table user_reports      enable row level security;

create policy settings_public_read on platform_settings for select using (true);
create policy settings_admin_write on platform_settings for all using (is_admin()) with check (is_admin());

create policy audit_admin_read on admin_audit_log for select using (is_admin());
create policy audit_admin_insert on admin_audit_log for insert with check (is_admin());

create policy reports_create on user_reports for insert with check (reporter_id = auth.uid());
create policy reports_admin_read on user_reports for select using (is_admin() or reporter_id = auth.uid());
create policy reports_admin_update on user_reports for update using (is_admin());
