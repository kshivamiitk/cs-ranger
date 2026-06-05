import { createService, ok, fail, paginate, mock, requireAuth, requireRole, withDb, isSupabaseConfigured, publish, Topics, bustPrefix, razorpay, isRazorpayConfigured, verifyPaymentSignature, sendRealtimeNotification, writeAuditLog, getPlatformSetting, type Course } from "@cs-ranger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request as ExpressRequest } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { registerCourseUploadRoutes } from "./uploads.js";
import { registerModerationRoutes } from "./moderation.js";
import { NodeVideoExtras, VideoChapters, VideoSubtitles } from "./validation.js";
import { resolveCoursePricing } from "./pricing.js";
import { sortCourseTree, type WithPosition } from "./ordering.js";

// ─── Creator storage quota ────────────────────────────────────────
// Tunable per deployment via root .env. Hard cap on lesson-PDF uploads
// per creator. The counter lives in creator_storage.bytes_used, kept
// in sync by a trigger on storage.objects — so the per-upload check
// is one indexed primary-key lookup (O(1)).
const STORAGE_FREE_MB = Number(process.env.CREATOR_STORAGE_FREE_MB || 2);
const STORAGE_PRICE_PER_MB_INR = Number(process.env.CREATOR_STORAGE_PRICE_PER_MB_INR || 5);
const STORAGE_DURATION_DAYS = Number(process.env.CREATOR_STORAGE_DURATION_DAYS || 30);
const BYTES_PER_MB = 1024 * 1024;

type StorageState = {
  bytes_used: number;
  extra_bytes: number;
  extra_until: string | null;
  effective_extra_bytes: number; // 0 if expired
  quota_bytes: number;
  remaining_bytes: number;
};

async function getCreatorStorage(db: SupabaseClient, creatorId: string): Promise<StorageState> {
  const { data } = await db.from("creator_storage")
    .select("bytes_used, extra_bytes, extra_until")
    .eq("creator_id", creatorId)
    .maybeSingle();
  const bytes_used = (data as { bytes_used?: number } | null)?.bytes_used ?? 0;
  const extra_bytes = (data as { extra_bytes?: number } | null)?.extra_bytes ?? 0;
  const extra_until = (data as { extra_until?: string | null } | null)?.extra_until ?? null;
  const extraValid = !!extra_until && new Date(extra_until).getTime() > Date.now();
  const effective_extra_bytes = extraValid ? extra_bytes : 0;
  const quota_bytes = STORAGE_FREE_MB * BYTES_PER_MB + effective_extra_bytes;
  return {
    bytes_used, extra_bytes, extra_until,
    effective_extra_bytes,
    quota_bytes,
    remaining_bytes: Math.max(0, quota_bytes - bytes_used),
  };
}

/**
 * Refresh the catalog snapshot when a course's published-or-not state
 * changes. Two things happen:
 *   1. REFRESH MATERIALIZED VIEW CONCURRENTLY popular_courses — so the new
 *      course appears in the catalog (or disappears on unpublish) immediately,
 *      without waiting for the pg_cron tick.
 *   2. Drop the search-service's Redis cache for catalog keys so the next
 *      GET /api/search/courses doesn't serve a stale snapshot.
 * Both are best-effort: a failure here shouldn't break the publish flow.
 */
async function refreshCatalogSnapshot(db: SupabaseClient): Promise<void> {
  try { await db.rpc("refresh_popular_courses"); } catch { /* best effort */ }
  await bustPrefix("catalog:v2:");
}

// ─── Collaboration helpers ────────────────────────────────────────
// Single source of truth for "can this user write to this course": the course
// owner OR an accepted collaborator OR an admin. Both invoked from every
// write-path handler so a future role tweak is one place to change.
async function courseEditorRole(
  db: SupabaseClient,
  // Express 5 types route params as string | string[]; normalise once here so
  // every call site can pass req.params.* directly.
  courseIdParam: string | string[],
  userId: string,
  isAdmin: boolean,
): Promise<"owner" | "collaborator" | "admin" | null> {
  const courseId = String(courseIdParam);
  if (isAdmin) return "admin";
  const { data: course } = await db.from("courses").select("creator_id").eq("id", courseId).maybeSingle();
  if (!course) return null;
  if ((course as { creator_id: string }).creator_id === userId) return "owner";
  const { data: collab } = await db.from("course_collaborators")
    .select("user_id").eq("course_id", courseId).eq("user_id", userId).eq("status", "accepted").maybeSingle();
  return collab ? "collaborator" : null;
}

// Resolve a module / lesson back to its parent course so we can authz the
// write path. One-shot small queries, indexed lookups.
async function moduleCourseId(db: SupabaseClient, moduleId: string | string[]): Promise<string | null> {
  const { data } = await db.from("modules").select("course_id").eq("id", String(moduleId)).maybeSingle();
  return (data as { course_id?: string } | null)?.course_id || null;
}
async function nodeCourseId(db: SupabaseClient, nodeId: string | string[]): Promise<string | null> {
  const { data } = await db.from("nodes")
    .select("modules!inner(course_id)").eq("id", String(nodeId)).maybeSingle();
  if (!data) return null;
  const m = (data as { modules?: { course_id?: string } | { course_id?: string }[] }).modules;
  const one = Array.isArray(m) ? m[0] : m;
  return one?.course_id || null;
}

// Inspect the lock row directly (bypasses the SQL function — that one mutates).
// PostgREST can't embed profiles off course_edit_locks.held_by because that
// column FKs users(id), not profiles. Same trap as comments/collaborators —
// we traverse users → profiles and flatten. If we don't do this the join
// errors out, the function returns null, and EVERY lock check downstream
// reads as "no lock → require one" — which is the exact bug that caused
// "Acquire the edit lock before saving" to fire even when the lock was held.
async function getCourseLock(db: SupabaseClient, courseId: string | string[]): Promise<
  { heldBy: string; expiresAt: string; holderName: string; expired: boolean } | null
> {
  const { data } = await db.from("course_edit_locks")
    .select("held_by, expires_at, users:held_by(profiles(display_name))")
    .eq("course_id", String(courseId))
    .maybeSingle();
  if (!data) return null;
  type Row = {
    held_by: string;
    expires_at: string;
    users?: { profiles?: { display_name?: string } | null } | { profiles?: { display_name?: string } | null }[] | null;
  };
  const r = data as Row;
  const u = Array.isArray(r.users) ? r.users[0] : r.users;
  const p = u?.profiles;
  return {
    heldBy: r.held_by,
    expiresAt: r.expires_at,
    holderName: p?.display_name || "Someone",
    expired: new Date(r.expires_at).getTime() < Date.now(),
  };
}

// One-stop write-path check: caller must be an editor (owner / accepted
// collaborator / admin) AND currently hold the lock. Admin bypasses the lock
// so they can always step in.
type WriteCheck =
  | { ok: true; role: "owner" | "collaborator" | "admin" }
  | { ok: false; status: number; code: string; message: string; meta?: Record<string, unknown> };

async function assertCanWriteCourse(
  db: SupabaseClient, courseId: string | string[], userId: string, isAdmin: boolean,
): Promise<WriteCheck> {
  const role = await courseEditorRole(db, courseId, userId, isAdmin);
  if (!role) return { ok: false, status: 403, code: "NOT_EDITOR", message: "Not an editor of this course" };
  if (role === "admin") return { ok: true, role };
  const lock = await getCourseLock(db, courseId);
  if (!lock || lock.expired) {
    return { ok: false, status: 423, code: "LOCK_REQUIRED", message: "Acquire the edit lock before saving" };
  }
  if (lock.heldBy !== userId) {
    return {
      ok: false, status: 423, code: "LOCK_HELD_BY_OTHER",
      message: `Locked by ${lock.holderName}`,
      // holderId duplicates heldBy so clients can rely on the documented
      // LOCKED-error shape (holderId / holderName / expiresAt).
      meta: { heldBy: lock.heldBy, holderId: lock.heldBy, holderName: lock.holderName, expiresAt: lock.expiresAt },
    };
  }
  return { ok: true, role };
}

const { app, listen } = createService("course-service");
const PORT = Number(process.env.PORT_COURSE || 4003);

// Storage upload pipeline (thumbnails, node attachments) — literal /uploads/*
// and /nodes/:nodeId/attachments routes, registered before the /:id params.
registerCourseUploadRoutes(app, { courseEditorRole, nodeCourseId });
// Content reporting + admin flagged-content queue.
registerModerationRoutes(app, { nodeCourseId, refreshCatalogSnapshot });

// Explicit summary columns for list/card views. Avoids select("*") which drags
// heavy/unused fields (description, tags, search_vector, promo_video_url) over the
// wire on the catalog and creator/admin tables.
const COURSE_SUMMARY_COLS =
  "id, creator_id, title, subtitle, thumbnail_url, status, price, discounted_price, rating_avg, rating_count, enrollment_count, category_id, level, language, duration_seconds, published_at, created_at";

// ─── Categories ──────────────────────────────────────────────────
app.get("/categories", async (_req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("categories").select("*").order("position");
    return data || [];
  }, () => mock.categories);
  ok(res, list);
});

// Admin category management. (RLS also restricts writes to admins; this is the
// missing CRUD that left the admin "Categories" page unable to add anything.)
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const CategoryWrite = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "slug: lowercase letters, numbers and hyphens only").optional(),
  icon: z.string().max(16).optional(),
  position: z.number().int().min(0).optional(),
});

