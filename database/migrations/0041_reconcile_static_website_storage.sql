-- ============================================================
-- Reconcile static website storage counters.
--
-- Older course deletion relied on ON DELETE CASCADE from courses -> modules ->
-- nodes. The static-site storage trigger runs on node delete, but once the
-- parent module/course is already being cascaded it may fail to resolve the
-- creator and therefore leave creator_storage.static_website_bytes stale.
--
-- Recompute this component from live nodes for every creator_storage row,
-- including creators who now have zero static website lessons.
-- ============================================================

with current_static as (
  select
    c.creator_id,
    coalesce(sum(static_website_payload_bytes(n.static_website)), 0)::bigint as bytes
  from nodes n
  join modules m on m.id = n.module_id
  join courses c on c.id = m.course_id
  where n.type = 'static_website'
  group by c.creator_id
)
update creator_storage cs
   set bytes_used = greatest(cs.bytes_used + (coalesce(cur.bytes, 0)::bigint - cs.static_website_bytes), 0),
       static_website_bytes = coalesce(cur.bytes, 0)::bigint,
       updated_at = now()
  from creator_storage existing
  left join current_static cur on cur.creator_id = existing.creator_id
 where cs.creator_id = existing.creator_id
   and cs.static_website_bytes <> coalesce(cur.bytes, 0)::bigint;
