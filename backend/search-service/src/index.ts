import { createService, ok, paginate, mock, withDb, withCache } from "@cs-ranger/shared";
import crypto from "node:crypto";

const { app, listen } = createService("search-service");
const PORT = Number(process.env.PORT_SEARCH || 4005);

const CATALOG_COLS =
  "id, title, subtitle, thumbnail_url, price, discounted_price, rating_avg, rating_count, enrollment_count, category_id, language, level, creator_id, duration_seconds";

// Tier-2 scale moves on top of Tier 1:
//  * For non-text queries we read the `popular_courses` materialized view
//    instead of the live `courses` table. The view has a precomputed
//    `hot_score`, dedicated sort indexes, and is already filtered to
//    status='published' — so the catalog's hot path becomes a pure
//    index-only scan with no JOINs or aggregations. Stays fresh via a
//    pg_cron refresh + a manual refresh hook in course-service when courses
//    flip published/unpublished.
//  * The whole handler is wrapped in `withCache` keyed by the request's
//    normalized params. 30s TTL — long enough that bursty catalog traffic
//    collapses to one DB read per unique filter combination, short enough
//    that publishes/rating updates appear within half a minute.
//  * Falls back transparently to the live table for `?q=...` searches (the
//    materialized view doesn't carry search_vector) and for the "newest"
//    sort (which needs real-time published_at).
app.get("/courses", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || Number(req.query.pageSize) || 24, 1), 60);
  const offset = req.query.offset != null
    ? Math.max(Number(req.query.offset) || 0, 0)
    : Math.max((Number(req.query.page) || 1) - 1, 0) * limit;
  const sort = String(req.query.sort || "");

  // The view is a good source unless the request needs something only the
  // base table can provide: full-text search (search_vector) or absolute
  // recency (newest sort can't tolerate the refresh lag).
  const useView = !q && sort !== "newest";
  const table = useView ? "popular_courses" : "courses";

  // Cache key built from the params that actually influence the result.
  // Normalize ordering by hashing the sorted query string so /courses?a=1&b=2
  // and /courses?b=2&a=1 share a cache entry.
  const normalized = Object.entries(req.query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort().join("&");
  const cacheKey = `catalog:v2:${crypto.createHash("sha1").update(normalized).digest("hex")}`;
  const TTL_SECONDS = 30;

  const result = await withCache(cacheKey, TTL_SECONDS, () => withDb<{ items: unknown[]; total: number; hasMore: boolean }>(async (db) => {
    let query = db.from(table).select(CATALOG_COLS, { count: "exact" });
    // popular_courses is already filtered to status='published'; only need
    // the explicit filter when reading the live table.
    if (!useView) query = query.eq("status", "published");

    if (q) {
      const cleaned = q.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean).map((t) => `${t}:*`).join(" & ");
      if (cleaned) query = query.textSearch("search_vector", cleaned);
    }

    if (req.query.category) query = query.eq("category_id", req.query.category as string);
    if (req.query.minRating) query = query.gte("rating_avg", Number(req.query.minRating));
    if (req.query.level) query = query.in("level", String(req.query.level).split(","));
    if (req.query.language) query = query.in("language", String(req.query.language).split(","));
    if (req.query.creatorId) query = query.eq("creator_id", String(req.query.creatorId));
    // Duration buckets keep the URL human-readable: short < 3h, medium 3–10h, long > 10h.
    if (req.query.duration === "short") query = query.lte("duration_seconds", 3 * 3600);
    if (req.query.duration === "medium") query = query.gt("duration_seconds", 3 * 3600).lte("duration_seconds", 10 * 3600);
    if (req.query.duration === "long") query = query.gt("duration_seconds", 10 * 3600);
    if (req.query.priceMin) query = query.gte("price", Number(req.query.priceMin));
    if (req.query.priceMax) query = query.lte("price", Number(req.query.priceMax));
    if (req.query.price === "free") query = query.eq("price", 0);
    if (req.query.price === "paid") query = query.gt("price", 0);

    switch (sort) {
      case "newest":     query = query.order("published_at", { ascending: false }); break;
      case "rating":     query = query.order("rating_avg", { ascending: false }); break;
      case "price_asc":  query = query.order("price", { ascending: true }); break;
      case "price_desc": query = query.order("price", { ascending: false }); break;
      case "popular":
      default:
        // The view's hot_score precomputes ln(enrollments) + rating + time-decay
        // for a more meaningful "popular" than raw enrollment count. The base
        // table doesn't carry the score, so when we're on it (e.g. ?q=...
        // search) we fall back to enrollment_count.
        query = useView
          ? query.order("hot_score", { ascending: false })
          : query.order("enrollment_count", { ascending: false });
        break;
    }
    query = query.order("id", { ascending: false }); // stable tiebreaker
    query = query.range(offset, offset + limit - 1);
    const { data, count } = await query;
    const items = data || [];
    const total = count || 0;
    return { items, total, hasMore: offset + items.length < total };
  }, () => {
    const ql = q.toLowerCase();
    const list = mock.courses.filter((c) => c.status === "published" && (!ql || c.title.toLowerCase().includes(ql) || c.subtitle.toLowerCase().includes(ql)));
    const page = Math.floor(offset / limit) + 1;
    const p = paginate(list, page, limit);
    // paginate() exposes the full-list count on meta.total (p.total never existed).
    return { items: p.items, total: p.meta.total || list.length, hasMore: offset + p.items.length < (p.meta.total || list.length) };
  }));
  ok(res, result.items, { limit, offset, total: result.total, hasMore: result.hasMore, source: useView ? "popular_courses" : "courses" });
});

