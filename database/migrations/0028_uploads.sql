-- ============================================================
-- Storage upload pipeline: avatars, course thumbnails, node attachments.
-- Owned by: user-service (avatars) + course-service (course/node assets).
--
-- The lesson-PDF bucket (node-pdfs, migrations 0016/0017) and the certificate
-- bucket (0027) are unchanged; the 0022 quota trigger is scoped to node-pdfs
-- so these new buckets do not count against creator storage quotas.
-- ============================================================

-- ====== Buckets ======
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-assets', 'course-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Attachments are private — learners read them through short-lived signed URLs
-- handed out by course-service (enrollment/editor gated).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('node-attachments', 'node-attachments', false, 26214400, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ====== Upload metadata ======
create table if not exists uploaded_assets (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references users(id) on delete cascade,
  bucket             text not null,
  path               text not null,
  original_filename  text not null,
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes >= 0),
  entity_type        text,                      -- 'avatar' | 'course_thumbnail' | 'node_attachment'
  entity_id          text,                      -- profile user_id, course id, node id
  created_at         timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists idx_uploaded_assets_owner  on uploaded_assets(owner_id, created_at desc);
create index if not exists idx_uploaded_assets_entity on uploaded_assets(entity_type, entity_id);

alter table uploaded_assets enable row level security;
drop policy if exists uploaded_assets_owner_read on uploaded_assets;
create policy uploaded_assets_owner_read on uploaded_assets
  for select using (owner_id = auth.uid() or is_admin());
drop policy if exists uploaded_assets_owner_write on uploaded_assets;
create policy uploaded_assets_owner_write on uploaded_assets
  for all using (owner_id = auth.uid() or is_admin()) with check (owner_id = auth.uid() or is_admin());
