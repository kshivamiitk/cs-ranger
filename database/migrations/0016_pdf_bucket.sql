-- ============================================================
-- Storage bucket for lesson PDFs.
--   - public read (lessons are reachable via the public Supabase CDN)
--   - PDF-only MIME allowlist (rejects images/videos at the storage layer)
--   - 25 MiB per-file cap (covers most papers/handouts; large textbooks
--     should be split or hosted externally)
-- Uploads happen via signed URLs the course-service hands out; learners get
-- the resulting public URL embedded in the lesson.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('node-pdfs', 'node-pdfs', true, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
