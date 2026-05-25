-- ============================================================
-- Lesson discussion: each comment is either a casual `comment` or
-- a `doubt` aimed at the creator. Doubts trigger a notification
-- (see course-service POST /nodes/:nodeId/comments — synchronous
-- insert so the chain works without Redis in local dev).
-- ============================================================

do $$ begin
  create type comment_kind as enum ('comment', 'doubt');
exception when duplicate_object then null;
end $$;

alter table comments add column if not exists kind comment_kind not null default 'comment';

-- Covers the common feed query (filter by node, order by recency, optionally
-- filter to doubts only for the creator's Doubts dashboard).
create index if not exists idx_comments_node_kind_created on comments(node_id, kind, created_at desc);