app.post("/categories", requireRole("admin"), async (req, res) => {
  const parsed = CategoryWrite.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const name = parsed.data.name.trim();
  const slug = parsed.data.slug || slugify(name);
  if (!slug) return fail(res, 400, "Could not derive a slug from the name", "VALIDATION");
  const result = await withDb(async (db) => {
    const { data, error } = await db.from("categories")
      .insert({ name, slug, icon: parsed.data.icon || null, position: parsed.data.position ?? 0 })
      .select("*").single();
    if (error) throw error;
    return data;
  }, null);
  if (!result) return fail(res, 409, "A category with that name or slug already exists", "DUPLICATE");
  res.status(201);
  ok(res, result);
});

app.patch("/categories/:id", requireRole("admin"), async (req, res) => {
  const parsed = CategoryWrite.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.slug !== undefined) patch.slug = parsed.data.slug;
  if (parsed.data.icon !== undefined) patch.icon = parsed.data.icon || null;
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;
  if (Object.keys(patch).length === 0) return fail(res, 400, "Nothing to update", "VALIDATION");
  const result = await withDb(async (db) => {
    const { data, error } = await db.from("categories").update(patch).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    return data;
  }, null);
  if (!result) return fail(res, 404, "Category not found, or the name/slug is taken", "NOT_FOUND");
  ok(res, result);
});

app.delete("/categories/:id", requireRole("admin"), async (req, res) => {
  // courses.category_id is ON DELETE SET NULL, so affected courses are simply
  // uncategorized — no course data is lost.
  await withDb(async (db) => {
    await db.from("categories").delete().eq("id", req.params.id);
    return null;
  }, null);
  ok(res, { deleted: true });
});

// ─── Course listing (catalog) ────────────────────────────────────
app.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize || 20)));
  const list = await withDb(async (db) => {
    let q = db.from("courses").select(COURSE_SUMMARY_COLS, { count: "exact" }).eq("status", "published").order("enrollment_count", { ascending: false });
    if (req.query.category) q = q.eq("category_id", req.query.category as string);
    if (req.query.creatorId) q = q.eq("creator_id", req.query.creatorId as string);
    if (req.query.minRating) q = q.gte("rating_avg", Number(req.query.minRating));
    q = q.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count } = await q;
    // Cast bridges the snake_case DB row shape to the camelCase mock Course type that
    // withDb infers from the fallback; the wire payload is the snake_case row the FE expects.
    return { items: (data || []) as unknown as Course[], total: count || 0 };
  }, () => {
    const all = mock.courses.filter((c) => c.status === "published");
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  });
  ok(res, list.items, { page, pageSize, total: list.total });
});

// ─── Creator's own courses (all statuses) ────────────────────────
// Defined before "/:id" so the literal "/mine" path is not captured by the
// id param. Scoped server-side to the authenticated creator — replaces the old
// pattern of fetching the whole published catalog and filtering by creator_id
// on the client (which also hid the creator's drafts/under-review courses).
app.get("/mine", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("courses")
      .select(COURSE_SUMMARY_COLS)
      .eq("creator_id", req.user!.id)
      .order("created_at", { ascending: false });
    return (data || []) as unknown as Course[];
  }, () => mock.courses.filter((c) => c.creatorId === req.user!.id));
  ok(res, list);
});

// ─── Admin: all courses across every status (catalog GET / is published-only) ──
// Used by the admin "All Courses" table and the "review queue" (?status=under_review).
app.get("/admin/courses", requireRole("admin"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const list = await withDb(async (db) => {
    let q = db.from("courses").select(COURSE_SUMMARY_COLS).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return (data || []) as unknown as Course[];
  }, () => (status ? mock.courses.filter((c) => c.status === status) : mock.courses) as unknown as Course[]);
  ok(res, list);
});

// ─── Aggregated course detail ────────────────────────────────────
app.get("/:id/detail", async (req, res) => {
  // Loose generic: DB rows and the dev mock differ in nullability; the handler
  // only null-checks and forwards the aggregate.
  const aggregated = await withDb<{ course: unknown; creator: unknown; reviews: unknown } | null>(async (db) => {
    const { data: course } = await db.from("courses").select("*").eq("id", req.params.id).maybeSingle();
    if (!course) return null;
    // Curriculum OUTLINE only — the public course page renders lesson titles/types/durations,
    // not lesson bodies. Selecting explicit node columns (instead of nodes(*)) keeps heavy
    // fields (markdown, static_website, video_url) and — critically — quiz answers
    // (quiz_payload.correctIndex) out of this unauthenticated response. Full lesson content
    // is served separately to the player via GET /:id.
    const [{ data: modules }, { data: creator }, { data: reviews }] = await Promise.all([
      db.from("modules").select("id, title, position, nodes(id, type, title, position, duration_seconds, is_free_preview)").eq("course_id", course.id).order("position"),
      db.from("profiles").select("user_id, display_name, username, bio, college, avatar_url").eq("user_id", course.creator_id).maybeSingle(),
      db.from("reviews").select("id, rating, body, created_at, learner_id").eq("course_id", course.id).order("created_at", { ascending: false }).limit(10),
    ]);
    // Nested nodes come back unordered from PostgREST; sort the whole tree by
    // position so the public curriculum matches the creator's saved order.
    return { course: { ...course, modules: sortCourseTree(modules) }, creator, reviews };
  }, () => {
    const c = mock.courses.find((x) => x.id === req.params.id);
    if (!c) return null;
    const creator = mock.users.find((u) => u.id === c.creatorId);
    return { course: c, creator, reviews: mock.reviews.filter((r) => r.courseId === c.id) };
  });
  if (!aggregated) return fail(res, 404, "Course not found", "NOT_FOUND");
  ok(res, aggregated);
});

// (The catch-all GET /:id course-fetch handler is registered at the bottom of
//  this file — Express matches routes in registration order, so it must come
//  after every literal GET path like /bookmarks, /lesson-bookmarks, /mine, etc.
//  Otherwise those one-segment paths get swallowed by /:id and 404 as
//  "Course not found".)

// ─── Course CRUD (creator) ───────────────────────────────────────
// Treat blank strings from the form as "not provided" so optional URL/uuid
// fields don't fail .url() validation or hit the DB as empty strings.
const blankToUndef = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema);

// Field names are snake_case to match the frontend payload (Course/CourseNode types)
// and the DB columns. (They were camelCase before, which silently dropped category_id,
// thumbnail_url, video_url, static_website, quiz_payload, etc. on create.)
const CourseCreate = z.object({
  title: z.string().min(3).max(80),
  subtitle: z.string().max(120).optional(),
  description: z.string().optional(),
  category_id: blankToUndef(z.string().optional()),
  language: z.string().default("English"),
  level: z.enum(["Beginner", "Intermediate", "Advanced", "All Levels"]).default("All Levels"),
  tags: z.array(z.string()).max(10).default([]),
  thumbnail_url: blankToUndef(z.string().url().optional()),
  promo_video_url: blankToUndef(z.string().url().optional()),
  price: z.number().int().min(0).default(0),
  discounted_price: blankToUndef(z.number().int().min(0).optional()),
  certificate_enabled: z.boolean().default(true),
});

app.post("/", requireRole("creator", "admin"), async (req, res) => {
  const parsed = CourseCreate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;
  const result = await withDb(async (db) => {
    const { data, error } = await db.from("courses").insert({
      creator_id: req.user!.id,
      title: d.title, subtitle: d.subtitle, description: d.description,
      category_id: d.category_id, language: d.language, level: d.level, tags: d.tags,
      thumbnail_url: d.thumbnail_url, promo_video_url: d.promo_video_url,
      price: d.price, discounted_price: d.discounted_price,
      certificate_enabled: d.certificate_enabled, status: "draft",
    }).select("*").single();
    if (error) throw error;
    // Auto-grant the creator the edit lock right after creation. The new-
    // course flow's "save & republish" call writes the course + then its
    // modules + lessons; the module/lesson writes go through the lock check,
    // so without this the user would have to click "Take edit lock" before
    // anything else can save. The lock is theirs until they release it or
    // the 10-min idle TTL kicks in.
    if (data?.id) {
      try { await db.rpc("acquire_course_lock", { p_course_id: data.id, p_user_id: req.user!.id }); }
      catch { /* best effort — the explicit Take Lock button is the fallback */ }
    }
    return data;
  }, () => ({ id: `crs-${Date.now()}`, status: "draft", ...d }));
  res.status(201);
  ok(res, result);
});

