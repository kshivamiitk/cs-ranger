-- ============================================================
-- Lock down the lesson PDF bucket: flip to private so the public CDN URL
-- (.../object/public/node-pdfs/...) stops resolving. Access now goes through
-- short-lived signed URLs minted by course-service after an enrollment check.
-- The bucket-level MIME + size limits stay.
-- ============================================================

update storage.buckets set public = false where id = 'node-pdfs';
