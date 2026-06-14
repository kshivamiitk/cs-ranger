-- ============================================================
-- Course-level certificate settings.
--
-- Certificates already exist and are issued by achievement-service. These
-- fields let a creator customize the PDF copy and tighten/loosen eligibility
-- without changing service code per course.
-- ============================================================

alter table courses
  add column if not exists certificate_min_progress integer not null default 100
    check (certificate_min_progress between 1 and 100),
  add column if not exists certificate_require_quiz_pass boolean not null default false,
  add column if not exists certificate_template jsonb not null default '{}'::jsonb;

update courses
   set certificate_min_progress = 100
 where certificate_min_progress is null;

update courses
   set certificate_require_quiz_pass = false
 where certificate_require_quiz_pass is null;

update courses
   set certificate_template = '{}'::jsonb
 where certificate_template is null;
