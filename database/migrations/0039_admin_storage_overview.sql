-- ============================================================
-- Admin storage overview.
--
-- Gives admins one source of truth for database size, Supabase Storage object
-- bytes, tracked upload metadata, and billable creator-storage counters.
-- The API layer enforces admin access before calling this function.
-- ============================================================

create or replace function admin_storage_overview()
returns jsonb
language plpgsql
security definer
as $$
declare
  _storage_total bigint := 0;
  _storage_count bigint := 0;
  _storage_by_bucket jsonb := '[]'::jsonb;
  _asset_total bigint := 0;
  _asset_count bigint := 0;
  _asset_by_bucket jsonb := '[]'::jsonb;
  _creator_bytes bigint := 0;
  _static_bytes bigint := 0;
  _pending_bytes bigint := 0;
  _purchased_active_bytes bigint := 0;
begin
  select
    coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0),
    count(*)
  into _storage_total, _storage_count
  from storage.objects;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket', bucket_id,
    'bytes', bytes,
    'objects', objects
  ) order by bytes desc), '[]'::jsonb)
  into _storage_by_bucket
  from (
    select
      bucket_id,
      coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)::bigint as bytes,
      count(*)::bigint as objects
    from storage.objects
    group by bucket_id
  ) b;

  select coalesce(sum(size_bytes), 0), count(*)
  into _asset_total, _asset_count
  from uploaded_assets;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket', bucket,
    'bytes', bytes,
    'objects', objects
  ) order by bytes desc), '[]'::jsonb)
  into _asset_by_bucket
  from (
    select bucket, coalesce(sum(size_bytes), 0)::bigint as bytes, count(*)::bigint as objects
    from uploaded_assets
    group by bucket
  ) b;

  select
    coalesce(sum(bytes_used), 0),
    coalesce(sum(static_website_bytes), 0),
    coalesce(sum(pending_bytes), 0),
    coalesce(sum(case when extra_until > now() then extra_bytes else 0 end), 0)
  into _creator_bytes, _static_bytes, _pending_bytes, _purchased_active_bytes
  from creator_storage;

  return jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'supabaseStorageBytes', _storage_total,
    'supabaseStorageObjects', _storage_count,
    'supabaseStorageByBucket', _storage_by_bucket,
    'trackedUploadBytes', _asset_total,
    'trackedUploadObjects', _asset_count,
    'trackedUploadByBucket', _asset_by_bucket,
    'creatorStorageBytes', _creator_bytes,
    'staticWebsiteBytes', _static_bytes,
    'pendingUploadBytes', _pending_bytes,
    'activePurchasedBytes', _purchased_active_bytes,
    'generatedAt', now()
  );
end;
$$;
