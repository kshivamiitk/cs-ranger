-- ============================================================
-- Public rebrand to LearnRift.
--
-- Existing databases already have platform_settings.site_name because
-- 0008 inserts it with ON CONFLICT DO NOTHING. Update the persisted setting
-- so emails, certificates, statements and admin settings read the new brand.
-- ============================================================

update platform_settings
set value = '"LearnRift"'::jsonb,
    description = coalesce(description, 'Public site name'),
    updated_at = now()
where key = 'site_name';