const CourseUpdate = CourseCreate.partial();
app.patch("/:id", requireRole("creator", "admin"), async (req, res) => {
  const parsed = CourseUpdate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const p = parsed.data;

  const result = await withDb(async (db) => {
    const check = await assertCanWriteCourse(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;

    // A PATCH is partial, so a stale discount left over from a higher price (or
    // a premium→free switch) would violate the DB CHECK `discounted_price <
    // price` even when the caller only changed `price` — and withDb would
    // swallow it and misreport "Course not found". resolveCoursePricing merges
    // the patch onto the current row and keeps the pair valid (or rejects an
    // explicitly invalid one with a clear message).
    const { data: existing } = await db.from("courses").select("price, discounted_price").eq("id", req.params.id).maybeSingle();
    if (!existing) return { notFound: true } as const;
    const pricing = resolveCoursePricing(
      { price: p.price, discounted_price: p.discounted_price },
      { price: existing.price as number, discounted_price: existing.discounted_price as number | null },
    );
    if (!pricing.ok) return { ok: false as const, status: 400, code: "VALIDATION", message: pricing.error };

    const { data, error } = await db.from("courses").update({
      title: p.title, subtitle: p.subtitle, description: p.description,
      category_id: p.category_id, language: p.language, level: p.level, tags: p.tags,
      thumbnail_url: p.thumbnail_url, promo_video_url: p.promo_video_url,
      price: pricing.price, discounted_price: pricing.discounted_price,
      certificate_enabled: p.certificate_enabled,
    }).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw error;
    return data;
  }, null);
  if (!result) return fail(res, 404, "Course not found", "NOT_FOUND");
  if ("ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
  ok(res, result);
});

// Creator T&C gate: submitting/publishing a course requires the CURRENT terms
// version (platform_settings.creator_terms_version) to be accepted by the
// acting user. Admins bypass. Returns a structured error the frontend uses to
// open the acceptance modal and retry the original action.
async function creatorTermsCheck(db: SupabaseClient, userId: string, isAdmin: boolean): Promise<WriteCheck | null> {
  if (isAdmin) return null;
  const currentVersion = String(await getPlatformSetting("creator_terms_version", "2026-05-01"));
  const { data: acceptance } = await db.from("creator_terms_acceptance")
    .select("terms_version")
    .eq("creator_id", userId)
    .eq("terms_version", currentVersion)
    .maybeSingle();
  if (acceptance) return null;
  const { data: latest } = await db.from("creator_terms_acceptance")
    .select("terms_version").eq("creator_id", userId)
    .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  return {
    ok: false, status: 403, code: "TERMS_ACCEPTANCE_REQUIRED",
    message: "Accept the current creator terms before submitting this course",
    meta: { currentVersion, acceptedVersion: latest?.terms_version || null, termsHref: "/creator/finance" },
  };
}

app.post("/:id/submit-review", requireRole("creator"), async (req, res) => {
  const result = await withDb(async (db) => {
    const terms = await creatorTermsCheck(db, req.user!.id, req.user!.role === "admin");
    if (terms) return terms;
    const check = await assertCanWriteCourse(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { data, error } = await db.from("courses").update({ status: "under_review" }).eq("id", req.params.id).select("id, status").maybeSingle();
    if (error) throw error;
    return data;
  }, () => ({ id: req.params.id, status: "under_review" as const }));
  if (!result) return fail(res, 404, "Course not found or not yours", "NOT_FOUND");
  if ("ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  ok(res, result);
});

// Notify the right audience when a course goes live, branching on whether the
// course was ever published before:
//   • First publish   → tell the creator's FOLLOWERS a new course is out
//                        ("new_course", from the subscriptions table).
//   • Re-publish (edit)→ tell everyone ENROLLED the course was UPDATED
//                        ("course_updated", from the enrollments table) — and
//                        deliberately NOT "new_course".
// Realtime broadcast is intentionally skipped (bell polling covers it) to avoid
// a per-recipient fan-out loop. `wasPublishedBefore` is derived from the course's
// pre-update published_at (stamped only on the first publish — see 0013 trigger).
async function notifyOnPublish(courseId: string, creatorId: string | undefined, wasPublishedBefore: boolean): Promise<void> {
  if (!creatorId) return;
  await withDb(async (db) => {
    const { data: course } = await db.from("courses").select("title").eq("id", courseId).maybeSingle();
    if (!course) return null;

    if (wasPublishedBefore) {
      // Skip if we already told learners about an update to this course in the
      // last 6h, so rapid edit→republish cycles don't spam the same people.
      const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await db.from("notifications")
        .select("id").eq("type", "course_updated").eq("href", `/course/${courseId}`)
        .gte("created_at", sinceIso).limit(1).maybeSingle();
      if (recent) return null;
      const { data: enrolled } = await db.from("enrollments")
        .select("learner_id").eq("course_id", courseId).limit(2000);
      if (!enrolled || enrolled.length === 0) return null;
      await db.from("notifications").insert(enrolled.map((e) => ({
        user_id: e.learner_id,
        type: "course_updated",
        title: "A course you're enrolled in was updated",
        body: course.title,
        href: `/course/${courseId}`,
      })));
      return null;
    }

    // First publish — announce the new course to followers (one-time sentinel
    // guards against a duplicate insert if this path runs twice).
    const { data: already } = await db.from("notifications")
      .select("id").eq("type", "new_course").eq("href", `/course/${courseId}`).limit(1).maybeSingle();
    if (already) return null;
    const [{ data: creatorProfile }, { data: subs }] = await Promise.all([
      db.from("profiles").select("display_name").eq("user_id", creatorId).maybeSingle(),
      db.from("subscriptions").select("learner_id").eq("creator_id", creatorId).limit(500),
    ]);
    if (!subs || subs.length === 0) return null;
    await db.from("notifications").insert(subs.map((s) => ({
      user_id: s.learner_id,
      type: "new_course",
      title: `New course from ${creatorProfile?.display_name || "a creator you follow"}`,
      body: course.title,
      href: `/course/${courseId}`,
    })));
    return null;
  }, null);
}

// Creator-initiated direct publish. Requires the course to be theirs, with at
// least one module and one lesson — otherwise the catalog would show an empty
// course. published_at is stamped by the trg_courses_published_at trigger.
app.post("/:id/publish", requireRole("creator"), async (req, res) => {
  // Captured inside the closure, read after — a non-null published_at means this
  // course has gone live before, so it's an edit→re-publish, not a brand-new
  // course (the 0013 trigger only stamps published_at on the first publish).
  let wasPublishedBefore = false;
  const result = await withDb(async (db) => {
    const terms = await creatorTermsCheck(db, req.user!.id, req.user!.role === "admin");
    if (terms) return terms;
    const check = await assertCanWriteCourse(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { data: course } = await db.from("courses").select("id, creator_id, title, published_at").eq("id", req.params.id).maybeSingle();
    if (!course) return { notFound: true } as const;
    if (!course.title || course.title.trim().length < 3) return { invalid: "Course title needs at least 3 characters" } as const;
    wasPublishedBefore = course.published_at != null;
    const { count: lessonCount } = await db
      .from("nodes")
      .select("id, modules!inner(course_id)", { count: "exact", head: true })
      .eq("modules.course_id", req.params.id);
    if (!lessonCount || lessonCount < 1) {
      return { invalid: "Add at least one lesson before publishing" } as const;
    }
    const { data, error } = await db.from("courses").update({ status: "published" }).eq("id", req.params.id).select("id, status, published_at").maybeSingle();
    if (error) throw error;
    if (data) await refreshCatalogSnapshot(db);
    return data;
  }, () => ({ id: req.params.id, status: "published" as const, published_at: new Date().toISOString() }));
  if (!result) return fail(res, 404, "Not found", "NOT_FOUND");
  if ("ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
  if ("invalid" in result) return fail(res, 400, result.invalid ?? "Invalid request", "VALIDATION");
  await publish(Topics.COURSE_PUBLISHED, { courseId: (result as { id: string }).id, creatorId: req.user!.id });
  await notifyOnPublish((result as { id: string }).id, req.user!.id, wasPublishedBefore);
  ok(res, result);
});

app.post("/:id/approve", requireRole("admin"), async (req, res) => {
  // Was it ever live before? Only stamp published_at on the first approval so
  // re-approving an edited course preserves the original "since when" date.
  let wasPublishedBefore = false;
  const result = await withDb(async (db) => {
    const { data: prior } = await db.from("courses").select("published_at").eq("id", req.params.id).maybeSingle();
    wasPublishedBefore = prior?.published_at != null;
    const patch: Record<string, unknown> = { status: "published" };
    if (!wasPublishedBefore) patch.published_at = new Date().toISOString();
    const { data, error } = await db.from("courses").update(patch).eq("id", req.params.id).select("id, status, creator_id, title").maybeSingle();
    if (error) throw error;
    if (data) {
      await db.from("admin_audit_log").insert({ admin_id: req.user!.id, action: "course.approve", target_type: "course", target_id: data.id });
      await refreshCatalogSnapshot(db);
    }
    return data;
  }, () => ({ id: req.params.id, status: "published" as const, creator_id: "u2", title: "" }));
  if (!result) return fail(res, 404, "Not found", "NOT_FOUND");
  await publish(Topics.COURSE_PUBLISHED, { courseId: result.id, creatorId: (result as { creator_id?: string }).creator_id });
  await notifyOnPublish(result.id, (result as { creator_id?: string }).creator_id, wasPublishedBefore);
  ok(res, result);
});

app.post("/:id/reject", requireRole("admin"), async (req, res) => {
  const reason = String(req.body.reason || "");
  if (reason.length < 20) return fail(res, 400, "Reason must be at least 20 characters", "VALIDATION");
  const result = await withDb(async (db) => {
    const { data } = await db.from("courses").update({ status: "draft" }).eq("id", req.params.id).select("id, creator_id").maybeSingle();
    if (data) {
      await db.from("admin_audit_log").insert({ admin_id: req.user!.id, action: "course.reject", target_type: "course", target_id: data.id, metadata: { reason } });
      // Reject removes the course from the published catalog snapshot.
      await refreshCatalogSnapshot(db);
    }
    return data;
  }, null);
  if (!result) return fail(res, 404, "Not found", "NOT_FOUND");
  ok(res, { id: result.id, status: "draft", reason });
});

// ─── Modules ──────────────────────────────────────────────────────
app.post("/:id/modules", requireRole("creator", "admin"), async (req, res) => {
  const title = String(req.body.title || "");
  if (!title) return fail(res, 400, "Title required", "VALIDATION");
  const result = await withDb(async (db) => {
    const check = await assertCanWriteCourse(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { count } = await db.from("modules").select("id", { count: "exact", head: true }).eq("course_id", req.params.id);
    const { data } = await db.from("modules").insert({ course_id: req.params.id, title, position: count || 0 }).select("*").single();
    return data;
  }, () => ({ id: `m-${Date.now()}`, course_id: req.params.id, title, position: 0 }));
  if (result && "ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  ok(res, result);
});

app.patch("/modules/:id", requireRole("creator", "admin"), async (req, res) => {
  const result = await withDb(async (db) => {
    const courseId = await moduleCourseId(db, req.params.id);
    if (!courseId) return { notFound: true } as const;
    const check = await assertCanWriteCourse(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { data } = await db.from("modules").update({ title: req.body.title, position: req.body.position }).eq("id", req.params.id).select("*").maybeSingle();
    return data;
  }, null);
  if (result && "ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if (result && "notFound" in result) return fail(res, 404, "Module not found", "NOT_FOUND");
  ok(res, result);
});

app.delete("/modules/:id", requireRole("creator", "admin"), async (req, res) => {
  const result = await withDb<{ notFound: true } | { deleted: true } | WriteCheck>(async (db) => {
    const courseId = await moduleCourseId(db, req.params.id);
    if (!courseId) return { notFound: true } as const;
    const check = await assertCanWriteCourse(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    await db.from("modules").delete().eq("id", req.params.id);
    return { deleted: true } as const;
  }, () => ({ deleted: true } as const));
  if ("ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if ("notFound" in result) return fail(res, 404, "Module not found", "NOT_FOUND");
  ok(res, { deleted: true });
});

// ─── Nodes ────────────────────────────────────────────────────────
// snake_case to match the frontend payload + DB columns (was camelCase, which dropped
// duration_seconds / is_free_preview / video_url / pdf_url / static_website / quiz_payload).
const NodeCreate = z.object({
  moduleId: z.string(),
  type: z.enum(["video", "markdown", "quiz", "pdf", "static_website"]),
  title: z.string().min(1).max(100),
  duration_seconds: z.number().int().optional(),
  is_free_preview: z.boolean().optional().default(false),
  video_url: blankToUndef(z.string().url().optional()),
  video_provider: z.enum(["youtube", "gdrive"]).optional(),
  video_chapters: VideoChapters.optional(),
  video_subtitles: VideoSubtitles.optional(),
  markdown: z.string().optional(),
  // PDFs are now stored as Supabase Storage paths (e.g. "<uuid>/<file>.pdf"),
  // not URLs. Keep this loose so both new paths and legacy full URLs pass.
  pdf_url: blankToUndef(z.string().max(500).optional()),
  static_website: z.object({ html: z.string(), css: z.string(), js: z.string() }).optional(),
  quiz_payload: z.object({
    timerSeconds: z.number().int().optional(),
    passingPercent: z.number().int().optional(),
    questions: z.array(z.object({
      id: z.string(), prompt: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string().optional(),
    })),
  }).optional(),
});

app.post("/nodes", requireRole("creator", "admin"), async (req, res) => {
  const parsed = NodeCreate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const d = parsed.data;
  const result = await withDb(async (db) => {
    const courseId = await moduleCourseId(db, d.moduleId);
    if (!courseId) return { notFound: true } as const;
    const check = await assertCanWriteCourse(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { count } = await db.from("nodes").select("id", { count: "exact", head: true }).eq("module_id", d.moduleId);
    const { data, error } = await db.from("nodes").insert({
      module_id: d.moduleId, type: d.type, title: d.title, position: count || 0,
      duration_seconds: d.duration_seconds, is_free_preview: d.is_free_preview,
      video_url: d.video_url, video_provider: d.video_provider,
      video_chapters: d.video_chapters, video_subtitles: d.video_subtitles,
      markdown: d.markdown, pdf_url: d.pdf_url,
      static_website: d.static_website, quiz_payload: d.quiz_payload,
    }).select("*").single();
    if (error) throw error;
    return data;
  }, () => ({ id: `n-${Date.now()}`, ...d }));
  if (result && "ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if (result && "notFound" in result) return fail(res, 404, "Module not found", "NOT_FOUND");
  await publish(Topics.COURSE_NODE_ADDED, { nodeId: (result as { id: string }).id, moduleId: d.moduleId });
  ok(res, result);
});

app.patch("/nodes/:id", requireRole("creator", "admin"), async (req, res) => {
  // Lesson type is chosen at creation and locked thereafter — strip any attempt
  // to change it (or move the lesson to a different module). The UI doesn't
  // expose either, but a hand-crafted request must not be able to either.
  const { type: _t, module_id: _m, id: _i, ...patch } = req.body || {};
  void _t; void _m; void _i;
  // Structured video extras (chapters/subtitles) must be well-formed; the rest
  // of the patch is plain column updates covered by DB constraints.
  const extras = NodeVideoExtras.safeParse(patch);
  if (!extras.success) return fail(res, 400, extras.error.issues[0].message, "VALIDATION");
  const result = await withDb(async (db) => {
    const courseId = await nodeCourseId(db, req.params.id);
    if (!courseId) return { notFound: true } as const;
    const check = await assertCanWriteCourse(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    const { data } = await db.from("nodes").update(patch).eq("id", req.params.id).select("*").maybeSingle();
    return data;
  }, null);
  if (result && "ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if (result && "notFound" in result) return fail(res, 404, "Lesson not found", "NOT_FOUND");
  ok(res, result);
});

app.delete("/nodes/:id", requireRole("creator", "admin"), async (req, res) => {
  const result = await withDb<{ notFound: true } | { deleted: true } | WriteCheck>(async (db) => {
    const courseId = await nodeCourseId(db, req.params.id);
    if (!courseId) return { notFound: true } as const;
    const check = await assertCanWriteCourse(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!check.ok) return check;
    await db.from("nodes").delete().eq("id", req.params.id);
    return { deleted: true } as const;
  }, () => ({ deleted: true } as const));
  if ("ok" in result && result.ok === false) return fail(res, result.status, result.message, result.code, result.meta);
  if ("notFound" in result) return fail(res, 404, "Lesson not found", "NOT_FOUND");
  ok(res, { deleted: true });
});

// PDF lesson upload — hand the client a one-time signed URL so the file streams
// straight from the browser to Supabase Storage. The course-service never sees
// the file bytes. Bucket is PRIVATE — viewing happens via a separate
// /pdf-view-url endpoint that gates on enrollment.
const PDF_BUCKET = "node-pdfs";
const PDF_MAX_BYTES = 26_214_400; // 25 MiB, matches storage.buckets.file_size_limit
const PDF_VIEW_TTL_SECONDS = 60 * 60; // 1h — long enough to read, short enough that a leaked URL goes stale fast.

// Extract a storage-relative path from whatever's stored in nodes.pdf_url. Old
// rows still have the full public CDN URL; new uploads store just the path.
function pdfStoragePath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const marker = "/node-pdfs/";
  const idx = stored.indexOf(marker);
  if (idx >= 0) return stored.slice(idx + marker.length);
  // Already a bare path like "<uuid>/<file>.pdf"
  return stored.replace(/^\/+/, "");
}

// Lets a creator preview a PDF they just uploaded, before the lesson has been
// saved to the DB. The path must live under their own creator-id prefix —
// enforced by the upload endpoint that mints these paths.
app.post("/uploads/pdf-view-url", requireRole("creator", "admin"), async (req, res) => {
  const raw = String(req.body?.path || "");
  const path = pdfStoragePath(raw);
  if (!path || (!path.startsWith(`${req.user!.id}/`) && req.user!.role !== "admin")) {
    return fail(res, 403, "Cannot sign this path", "FORBIDDEN");
  }
  const result = await withDb(async (db) => {
    const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUrl(path, 60 * 60);
    if (error) throw error;
    return { signedUrl: data.signedUrl };
  }, null);
  if (!result) return fail(res, 503, "Storage not configured", "STORAGE_OFFLINE");
  ok(res, result);
});

app.post("/uploads/pdf-url", requireRole("creator", "admin"), async (req, res) => {
  const filename = String(req.body?.filename || "");
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return fail(res, 400, "Only PDF files allowed", "VALIDATION");
  }
  const size = Number(req.body?.sizeBytes || 0);
  if (size <= 0 || size > PDF_MAX_BYTES) {
    return fail(res, 400, "PDF too large (max 25MB)", "VALIDATION");
  }
  const path = `${req.user!.id}/${randomUUID()}.pdf`;
  const result = await withDb(async (db) => {
    // Atomic reserve. The RPC takes a row-level lock on creator_storage,
    // checks (bytes_used + pending_bytes + requested) against the cap,
    // and bumps pending_bytes if it fits — so two concurrent uploads
    // CAN'T both pass the check on a stale read. The pending reservation
    // is drained by the storage.objects trigger when the upload lands.
    const { data: reservation, error: reserveError } = await db.rpc("reserve_storage", {
      p_creator_id: req.user!.id,
      p_bytes: size,
      p_free_mb: STORAGE_FREE_MB,
    });
    if (reserveError) throw reserveError;
    const r = Array.isArray(reservation) ? reservation[0] : reservation;
    if (!r?.ok) {
      return {
        overQuota: true,
        used: Number(r?.bytes_used ?? 0),
        quota: Number(r?.quota_bytes ?? STORAGE_FREE_MB * BYTES_PER_MB),
        needed: size,
        priceInrPerMb: STORAGE_PRICE_PER_MB_INR,
      } as const;
    }

    const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    return { signedUrl: data.signedUrl, token: data.token, path } as const;
  }, null);
  if (!result) return fail(res, 503, "Storage not configured", "STORAGE_OFFLINE");
  if ("overQuota" in result) {
    return fail(
      res, 402,
      `You're over your storage quota. Free up space or buy more MB at ₹${STORAGE_PRICE_PER_MB_INR}/MB.`,
      "QUOTA_EXCEEDED",
      { used: result.used, quota: result.quota, needed: result.needed, priceInrPerMb: result.priceInrPerMb },
    );
  }
  ok(res, result);
});

// Confirm a completed PDF upload so its bytes count toward the creator's storage
// quota. The browser streams the file straight to Supabase Storage via the signed
// URL, so the bytes never reach us — the client reports the size here and we commit
// it (and drain the reservation made in /uploads/pdf-url). This is the authoritative
// accounting; the storage.objects trigger is a no-op (see migration 0035).
app.post("/uploads/pdf-confirm", requireRole("creator", "admin"), async (req, res) => {
  const path = String(req.body?.path || "");
  const size = Number(req.body?.sizeBytes || 0);
  if (!path || (!path.startsWith(`${req.user!.id}/`) && req.user!.role !== "admin")) {
    return fail(res, 403, "Cannot confirm this path", "FORBIDDEN");
  }
  if (size <= 0 || size > PDF_MAX_BYTES) {
    return fail(res, 400, "Invalid file size", "VALIDATION");
  }
  // Bill the file's owner — the path prefix — matching the "<creatorId>/<uuid>.pdf"
  // convention that /uploads/pdf-url mints.
  const creatorId = path.split("/")[0];
  const result = await withDb(async (db) => {
    const { error } = await db.rpc("commit_storage", { p_creator_id: creatorId, p_bytes: size });
    if (error) throw error;
    return { committed: true } as const;
  }, null);
  if (!result) return fail(res, 503, "Storage not configured", "STORAGE_OFFLINE");
  ok(res, result);
});

// Signed read URL for a PDF lesson. Gated by enrollment (or ownership/admin).
// Short TTL so a copied link rots within an hour; combined with the canvas
// renderer + disabled save UI on the frontend, this raises the bar a lot.
app.get("/nodes/:nodeId/pdf-view-url", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    const { data: node } = await db.from("nodes")
      .select("type, pdf_url, modules!inner(course_id, courses!inner(creator_id))")
      .eq("id", req.params.nodeId)
      .maybeSingle();
    if (!node) return { notFound: true } as const;
    if (node.type !== "pdf" || !node.pdf_url) return { invalid: true } as const;
    const path = pdfStoragePath(node.pdf_url);
    if (!path) return { invalid: true } as const;
    // Flatten the nested relations and check entitlement.
    type Rel = { course_id: string; courses: { creator_id: string } | { creator_id: string }[] };
    const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
    const mod = one(node.modules) as Rel | undefined;
    const courseId = mod?.course_id;
    const creatorId = (one(mod?.courses) as { creator_id: string } | undefined)?.creator_id;
    if (!courseId || !creatorId) return { invalid: true } as const;
    const isOwner = req.user!.id === creatorId || req.user!.role === "admin";
    if (!isOwner) {
      const { data: enr } = await db.from("enrollments")
        .select("id, access_expires_at").eq("learner_id", req.user!.id).eq("course_id", courseId).maybeSingle();
      const expiresAt = (enr as { access_expires_at?: string | null } | null)?.access_expires_at ?? null;
      const active = !!enr && (expiresAt === null || new Date(expiresAt).getTime() > Date.now());
      if (!active) return { forbidden: true } as const;
    }
    const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUrl(path, PDF_VIEW_TTL_SECONDS);
    if (error || !data) return null;
    return { signedUrl: data.signedUrl, expiresIn: PDF_VIEW_TTL_SECONDS } as const;
  }, null);
  if (!result) return fail(res, 503, "Storage not configured", "STORAGE_OFFLINE");
  if ("notFound" in result) return fail(res, 404, "Lesson not found", "NOT_FOUND");
  if ("invalid" in result) return fail(res, 400, "Lesson has no PDF attached", "VALIDATION");
  if ("forbidden" in result) return fail(res, 403, "Enroll to view this PDF", "FORBIDDEN");
  ok(res, result);
});

// ─── Reviews ──────────────────────────────────────────────────────
app.get("/:id/reviews", async (req, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 10);
  const result = await withDb(async (db) => {
    const { data, count } = await db.from("reviews").select("*", { count: "exact" }).eq("course_id", req.params.id).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    return { items: data || [], total: count || 0 };
  }, () => {
    const all = mock.reviews.filter((r) => r.courseId === req.params.id);
    return { items: all, total: all.length };
  });
  ok(res, result.items, { page, pageSize, total: result.total });
});

const ReviewCreate = z.object({ rating: z.number().int().min(1).max(5), body: z.string().max(2000).optional() });
app.post("/:id/reviews", requireAuth, async (req, res) => {
  const parsed = ReviewCreate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const result = await withDb(async (db) => {
    // Must be enrolled to rate. Service-role bypasses RLS, so enforce here.
    const { data: enr } = await db.from("enrollments")
      .select("id").eq("course_id", req.params.id).eq("learner_id", req.user!.id).maybeSingle();
    if (!enr) return { forbidden: "Enroll in the course before rating it." } as const;
    // One review per (course, learner). Upsert so resubmitting just updates the
    // existing row (the table has unique (course_id, learner_id)). The
    // refresh_course_rating trigger keeps courses.rating_avg / rating_count in sync.
    const { data, error } = await db.from("reviews").upsert({
      course_id: req.params.id, learner_id: req.user!.id,
      rating: parsed.data.rating, body: parsed.data.body ?? null,
    }, { onConflict: "course_id,learner_id" }).select("*").single();
    if (error) throw error;
    return data;
  }, null);
  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if ("forbidden" in result) return fail(res, 403, result.forbidden, "FORBIDDEN");
  ok(res, result);
});

// The current learner's own review for a course (if any), so the rate card on
// the course page can prefill instead of stacking duplicate submissions.
app.get("/:id/reviews/mine", requireAuth, async (req, res) => {
  const review = await withDb(async (db) => {
    const { data } = await db.from("reviews")
      .select("*").eq("course_id", req.params.id).eq("learner_id", req.user!.id).maybeSingle();
    return data;
  }, () => null);
  ok(res, review);
});

// ─── Comments / doubts ───────────────────────────────────────────
// PostgREST can't go comments→profiles directly (comments.author_id FKs users,
// not profiles), but it CAN traverse comments→users→profiles. We flatten back
// to `comment.profiles` so the frontend shape stays the same.
type CommentRow = {
  id: string; node_id: string; author_id: string; parent_id: string | null;
  body: string; upvotes: number; is_resolved: boolean; kind: "comment" | "doubt"; created_at: string;
  reply_count?: number;
  users?: { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null } | null;
  profiles?: { display_name?: string; username?: string; avatar_url?: string } | null;
};
function flattenProfiles(rows: CommentRow[] | null | undefined): CommentRow[] {
  return (rows || []).map((r) => {
    const p = r.users?.profiles || null;
    const out = { ...r, profiles: p } as CommentRow;
    delete out.users;
    return out;
  });
}

// Paginated top-level feed. Replies are NOT embedded — clients fetch them via
// /comments/:id/replies when a thread is expanded. Backed by partial index
// idx_comments_node_top (node_id, kind, created_at desc) where parent_id is null
// — designed so a single popular lesson can have hundreds of thousands of
// comments without the feed slowing down.
app.get("/nodes/:nodeId/comments", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filter = req.query.filter === "doubt" || req.query.filter === "comment" ? req.query.filter : null;
  const result = await withDb(async (db) => {
    let q = db.from("comments")
      .select("*, users!comments_author_id_fkey(profiles(display_name, username, avatar_url))", { count: "exact" })
      .eq("node_id", req.params.nodeId)
      .is("parent_id", null);
    if (filter) q = q.eq("kind", filter);
    const { data, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    const items = flattenProfiles(data as CommentRow[] | null);
    const total = count || 0;
    return { items, total, hasMore: offset + items.length < total };
  }, () => ({ items: [], total: 0, hasMore: false }));
  ok(res, result);
});

// Paginated replies for one parent comment. Chronological — supports
// idx_comments_parent_created (parent_id, created_at). Bounded payload so
// a single thread with 10k replies still serves cheaply per page.
app.get("/comments/:id/replies", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const result = await withDb(async (db) => {
    const { data, count } = await db.from("comments")
      .select("*, users!comments_author_id_fkey(profiles(display_name, username, avatar_url))", { count: "exact" })
      .eq("parent_id", req.params.id)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    const items = flattenProfiles(data as CommentRow[] | null);
    const total = count || 0;
    return { items, total, hasMore: offset + items.length < total };
  }, () => ({ items: [], total: 0, hasMore: false }));
  ok(res, result);
});

// Creator-only Doubts Inbox: every doubt across courses the caller owns, with
// course/status/search/date filters and pagination. Single read with nested
// embeds — no N+1; counts come from two cheap head-only queries.
app.get("/doubts/inbox", requireRole("creator", "admin"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const courseId = typeof req.query.courseId === "string" && req.query.courseId ? req.query.courseId : null;
  const status = req.query.status === "open" || req.query.status === "resolved" ? req.query.status : null;
  const search = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;
  const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : null;
  const dateToRaw = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : null;
  const dateTo = dateToRaw && dateToRaw.length === 10 ? `${dateToRaw}T23:59:59.999Z` : dateToRaw;

  const result = await withDb(async (db) => {
    const base = () => {
      let q = db.from("comments")
        .select("id, nodes!inner(modules!inner(courses!inner(id, creator_id)))", { count: "exact", head: true })
        .eq("kind", "doubt").is("parent_id", null)
        .eq("nodes.modules.courses.creator_id", req.user!.id);
      if (courseId) q = q.eq("nodes.modules.courses.id", courseId);
      return q;
    };
    let listQuery = db.from("comments")
      .select(`
        id, body, kind, is_resolved, created_at, node_id, author_id,
        users!comments_author_id_fkey(profiles(display_name, username, avatar_url)),
        nodes!inner(id, title, modules!inner(id, courses!inner(id, title, creator_id)))
      `, { count: "exact" })
      .eq("kind", "doubt")
      .is("parent_id", null)
      .eq("nodes.modules.courses.creator_id", req.user!.id);
    if (courseId) listQuery = listQuery.eq("nodes.modules.courses.id", courseId);
    if (status) listQuery = listQuery.eq("is_resolved", status === "resolved");
    if (search) listQuery = listQuery.ilike("body", `%${search}%`);
    if (dateFrom) listQuery = listQuery.gte("created_at", dateFrom);
    if (dateTo) listQuery = listQuery.lte("created_at", dateTo);

    const [{ data, count }, openRes, resolvedRes] = await Promise.all([
      listQuery
        .order("is_resolved", { ascending: true })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1),
      base().eq("is_resolved", false),
      base().eq("is_resolved", true),
    ]);

    // Flatten author profile and course/node fields so the UI doesn't dig
    // through nested arrays.
    type Row = {
      id: string; body: string; kind: string; is_resolved: boolean; created_at: string;
      node_id: string; author_id: string;
      users?: { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null } | null;
      nodes?: { id: string; title: string; modules?: { id: string; courses?: { id: string; title: string; creator_id: string } | { id: string; title: string; creator_id: string }[] } | { id: string; courses?: unknown }[] } | null;
    };
    const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
    const items = (data as Row[] | null || []).map((r) => {
      const node = r.nodes;
      const mod = one(node?.modules);
      const course = one((mod as { courses?: unknown } | undefined)?.courses) as { id: string; title: string } | undefined;
      return {
        id: r.id, body: r.body, kind: r.kind, is_resolved: r.is_resolved, created_at: r.created_at,
        node_id: r.node_id, author_id: r.author_id,
        node_title: node?.title || "",
        course_id: course?.id || "",
        course_title: course?.title || "",
        profiles: r.users?.profiles || null,
      };
    });
    return { items, total: count || 0, openCount: openRes.count || 0, resolvedCount: resolvedRes.count || 0 };
  }, { items: [], total: 0, openCount: 0, resolvedCount: 0 });
  ok(res, result.items, { page, pageSize, total: result.total, openCount: result.openCount, resolvedCount: result.resolvedCount });
});

const CommentCreate = z.object({
  body: z.string().min(1).max(5000),
  parentId: z.string().optional(),
  kind: z.enum(["comment", "doubt"]).optional().default("comment"),
});
app.post("/nodes/:nodeId/comments", requireAuth, async (req, res) => {
  const parsed = CommentCreate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { body, parentId, kind } = parsed.data;
  const result = await withDb(async (db) => {
    const { data, error } = await db.from("comments").insert({
      node_id: req.params.nodeId, author_id: req.user!.id, body, parent_id: parentId || null, kind,
    }).select("*").single();
    if (error) throw error;
    // Doubts must reach the creator even in local dev where Redis (the event bus)
    // is not running. We do a synchronous notification insert here, joining
    // node→module→course in a single nested read so it stays cheap.
    if (kind === "doubt" && !parentId) {
      const { data: target } = await db.from("nodes")
        .select("modules!inner(course_id, courses!inner(title, creator_id))")
        .eq("id", req.params.nodeId)
        .maybeSingle();
      // Supabase returns related rows as either an object or array — flatten.
      type T = { course_id: string; title: string; creator_id: string };
      const flat = (v: unknown): T | undefined => {
        const m = (v as { modules?: unknown })?.modules;
        const mod = Array.isArray(m) ? m[0] : m;
        const c = (mod as { courses?: unknown })?.courses;
        const course = Array.isArray(c) ? c[0] : c;
        const modOne = mod as { course_id?: string } | undefined;
        if (!modOne || !course) return undefined;
        return { course_id: modOne.course_id!, title: (course as { title: string }).title, creator_id: (course as { creator_id: string }).creator_id };
      };
      const t = flat(target);
      // Don't ping yourself if you ask a doubt on your own course.
      if (t && t.creator_id !== req.user!.id) {
        await db.from("notifications").insert({
          user_id: t.creator_id,
          type: "doubt",
          title: "New doubt on your course",
          body: `On ${t.title}`,
          // Deeplink: opens the player on the right lesson and focuses the doubt
          // (Player reads ?focus and scrolls + highlights).
          href: `/course/${t.course_id}/learn/${req.params.nodeId}?focus=${(data as { id: string }).id}`,
        });
        await sendRealtimeNotification(t.creator_id, { type: "doubt", nodeId: req.params.nodeId });
      }
    } else if (parentId) {
      // Reply path: tell the parent comment's author (typically the learner who
      // asked the doubt) that someone — usually the creator — answered them.
      const { data: parent } = await db.from("comments").select("id, author_id, kind, node_id").eq("id", parentId).maybeSingle();
      if (parent && parent.author_id !== req.user!.id) {
        const courseId = await nodeCourseId(db, String(req.params.nodeId));
        const { data: course } = courseId
          ? await db.from("courses").select("title, creator_id").eq("id", courseId).maybeSingle()
          : { data: null };
        const isCreatorReply = !!course && (course as { creator_id?: string }).creator_id === req.user!.id;
        await db.from("notifications").insert({
          user_id: parent.author_id,
          type: "doubt_reply",
          title: isCreatorReply ? "The creator replied to you" : "New reply to your post",
          body: course?.title ? `In ${(course as { title: string }).title}` : "You have a new reply",
          href: `/course/${courseId}/learn/${req.params.nodeId}?focus=${parentId}`,
          payload: { commentId: (data as { id: string }).id, parentId },
        });
        await sendRealtimeNotification(parent.author_id, { type: "doubt_reply", nodeId: req.params.nodeId });
      }
    }
    return data;
  }, () => ({ id: `c-${Date.now()}`, node_id: req.params.nodeId, body, kind }));
  await publish(parentId ? Topics.COMMENT_REPLIED : Topics.COMMENT_CREATED, {
    commentId: (result as { id: string }).id, nodeId: req.params.nodeId, authorId: req.user!.id, kind,
  });
  ok(res, result);
});

app.post("/comments/:id/upvote", requireAuth, async (req, res) => {
  await withDb(async (db) => {
    const { error } = await db.from("comment_upvotes").insert({ comment_id: req.params.id, user_id: req.user!.id });
    if (!error) await db.rpc("increment_upvote", { comment_id: req.params.id }).single();
    return null;
  }, null);
  ok(res, { upvoted: true });
});

// Resolve / reopen a doubt. Only the course owner, an accepted collaborator,
// or an admin may flip resolution state; the doubt's author is notified.
async function setDoubtResolution(req: ExpressRequest, resolved: boolean): Promise<
  | { error: { status: number; message: string; code: string } }
  | { resolved: boolean; changed: boolean }
> {
  const commentId = String(req.params.id);
  return withDb<{ error: { status: number; message: string; code: string } } | { resolved: boolean; changed: boolean }>(async (db) => {
    const { data: comment } = await db.from("comments").select("id, node_id, author_id, is_resolved").eq("id", commentId).maybeSingle();
    if (!comment) return { error: { status: 404, message: "Comment not found", code: "NOT_FOUND" } };
    const courseId = await nodeCourseId(db, comment.node_id);
    if (!courseId) return { error: { status: 404, message: "Lesson not found", code: "NOT_FOUND" } };
    const role = await courseEditorRole(db, courseId, req.user!.id, req.user!.role === "admin");
    if (!role) return { error: { status: 403, message: "Only the course owner, collaborators or admins can do this", code: "NOT_EDITOR" } };
    if (comment.is_resolved === resolved) return { resolved, changed: false };

    await db.from("comments").update({ is_resolved: resolved }).eq("id", commentId);
    if (comment.author_id !== req.user!.id) {
      const { data: course } = await db.from("courses").select("title").eq("id", courseId).maybeSingle();
      await db.from("notifications").insert({
        user_id: comment.author_id,
        type: resolved ? "doubt_resolved" : "doubt_reopened",
        title: resolved ? "Your doubt was marked resolved" : "Your doubt was reopened",
        body: course?.title ? `In ${course.title}` : "Check the lesson discussion for updates.",
        href: `/course/${courseId}/learn/${comment.node_id}?focus=${commentId}`,
      });
      await sendRealtimeNotification(comment.author_id, { type: resolved ? "doubt_resolved" : "doubt_reopened", commentId });
    }
    return { resolved, changed: true };
  }, { resolved, changed: true });
}

app.post("/comments/:id/resolve", requireRole("creator", "admin"), async (req, res) => {
  const result = await setDoubtResolution(req, true);
  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  ok(res, result);
});

app.post("/comments/:id/reopen", requireRole("creator", "admin"), async (req, res) => {
  const result = await setDoubtResolution(req, false);
  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  ok(res, result);
});

// ─── Bookmarks (node-level) ──────────────────────────────────────
app.get("/bookmarks", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("bookmarks").select("course_id, created_at, courses(*)").eq("learner_id", req.user!.id);
    return data || [];
  }, () => []);
  ok(res, list);
});

app.post("/bookmarks", requireAuth, async (req, res) => {
  const courseId = String(req.body.courseId || "");
  if (!courseId) return fail(res, 400, "courseId required", "VALIDATION");
  await withDb(async (db) => { await db.from("bookmarks").insert({ learner_id: req.user!.id, course_id: courseId }); return null; }, null);
  ok(res, { bookmarked: true });
});

app.delete("/bookmarks/:courseId", requireAuth, async (req, res) => {
  await withDb(async (db) => {
    await db.from("bookmarks").delete().eq("learner_id", req.user!.id).eq("course_id", req.params.courseId);
    return null;
  }, null);
  ok(res, { bookmarked: false });
});

// ─── Lesson (node-level) bookmarks ───────────────────────────────
// Distinct from /bookmarks above: this saves a specific lesson position so the
// learner can jump straight back to /course/<id>/learn/<nodeId>, not the
// course landing.
app.get("/lesson-bookmarks", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("lesson_bookmarks")
      .select("node_id, course_id, created_at, nodes(id, title, type), courses(id, title, thumbnail_url)")
      .eq("learner_id", req.user!.id)
      .order("created_at", { ascending: false });
    return data || [];
  }, () => []);
  ok(res, list);
});

app.post("/nodes/:nodeId/bookmark", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    // course_id is required on the row; resolve it from the node → module.
    const { data: node } = await db.from("nodes")
      .select("modules!inner(course_id)")
      .eq("id", req.params.nodeId)
      .maybeSingle();
    if (!node) return { notFound: true } as const;
    type Rel = { modules?: { course_id: string } | { course_id: string }[] };
    const m = (node as Rel).modules;
    const courseId = Array.isArray(m) ? m[0]?.course_id : m?.course_id;
    if (!courseId) return { notFound: true } as const;
    // Upsert keyed by (learner_id, node_id) — bookmarking the same lesson
    // twice just touches the row.
    await db.from("lesson_bookmarks").upsert(
      { learner_id: req.user!.id, node_id: req.params.nodeId, course_id: courseId },
      { onConflict: "learner_id,node_id" },
    );
    return { bookmarked: true } as const;
  }, null);
  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if ("notFound" in result) return fail(res, 404, "Lesson not found", "NOT_FOUND");
  ok(res, result);
});