// Creator directory. Backed by the creator_stats view (one query, all aggregates
// included) so the list can be sorted server-side by any metric without N+1s.
const CREATOR_SORTS = {
  subscribers: "subscriber_count",
  courses:     "course_count",
  rating:      "avg_rating",
  enrollments: "total_enrollments",
  name:        "display_name",
} as const;
type CreatorSort = keyof typeof CREATOR_SORTS;

app.get("/creators", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const sortKey = (Object.keys(CREATOR_SORTS) as CreatorSort[]).includes(req.query.sort as CreatorSort)
    ? (req.query.sort as CreatorSort) : "subscribers";
  const sortCol = CREATOR_SORTS[sortKey];
  // "Active" = at least one published course. Defaults on so the directory is
  // a real list of working creators, not anyone who's ever signed up.
  const activeOnly = req.query.activeOnly !== "false";
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  // Strip PostgREST filter metacharacters before interpolating into the .or()
  // string. Commas/parentheses/dots structure a PostgREST logic-tree, so a raw
  // query could otherwise inject extra conditions (filter injection). Mirrors the
  // hygiene the /courses full-text path applies. Spaces are kept for ilike.
  const safeQ = q.replace(/[^\w\s]/g, " ").trim();
  const list = await withDb(async (db) => {
    let query = db.from("creator_stats").select("*", { count: "exact" });
    if (safeQ) query = query.or(`display_name.ilike.%${safeQ}%,username.ilike.%${safeQ}%`);
    if (activeOnly) query = query.gt("course_count", 0);
    const ascending = sortKey === "name"; // names alphabetic; everything else desc.
    const { data, count } = await query
      .order(sortCol, { ascending })
      .order("display_name", { ascending: true })
      .range(offset, offset + limit - 1);
    return { items: data || [], total: count || 0 };
  }, () => ({
    items: mock.users.filter((u) => u.roles.includes("creator")).map((u) => ({
      user_id: u.id, display_name: u.displayName, username: u.username,
      bio: "", college: "", avatar_url: u.avatarUrl,
      subscriber_count: 0, course_count: 0, total_enrollments: 0, avg_rating: 0,
    })),
    total: mock.users.filter((u) => u.roles.includes("creator")).length,
  }));
  ok(res, list.items, { sort: sortKey, total: list.total, limit, offset });
});

app.get("/autocomplete", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return ok(res, { courses: [], creators: [] });
  const data = await withDb(async (db) => {
    const [{ data: courses }, { data: creators }] = await Promise.all([
      db.from("courses").select("id, title, thumbnail_url").eq("status", "published").ilike("title", `${q}%`).limit(5),
      db.from("profiles").select("user_id, display_name, username, avatar_url, user_roles!inner(role)").eq("user_roles.role", "creator").ilike("display_name", `${q}%`).limit(3),
    ]);
    return { courses: courses || [], creators: creators || [] };
  }, () => ({
    courses: mock.courses.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 5).map((c) => ({ id: c.id, title: c.title, thumbnail_url: c.thumbnail })),
    creators: mock.users.filter((u) => u.roles.includes("creator") && u.displayName.toLowerCase().includes(q)).slice(0, 3).map((u) => ({ user_id: u.id, display_name: u.displayName, username: u.username, avatar_url: u.avatarUrl })),
  }));
  ok(res, data);
});

listen(PORT);
