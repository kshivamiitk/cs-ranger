-- ============================================================
-- Courses, modules, nodes, comments, reviews, bookmarks, categories
-- Owned by: course-service
-- ============================================================

create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  slug        citext unique not null,
  icon        text,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists courses (
  id                    uuid primary key default gen_random_uuid(),
  creator_id            uuid not null references users(id) on delete restrict,
  title                 text not null check (char_length(title) between 3 and 80),
  subtitle              text check (char_length(subtitle) <= 120),
  description           text,
  category_id           uuid references categories(id) on delete set null,
  language              text not null default 'English',
  level                 course_level not null default 'All Levels',
  tags                  text[] not null default '{}',
  thumbnail_url         text,
  promo_video_url       text,
  status                course_status not null default 'draft',
  price                 integer not null default 0 check (price >= 0),       -- INR paise? we store rupees, switch to paise for prod
  discounted_price      integer check (discounted_price is null or (discounted_price >= 0 and discounted_price < price)),
  discount_valid_until  timestamptz,
  enrollment_limit      integer check (enrollment_limit is null or enrollment_limit > 0),
  certificate_enabled   boolean not null default true,
  welcome_message       text,
  completion_message    text,
  enrollment_count      integer not null default 0,
  rating_avg            numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count          integer not null default 0,
  duration_seconds      integer not null default 0,
  -- Full-text search vector, kept in sync by trigger
  search_vector         tsvector,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  published_at          timestamptz
);

create index if not exists idx_courses_creator        on courses(creator_id);
create index if not exists idx_courses_status_created on courses(status, created_at desc);
create index if not exists idx_courses_category       on courses(category_id);
create index if not exists idx_courses_search         on courses using gin(search_vector);
create index if not exists idx_courses_title_trgm     on courses using gin(title gin_trgm_ops);

drop trigger if exists trg_courses_updated_at on courses;
create trigger trg_courses_updated_at before update on courses
  for each row execute function set_updated_at();

create or replace function courses_search_refresh() returns trigger language plpgsql as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.subtitle, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.tags, ' '), '')), 'C');
  return new;
end $$;

drop trigger if exists trg_courses_search on courses;
create trigger trg_courses_search before insert or update of title, subtitle, description, tags on courses
  for each row execute function courses_search_refresh();

-- Modules
create table if not exists modules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  title       text not null,
  position    integer not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_modules_course on modules(course_id, position);

-- Nodes (lessons)
create table if not exists nodes (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references modules(id) on delete cascade,
  parent_node_id    uuid references nodes(id) on delete cascade,
  type              node_type not null,
  title             text not null,
  position          integer not null,
  duration_seconds  integer,
  is_free_preview   boolean not null default false,
  -- Type-specific payloads; only one block populated per row.
  video_url         text,
  video_provider    text check (video_provider in ('youtube', 'gdrive') or video_provider is null),
  markdown          text,
  pdf_url           text,
  static_website    jsonb,                                  -- { html, css, js }
  quiz_payload      jsonb,                                  -- { timerSeconds, questions: [...] }
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_nodes_module on nodes(module_id, position);

drop trigger if exists trg_nodes_updated_at on nodes;
create trigger trg_nodes_updated_at before update on nodes
  for each row execute function set_updated_at();

create table if not exists node_attachments (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id) on delete cascade,
  filename    text not null,
  url         text not null,
  size_bytes  bigint,
  mime_type   text,
  created_at  timestamptz not null default now()
);

-- Reviews (one per learner per course)
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  learner_id  uuid not null references users(id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  body        text,
  created_at  timestamptz not null default now(),
  unique (course_id, learner_id)
);
create index if not exists idx_reviews_course on reviews(course_id, created_at desc);

-- Doubts / comments (threaded one level)
create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id) on delete cascade,
  parent_id   uuid references comments(id) on delete cascade,
  author_id   uuid not null references users(id) on delete cascade,
  body        text not null,
  upvotes     integer not null default 0,
  is_pinned   boolean not null default false,
  is_resolved boolean not null default false,
  is_flagged  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_comments_node    on comments(node_id, created_at desc);
create index if not exists idx_comments_author  on comments(author_id);
create index if not exists idx_comments_parent  on comments(parent_id);

create table if not exists comment_upvotes (
  comment_id  uuid not null references comments(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- Bookmarks: courses learners save for later
create table if not exists bookmarks (
  learner_id  uuid not null references users(id) on delete cascade,
  course_id   uuid not null references courses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (learner_id, course_id)
);
create index if not exists idx_bookmarks_course on bookmarks(course_id);
