-- loadtest-cleanup.sql — purge everything created by scripts/loadtest-heavy.mjs.
--
-- Usage:
--   psql "$DATABASE_URL" -v run_id=<RUN_ID> -f scripts/loadtest-cleanup.sql
--   (RUN_ID is printed at the top/bottom of the load-test output)
--
-- To purge EVERY run ever (any leftover test data), pass run_id=% :
--   psql "$DATABASE_URL" -v run_id=% -f scripts/loadtest-cleanup.sql
--
-- Test data is tagged: users  lt_<run_id>_<n>@loadtest.local
--                      courses "LOADTEST-<run_id> ..."
-- Everything runs in one transaction, deleting children before parents, so it
-- either fully cleans up or rolls back untouched. Test accounts are free-only
-- (no payments/KYC/wallet rows), so there's nothing here that moves money.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _lt_users ON COMMIT DROP AS
  SELECT id FROM users WHERE email LIKE 'lt\_' || :'run_id' || '\_%@loadtest.local';

CREATE TEMP TABLE _lt_courses ON COMMIT DROP AS
  SELECT id FROM courses
   WHERE title LIKE 'LOADTEST-' || :'run_id' || ' %'
      OR creator_id IN (SELECT id FROM _lt_users);

CREATE TEMP TABLE _lt_nodes ON COMMIT DROP AS
  SELECT n.id FROM nodes n
   JOIN modules m ON m.id = n.module_id
  WHERE m.course_id IN (SELECT id FROM _lt_courses);

\echo 'test users / courses / nodes matched:'
SELECT (SELECT count(*) FROM _lt_users) AS users,
       (SELECT count(*) FROM _lt_courses) AS courses,
       (SELECT count(*) FROM _lt_nodes) AS nodes;

-- ── children of nodes / courses ─────────────────────────────────────────────
DELETE FROM comment_upvotes WHERE user_id IN (SELECT id FROM _lt_users);
DELETE FROM comments        WHERE node_id IN (SELECT id FROM _lt_nodes) OR author_id IN (SELECT id FROM _lt_users);
DELETE FROM quiz_attempts   WHERE node_id IN (SELECT id FROM _lt_nodes) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM node_progress   WHERE node_id IN (SELECT id FROM _lt_nodes) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM learner_notes   WHERE node_id IN (SELECT id FROM _lt_nodes) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM lesson_bookmarks WHERE course_id IN (SELECT id FROM _lt_courses) OR node_id IN (SELECT id FROM _lt_nodes) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM bookmarks       WHERE course_id IN (SELECT id FROM _lt_courses) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM reviews         WHERE course_id IN (SELECT id FROM _lt_courses) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM certificates    WHERE course_id IN (SELECT id FROM _lt_courses) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM enrollments     WHERE course_id IN (SELECT id FROM _lt_courses) OR learner_id IN (SELECT id FROM _lt_users);
DELETE FROM user_reports    WHERE target_course IN (SELECT id FROM _lt_courses) OR target_node IN (SELECT id FROM _lt_nodes) OR reporter_id IN (SELECT id FROM _lt_users);
DELETE FROM course_collaborators WHERE course_id IN (SELECT id FROM _lt_courses) OR user_id IN (SELECT id FROM _lt_users) OR invited_by IN (SELECT id FROM _lt_users);
DELETE FROM course_edit_locks    WHERE course_id IN (SELECT id FROM _lt_courses) OR held_by IN (SELECT id FROM _lt_users);

-- ── course tree ─────────────────────────────────────────────────────────────
DELETE FROM nodes   WHERE id IN (SELECT id FROM _lt_nodes);
DELETE FROM modules WHERE course_id IN (SELECT id FROM _lt_courses);
DELETE FROM courses WHERE id IN (SELECT id FROM _lt_courses);

-- ── per-user data ───────────────────────────────────────────────────────────
DELETE FROM subscriptions WHERE learner_id IN (SELECT id FROM _lt_users) OR creator_id IN (SELECT id FROM _lt_users);
DELETE FROM notifications WHERE user_id IN (SELECT id FROM _lt_users);
DELETE FROM creator_terms_acceptance WHERE creator_id IN (SELECT id FROM _lt_users);
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM _lt_users);
DELETE FROM user_roles WHERE user_id IN (SELECT id FROM _lt_users);
DELETE FROM profiles  WHERE user_id IN (SELECT id FROM _lt_users);
DELETE FROM users     WHERE id IN (SELECT id FROM _lt_users);

COMMIT;
\echo 'cleanup complete.'