app.delete("/nodes/:nodeId/bookmark", requireAuth, async (req, res) => {
  await withDb(async (db) => {
    await db.from("lesson_bookmarks")
      .delete()
      .eq("learner_id", req.user!.id)
      .eq("node_id", req.params.nodeId);
    return null;
  }, null);
  ok(res, { bookmarked: false });
});

// ─── Collaboration endpoints ──────────────────────────────────────
// Invitations + active collaborations. See Docs/collaboration.md for the
// full design.

// List "people on this course" — owner and all collaborator rows (any status).
// Available to the owner and any collaborator (pending or otherwise).
// PostgREST can't embed profiles directly off course_collaborators.user_id
// (that FK points at users, not profiles), so we go through users → profiles
// and flatten back to `row.profiles` so the frontend shape stays unchanged.
type CollabRowRaw = {
  course_id: string; user_id: string; status: string; role: string;
  invited_by: string; invited_at: string; responded_at: string | null;
  users?: { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null } | null;
  profiles?: { display_name?: string; username?: string; avatar_url?: string } | null;
};
function flattenCollabProfiles(rows: CollabRowRaw[] | null | undefined): CollabRowRaw[] {
  return (rows || []).map((r) => {
    const p = r.users?.profiles || null;
    const out = { ...r, profiles: p } as CollabRowRaw;
    delete out.users;
    return out;
  });
}

