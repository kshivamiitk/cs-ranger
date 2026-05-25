-- ============================================================
-- Scale-out comments for Reddit-style threading at millions/day.
--   1. Denormalize reply_count so the feed never runs COUNT(*).
--   2. Partial index on top-level rows for the lesson feed.
--   3. Reply pagination index (parent_id, created_at).
-- ============================================================

alter table comments add column if not exists reply_count integer not null default 0;

-- Backfill (idempotent — re-runnable, counts are absolute not deltas).
update comments c set reply_count = (
  select count(*) from comments r where r.parent_id = c.id
);

-- Trigger keeps the counter in sync. Note: parent_id is immutable in practice
-- (the API never moves a reply between parents), so we don't handle UPDATE.
create or replace function bump_comment_reply_count() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null then
    update comments set reply_count = reply_count + 1 where id = new.parent_id;
  elsif tg_op = 'DELETE' and old.parent_id is not null then
    update comments set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comments_reply_count on comments;
create trigger trg_comments_reply_count after insert or delete on comments
  for each row execute function bump_comment_reply_count();

-- Top-level feed: partial index excluding reply rows. Smaller than
-- idx_comments_node_kind_created and lets the feed query skip all replies.
create index if not exists idx_comments_node_top on comments(node_id, kind, created_at desc)
  where parent_id is null;

-- Reply pagination: chronological order, fast lookup by parent.
create index if not exists idx_comments_parent_created on comments(parent_id, created_at);
