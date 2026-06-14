-- ============================================================
-- Count static website lesson payloads in creator storage.
--
-- Static website nodes are saved directly in nodes.static_website as JSONB
-- ({ html, css, js }). They do not pass through Supabase Storage or the
-- upload routes, so the existing app-side commit_storage() accounting never
-- sees them. Keep creator_storage.bytes_used in sync from the database row
-- itself, using the UTF-8 byte size of the JSON payload.
-- ============================================================

alter table creator_storage
  add column if not exists static_website_bytes bigint not null default 0 check (static_website_bytes >= 0);

create or replace function static_website_payload_bytes(p_payload jsonb)
returns bigint language sql immutable as $$
  select case
    when p_payload is null then 0::bigint
    else octet_length(p_payload::text)::bigint
  end;
$$;

create or replace function bump_static_website_storage()
returns trigger language plpgsql security definer as $$
declare
  _creator uuid;
  _old_bytes bigint := 0;
  _new_bytes bigint := 0;
  _delta bigint := 0;
begin
  if tg_op = 'INSERT' then
    if new.type <> 'static_website' then return new; end if;
    _new_bytes := static_website_payload_bytes(new.static_website);
    if _new_bytes = 0 then return new; end if;

    select c.creator_id into _creator
      from modules m
      join courses c on c.id = m.course_id
     where m.id = new.module_id;
    if _creator is null then return new; end if;

    insert into creator_storage (creator_id, bytes_used, pending_bytes, extra_bytes, static_website_bytes, updated_at)
    values (_creator, _new_bytes, 0, 0, _new_bytes, now())
    on conflict (creator_id) do update set
      bytes_used = creator_storage.bytes_used + excluded.bytes_used,
      static_website_bytes = creator_storage.static_website_bytes + excluded.bytes_used,
      updated_at = now();
    return new;
  end if;

  if tg_op = 'UPDATE' then
    _old_bytes := case when old.type = 'static_website' then static_website_payload_bytes(old.static_website) else 0 end;
    _new_bytes := case when new.type = 'static_website' then static_website_payload_bytes(new.static_website) else 0 end;
    _delta := _new_bytes - _old_bytes;
    if _delta = 0 then return new; end if;

    select c.creator_id into _creator
      from modules m
      join courses c on c.id = m.course_id
     where m.id = new.module_id;
    if _creator is null then return new; end if;

    if _delta > 0 then
      insert into creator_storage (creator_id, bytes_used, pending_bytes, extra_bytes, static_website_bytes, updated_at)
      values (_creator, _delta, 0, 0, _delta, now())
      on conflict (creator_id) do update set
        bytes_used = creator_storage.bytes_used + excluded.bytes_used,
        static_website_bytes = creator_storage.static_website_bytes + excluded.bytes_used,
        updated_at = now();
    else
      update creator_storage
         set bytes_used = greatest(bytes_used + _delta, 0),
             static_website_bytes = greatest(static_website_bytes + _delta, 0),
             updated_at = now()
       where creator_id = _creator;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.type <> 'static_website' then return old; end if;
    _old_bytes := static_website_payload_bytes(old.static_website);
    if _old_bytes = 0 then return old; end if;

    select c.creator_id into _creator
      from modules m
      join courses c on c.id = m.course_id
     where m.id = old.module_id;
    if _creator is null then return old; end if;

    update creator_storage
       set bytes_used = greatest(bytes_used - _old_bytes, 0),
           static_website_bytes = greatest(static_website_bytes - _old_bytes, 0),
           updated_at = now()
     where creator_id = _creator;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_static_website_storage on nodes;
create trigger trg_static_website_storage
after insert or update of type, static_website, module_id or delete on nodes
for each row execute function bump_static_website_storage();

-- Idempotent backfill for static website lessons that already exist. Track this
-- component separately so rerunning database/apply.sh can apply only the delta
-- between the current row data and the last backfilled value.
with current_static as (
  select
    c.creator_id,
    coalesce(sum(static_website_payload_bytes(n.static_website)), 0)::bigint as bytes
  from nodes n
  join modules m on m.id = n.module_id
  join courses c on c.id = m.course_id
  where n.type = 'static_website'
  group by c.creator_id
),
ensured as (
  insert into creator_storage (creator_id, bytes_used, pending_bytes, extra_bytes, static_website_bytes, updated_at)
  select creator_id, 0, 0, 0, 0, now()
  from current_static
  on conflict (creator_id) do nothing
  returning creator_id
)
update creator_storage cs
   set bytes_used = greatest(cs.bytes_used + (cur.bytes - cs.static_website_bytes), 0),
       static_website_bytes = cur.bytes,
       updated_at = now()
  from current_static cur
 where cs.creator_id = cur.creator_id
   and cs.static_website_bytes <> cur.bytes;