app.get("/:id/collaborators", requireAuth, async (req, res) => {
  const result = await withDb<{ forbidden: true } | { items: unknown[] }>(async (db) => {
    const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!role) {
      const { data: own } = await db.from("course_collaborators")
        .select("course_id, user_id, status, role, invited_by, invited_at, responded_at")
        .eq("course_id", req.params.id).eq("user_id", req.user!.id).maybeSingle();
      if (!own) return { forbidden: true } as const;
      return { items: [own] } as const;
    }
    const { data } = await db.from("course_collaborators")
      .select("course_id, user_id, status, role, invited_by, invited_at, responded_at, users:user_id(profiles(display_name, username, avatar_url))")
      .eq("course_id", req.params.id);
    return { items: flattenCollabProfiles(data as CollabRowRaw[] | null) } as const;
  }, () => ({ items: [] as Array<Record<string, unknown>> }));
  if ("forbidden" in result) return fail(res, 403, "Not your course", "FORBIDDEN");
  ok(res, result.items);
});

// Invite a creator. Owner-only. Idempotent: re-inviting a pending row is a
// no-op; re-inviting a declined/removed row resets it to pending.
const InviteBody = z.object({ userId: z.string().uuid() });
app.post("/:id/collaborators", requireRole("creator", "admin"), async (req, res) => {
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const inviteeId = parsed.data.userId;
  if (inviteeId === req.user!.id) return fail(res, 400, "You can't invite yourself", "VALIDATION");

  const result = await withDb(async (db) => {
    const { data: course } = await db.from("courses").select("creator_id, title").eq("id", req.params.id).maybeSingle();
    if (!course) return { notFound: true } as const;
    if ((course as { creator_id: string }).creator_id !== req.user!.id && req.user!.role !== "admin") {
      return { forbidden: true } as const;
    }
    // Invitee must already be a creator.
    const { data: roleRow } = await db.from("user_roles")
      .select("role").eq("user_id", inviteeId).eq("role", "creator").maybeSingle();
    if (!roleRow) return { notCreator: true } as const;
    // Upsert — re-inviting after decline/remove resets the row.
    const { data: row, error } = await db.from("course_collaborators").upsert({
      course_id: req.params.id, user_id: inviteeId,
      status: "pending", role: "editor",
      invited_by: req.user!.id, invited_at: new Date().toISOString(), responded_at: null,
    }, { onConflict: "course_id,user_id" }).select("*").single();
    if (error) throw error;
    // Notify the invitee — synchronous insert (Redis-independent).
    await db.from("notifications").insert({
      user_id: inviteeId,
      type: "collab_invite",
      title: "You've been invited to collaborate",
      body: `On the course "${(course as { title: string }).title}"`,
      href: `/creator/collaborations?focus=${req.params.id}`,
    });
    await sendRealtimeNotification(inviteeId, { type: "collab_invite", courseId: req.params.id });
    return { row } as const;
  }, null);

  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
  if ("forbidden" in result) return fail(res, 403, "Not your course", "FORBIDDEN");
  if ("notCreator" in result) return fail(res, 400, "That user isn't a creator", "VALIDATION");
  // Creator-initiated invites are visible in the collaborator list itself; only
  // admin interventions belong in the admin audit log.
  if (req.user!.role === "admin") {
    await writeAuditLog({ adminId: req.user!.id, action: "collaborator.invited", targetType: "course", targetId: String(req.params.id), metadata: { userId: inviteeId } });
  }
  ok(res, result.row);
});

