-- ============================================================
-- Video chapters + subtitle tracks for video lessons.
-- Owned by: course-service.
--
-- video_chapters:  jsonb array, ordered by ascending "seconds":
--   [{ "title": "Introduction", "seconds": 0 }, { "title": "Setup", "seconds": 95 }, ...]
-- video_subtitles: jsonb array of external caption files (YouTube/Drive embeds
--   cannot take injected <track> elements, so the player offers these as
--   open/download links):
--   [{ "label": "English", "lang": "en", "url": "https://...", "format": "vtt" }, ...]
--
-- Structure is validated in course-service (Zod) on create/patch, mirroring
-- how quiz_payload / static_website are handled. Idempotent.
-- ============================================================

alter table nodes add column if not exists video_chapters  jsonb;
alter table nodes add column if not exists video_subtitles jsonb;
