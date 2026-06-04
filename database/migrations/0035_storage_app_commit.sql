-- ============================================================
-- Storage usage: account in the application layer.
--
-- Bug: creator_storage.bytes_used was kept in sync ONLY by the
-- bump_creator_storage() trigger on storage.objects, which read the file size
-- from `coalesce((new.metadata->>'size')::bigint, 0)`. PDFs are uploaded
-- straight from the browser to Supabase via a signed upload URL, and for that
-- flow `metadata->>'size'` is frequently absent at INSERT time (the trigger has
-- no AFTER UPDATE branch to catch it later) — and creating triggers on
-- storage.objects needs storage-schema privileges that don't always apply. The
-- result: every PDF added 0 bytes, so creators always saw "0 MB used".
--
-- Fix: the course-service already knows the exact size (the client sends it
-- when reserving the upload at /uploads/pdf-url), so it now commits the bytes
-- directly via commit_storage() once the upload is confirmed. The
-- storage.objects trigger is neutralised so it can't double-count if a future
-- Supabase version starts populating metadata.size at INSERT.
-- ============================================================

-- Commit confirmed bytes into a creator's usage and release the matching
-- reservation made in reserve_storage(). This is what the trigger was meant to
-- do, now driven by the application which actually knows the size.
create or replace function commit_storage(p_creator_id uuid, p_bytes bigint)
returns void language plpgsql security definer as $$
begin
  if p_bytes is null or p_bytes <= 0 then return; end if;
  insert into creator_storage (creator_id, bytes_used, pending_bytes, extra_bytes, updated_at)
  values (p_creator_id, p_bytes, 0, 0, now())
  on conflict (creator_id) do update set
    bytes_used    = creator_storage.bytes_used + excluded.bytes_used,
    -- Drain the reservation; greatest(...,0) avoids going negative if the file
    -- arrived smaller than what was reserved.
    pending_bytes = greatest(creator_storage.pending_bytes - excluded.bytes_used, 0),
    updated_at    = now();
end;
$$;

-- Symmetric release for when a PDF is removed/replaced (floors at zero).
create or replace function release_storage(p_creator_id uuid, p_bytes bigint)
returns void language plpgsql security definer as $$
begin
  if p_bytes is null or p_bytes <= 0 then return; end if;
  update creator_storage
     set bytes_used = greatest(bytes_used - p_bytes, 0),
         updated_at = now()
   where creator_id = p_creator_id;
end;
$$;

-- Neutralise the storage.objects trigger: accounting now lives in the app, so
-- this must NOT also add bytes (that would double-count). Replacing the function
-- only touches the public schema — no storage-schema privileges required — and
-- the existing trg_creator_storage_changes trigger keeps pointing at it.
create or replace function bump_creator_storage() returns trigger
language plpgsql security definer as $$
begin
  -- No-op: creator_storage is maintained by commit_storage() / release_storage().
  return null;
end;
$$;

-- The broken trigger drained reservations by 0, so pending_bytes accumulated
-- phantom values that wrongly count against the quota. Clear them once; any
-- genuinely in-flight upload is a few minutes old at most and self-heals.
update creator_storage set pending_bytes = 0, updated_at = now() where pending_bytes > 0;