// Remove a collaborator (owner) or leave a course (self).
app.delete("/:id/collaborators/:userId", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    const { data: course } = await db.from("courses").select("creator_id, title").eq("id", req.params.id).maybeSingle();
    if (!course) return { notFound: true } as const;
    const isOwner = (course as { creator_id: string }).creator_id === req.user!.id;
    const isSelf  = req.params.userId === req.user!.id;
    if (!isOwner && !isSelf && req.user!.role !== "admin") return { forbidden: true } as const;
    if (isOwner && isSelf) return { invalid: "Owners can't leave their own course" } as const;
    const { error } = await db.from("course_collaborators")
      .update({ status: "removed", responded_at: new Date().toISOString() })
      .eq("course_id", req.params.id).eq("user_id", req.params.userId);
    if (error) throw error;
    // Tell the removed user (only when the owner removes them — leaving is
    // self-initiated and doesn't need a notification).
    if (!isSelf) {
      await db.from("notifications").insert({
        user_id: req.params.userId,
        type: "collab_removed",
        title: "Removed from a collaboration",
        body: `${(course as { title: string }).title}`,
        href: `/creator/collaborations`,
      });
      await sendRealtimeNotification(String(req.params.userId), { type: "collab_removed", courseId: req.params.id });
    } else {
      // A collaborator left on their own — the owner should hear about it.
      const ownerId = (course as { creator_id: string }).creator_id;
      await db.from("notifications").insert({
        user_id: ownerId,
        type: "collab_left",
        title: "A collaborator left your course",
        body: `${(course as { title: string }).title}`,
        href: `/creator/courses/${req.params.id}/edit`,
      });
      await sendRealtimeNotification(ownerId, { type: "collab_left", courseId: req.params.id });
    }
    return { ok: true } as const;
  }, null);
  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if ("notFound" in result) return fail(res, 404, "Course not found", "NOT_FOUND");
  if ("forbidden" in result) return fail(res, 403, "Not allowed", "FORBIDDEN");
  if ("invalid" in result) return fail(res, 400, result.invalid ?? "Invalid request", "VALIDATION");
  if (req.user!.role === "admin" && req.params.userId !== req.user!.id) {
    await writeAuditLog({ adminId: req.user!.id, action: "collaborator.removed", targetType: "course", targetId: String(req.params.id), metadata: { userId: req.params.userId } });
  }
  ok(res, { removed: true });
});

// Invitee Accept / Decline.
const RespondBody = z.object({ accept: z.boolean() });
app.post("/collaborations/:courseId/respond", requireAuth, async (req, res) => {
  const parsed = RespondBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const newStatus = parsed.data.accept ? "accepted" : "declined";

  const result = await withDb(async (db) => {
    const { data: row } = await db.from("course_collaborators")
      .select("course_id, user_id, status, invited_by, courses:course_id(title)")
      .eq("course_id", req.params.courseId).eq("user_id", req.user!.id).maybeSingle();
    if (!row) return { notFound: true } as const;
    if ((row as { status: string }).status !== "pending") {
      return { invalid: "This invitation isn't pending" } as const;
    }
    const { error } = await db.from("course_collaborators")
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq("course_id", req.params.courseId).eq("user_id", req.user!.id);
    if (error) throw error;
    // Tell the inviter — both accept and decline get a notification.
    type Joined = { invited_by: string; courses?: { title?: string } | { title?: string }[] | null };
    const r = row as Joined;
    const courseObj = Array.isArray(r.courses) ? r.courses[0] : r.courses;
    await db.from("notifications").insert({
      user_id: r.invited_by,
      type: parsed.data.accept ? "collab_accepted" : "collab_declined",
      title: parsed.data.accept ? "Collaboration accepted" : "Collaboration declined",
      body: courseObj?.title || "",
      href: `/creator/courses/${req.params.courseId}/edit`,
    });
    await sendRealtimeNotification(r.invited_by, { type: parsed.data.accept ? "collab_accepted" : "collab_declined", courseId: req.params.courseId });
    return { ok: true } as const;
  }, null);

  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if ("notFound" in result) return fail(res, 404, "Invitation not found", "NOT_FOUND");
  if ("invalid" in result) return fail(res, 400, result.invalid ?? "Invalid request", "VALIDATION");
  ok(res, { status: newStatus });
});

// My pending invites + accepted collaborations. Same flattening trick as
// /:id/collaborators — go users → profiles, then bring `display_name` up
// onto the row as `inviter` for the frontend.
type MyCollabRowRaw = {
  course_id: string; user_id: string; status: string; role: string;
  invited_by: string; invited_at: string; responded_at: string | null;
  courses?: { id: string; title: string; thumbnail_url?: string | null; creator_id: string } | { id: string; title: string; thumbnail_url?: string | null; creator_id: string }[] | null;
  inviter_user?: { profiles?: { display_name?: string } | null } | null;
  inviter?: { display_name?: string } | null;
};
app.get("/collaborations/mine", requireAuth, async (req, res) => {
  const status = String(req.query.status || "");
  const list = await withDb(async (db) => {
    let q = db.from("course_collaborators")
      .select("course_id, user_id, status, role, invited_by, invited_at, responded_at, courses:course_id(id, title, thumbnail_url, creator_id), inviter_user:invited_by(profiles(display_name))")
      .eq("user_id", req.user!.id);
    if (status === "pending" || status === "accepted" || status === "declined") q = q.eq("status", status);
    else q = q.in("status", ["pending", "accepted"]); // never show declined/removed by default
    const { data } = await q.order("invited_at", { ascending: false });
    return (data as MyCollabRowRaw[] | null || []).map((r) => {
      const out = { ...r, inviter: r.inviter_user?.profiles || null } as MyCollabRowRaw;
      delete out.inviter_user;
      return out;
    });
  }, () => []);
  ok(res, list);
});

// ─── Lock endpoints ───────────────────────────────────────────────

app.get("/:id/lock", requireAuth, async (req, res) => {
  type LockState = Awaited<ReturnType<typeof getCourseLock>>;
  const result = await withDb<{ forbidden: true } | { lock: LockState; role: "owner" | "collaborator" | "admin" }>(async (db) => {
    const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!role) return { forbidden: true } as const;
    const lock = await getCourseLock(db, req.params.id);
    return { lock, role } as const;
  }, () => ({ lock: null, role: "owner" as const }));
  if ("forbidden" in result) return fail(res, 403, "Not an editor of this course", "FORBIDDEN");
  ok(res, { lock: result.lock, role: result.role });
});

app.post("/:id/lock", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    const role = await courseEditorRole(db, req.params.id, req.user!.id, req.user!.role === "admin");
    if (!role) return { forbidden: true } as const;
    const { data, error } = await db.rpc("acquire_course_lock", {
      p_course_id: req.params.id, p_user_id: req.user!.id,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { ...row, role } as const;
  }, () => ({ outcome: "acquired", held_by: req.user!.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), holder_name: "you", role: "owner" }));
  if (result && "forbidden" in result) return fail(res, 403, "Not an editor of this course", "FORBIDDEN");
  ok(res, result);
});

app.post("/:id/lock/heartbeat", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    const now = new Date();
    const newExpires = new Date(now.getTime() + 10 * 60_000);
    const { data } = await db.from("course_edit_locks")
      .update({ last_heartbeat_at: now.toISOString(), expires_at: newExpires.toISOString() })
      .eq("course_id", req.params.id)
      .eq("held_by", req.user!.id)
      .select("expires_at")
      .maybeSingle();
    return { held: !!data, expires_at: data?.expires_at || null };
  }, () => ({ held: true, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }));
  ok(res, result);
});

app.delete("/:id/lock", requireAuth, async (req, res) => {
  await withDb(async (db) => {
    await db.from("course_edit_locks")
      .delete()
      .eq("course_id", req.params.id)
      .eq("held_by", req.user!.id);
    return null;
  }, null);
  ok(res, { released: true });
});

// ─── Storage quota endpoints ──────────────────────────────────────
// Read-only view of the caller's current usage + pricing. Frontend
// renders the "75% full · buy 5 MB" indicator from this.
app.get("/storage/usage", requireRole("creator", "admin"), async (req, res) => {
  const state = await withDb(async (db) => getCreatorStorage(db, req.user!.id), () => ({
    bytes_used: 0, extra_bytes: 0, extra_until: null,
    effective_extra_bytes: 0,
    quota_bytes: STORAGE_FREE_MB * BYTES_PER_MB,
    remaining_bytes: STORAGE_FREE_MB * BYTES_PER_MB,
  } as StorageState));
  ok(res, {
    bytesUsed: state.bytes_used,
    quotaBytes: state.quota_bytes,
    remainingBytes: state.remaining_bytes,
    freeMb: STORAGE_FREE_MB,
    extraBytes: state.effective_extra_bytes,
    extraUntil: state.extra_until,
    pricing: {
      pricePerMbInr: STORAGE_PRICE_PER_MB_INR,
      durationDays: STORAGE_DURATION_DAYS,
    },
  });
});

// Create a Razorpay order to buy N MB. Frontend hands order_id +
// amount to the Razorpay checkout widget; verification happens via
// POST /storage/verify once the user pays.
const PurchaseBody = z.object({ mb: z.number().int().min(1).max(500) });
app.post("/storage/purchase", requireRole("creator", "admin"), async (req, res) => {
  const parsed = PurchaseBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const mb = parsed.data.mb;
  const amountInr = mb * STORAGE_PRICE_PER_MB_INR;
  const amountPaise = amountInr * 100;
  let orderId: string;
  if (isRazorpayConfigured()) {
    try {
      const order = await razorpay().orders.create({
        amount: amountPaise, currency: "INR",
        receipt: `stor_${req.user!.id.slice(0, 8)}_${Date.now()}`,
        notes: { purpose: "creator_storage", creator_id: req.user!.id, mb: String(mb) },
      });
      orderId = order.id;
    } catch {
      return fail(res, 503, "Payment provider unavailable, try again", "RAZORPAY_DOWN");
    }
  } else {
    orderId = `order_dev_${Date.now()}`;
  }
  await withDb(async (db) => {
    await db.from("storage_purchases").insert({
      creator_id: req.user!.id, mb, amount_paise: amountPaise,
      razorpay_order_id: orderId, status: "pending",
    });
    return null;
  }, null);
  ok(res, {
    orderId, amountPaise, currency: "INR", mb,
    keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_dev",
  });
});

// Verify the Razorpay signature on a completed payment and grant the MB.
// Pricing/duration come from env so a single source of truth — even if
// the client lies about `mb`, we re-read the row from storage_purchases
// (which we wrote at order-create time) so the granted MB is what the
// creator actually paid for.
const VerifyBody = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});
app.post("/storage/verify", requireRole("creator", "admin"), async (req, res) => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  if (!isRazorpayConfigured() && process.env.NODE_ENV === "production") {
    return fail(res, 503, "Payment provider not configured", "GATEWAY_OFFLINE");
  }
  if (isRazorpayConfigured()) {
    const valid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!valid) return fail(res, 400, "Invalid payment signature", "BAD_SIGNATURE");
  }

  // Atomic — grant_storage handles status check, extra_bytes upsert, status
  // flip, and idempotency in one transaction. Two concurrent verifies for
  // the same order can't double-grant.
  const result = await withDb(async (db) => {
    const { data, error } = await db.rpc("grant_storage", {
      p_order_id: razorpay_order_id,
      p_payment_id: razorpay_payment_id,
      p_caller_id: req.user!.id,
      p_duration_days: STORAGE_DURATION_DAYS,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }, null);

  if (!result) return fail(res, 500, "Failed", "INTERNAL");
  if (!result.ok) {
    if (result.reason === "Order not found") return fail(res, 404, result.reason, "NOT_FOUND");
    if (result.reason === "Not your order") return fail(res, 403, result.reason, "FORBIDDEN");
    return fail(res, 400, result.reason, "GRANT_FAILED");
  }
  if (result.already_applied) return ok(res, { ok: true, alreadyApplied: true });
  ok(res, { granted_mb: result.granted_mb, extra_until: result.extra_until });
});

// Catch-all course fetch — MUST be last. Express matches in registration
// order, so any literal one-segment GET path declared above wins over this.
app.get("/:id", async (req, res) => {
  const c = await withDb(async (db) => {
    const { data } = await db.from("courses").select("*, modules(*, nodes(*))").eq("id", req.params.id).maybeSingle();
    // PostgREST returns embedded modules/nodes unordered — sort by position so
    // the editor (and player) always see the curriculum in the saved order.
    if (data) (data as { modules?: unknown }).modules = sortCourseTree((data as { modules?: (WithPosition & { nodes?: WithPosition[] | null })[] }).modules);
    return data;
  }, () => mock.courses.find((x) => x.id === req.params.id));
  if (!c) return fail(res, 404, "Course not found", "NOT_FOUND");
  ok(res, c);
});

listen(PORT);
