import { createService, ok, fail, paginate, mock, requireAuth, withDb, publish, Topics, getPlatformSetting } from "@cs-ranger/shared";
import { z } from "zod";
import { registerAdminRoutes } from "./admin.js";
import { registerUploadRoutes } from "./uploads.js";
import { registerOnboardingRoutes } from "./onboarding.js";

const { app, listen } = createService("user-service");
const PORT = Number(process.env.PORT_USER || 4002);

// Admin governance: platform settings, audit log, user management.
// Registered before the param routes so /admin/* never collides with /:creatorId/*.
registerAdminRoutes(app);
// Avatar upload pipeline (/uploads/*) — registered before /:creatorId/* params.
registerUploadRoutes(app);
// Resumable 4-step onboarding (/me/onboarding*).
registerOnboardingRoutes(app);

app.get("/me", requireAuth, async (req, res) => {
  const profile = await withDb(async (db) => {
    // Profile and roles are independent lookups keyed on the same user id —
    // run them in parallel instead of sequentially to halve the round-trip time
    // on this hot path (loaded on every app bootstrap).
    const [{ data }, { data: roles }] = await Promise.all([
      db.from("profiles").select("*, users!profiles_user_id_fkey(email, is_verified, created_at)").eq("user_id", req.user!.id).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", req.user!.id),
    ]);
    if (!data) return null;
    return { ...data, roles: roles?.map((r) => r.role) || ["learner"] };
  }, () => mock.users.find((u) => u.id === req.user!.id) || mock.users[0]);
  if (!profile) return fail(res, 404, "Profile not found", "NOT_FOUND");
  ok(res, profile);
});

app.get("/check-username", async (req, res) => {
  const username = String(req.query.username || "").toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(username)) return fail(res, 400, "Invalid format", "VALIDATION");
  const taken = await withDb(async (db) => {
    const { data } = await db.from("profiles").select("user_id").eq("username", username).maybeSingle();
    return !!data;
  }, () => mock.users.some((u) => u.username === username));
  ok(res, { available: !taken });
});

const UpdateSchema = z.object({
  displayName: z.string().min(2).max(60).optional(),
  username: z.string().regex(/^[a-z0-9_]{3,30}$/).optional(),
  bio: z.string().max(500).optional(),
  college: z.string().max(100).optional(),
  themePreference: z.enum(["light", "dark", "system"]).optional(),
  socialLinks: z.object({ linkedin: z.string().url().optional(), twitter: z.string().url().optional(), github: z.string().url().optional(), website: z.string().url().optional() }).optional(),
  avatarUrl: z.string().url().optional(),
});
app.put("/me", requireAuth, async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const p = parsed.data;
  const result = await withDb(async (db) => {
    const { data, error } = await db.from("profiles").update({
      display_name: p.displayName, username: p.username, bio: p.bio, college: p.college,
      theme_preference: p.themePreference, social_links: p.socialLinks, avatar_url: p.avatarUrl,
    }).eq("user_id", req.user!.id).select("*").maybeSingle();
    if (error) {
      if (String(error.message).includes("duplicate")) throw new Error("USERNAME_TAKEN");
      throw error;
    }
    return data;
  }, null);
  if (!result) return fail(res, 500, "Update failed", "INTERNAL");
  ok(res, result);
});

// Public profile by username
app.get("/by-username/:username", async (req, res) => {
  // Loose generic: the DB rows and the dev mock differ in field nullability but
  // the handler only null-checks and forwards the object.
  const data = await withDb<{ profile: unknown; roles: unknown; courses: unknown } | null>(async (db) => {
    const { data: profile } = await db.from("profiles").select("*").eq("username", req.params.username).maybeSingle();
    if (!profile) return null;
    const [{ data: roles }, { data: courses }] = await Promise.all([
      db.from("user_roles").select("role").eq("user_id", profile.user_id),
      db.from("courses").select("id, title, subtitle, thumbnail_url, price, discounted_price, rating_avg, enrollment_count").eq("creator_id", profile.user_id).eq("status", "published"),
    ]);
    return { profile, roles: roles?.map((r) => r.role) || ["learner"], courses };
  }, () => {
    const u = mock.users.find((x) => x.username === req.params.username);
    if (!u) return null;
    return { profile: u, roles: u.roles, courses: mock.courses.filter((c) => c.creatorId === u.id) };
  });
  if (!data) return fail(res, 404, "User not found", "NOT_FOUND");
  ok(res, data);
});

// Subscriptions (follow creators)
app.post("/:creatorId/subscribe", requireAuth, async (req, res) => {
  if (req.user!.id === req.params.creatorId) return fail(res, 400, "Cannot subscribe to yourself", "VALIDATION");
  await withDb(async (db) => { await db.from("subscriptions").insert({ learner_id: req.user!.id, creator_id: req.params.creatorId }); return null; }, null);
  ok(res, { subscribed: true });
});

app.delete("/:creatorId/subscribe", requireAuth, async (req, res) => {
  await withDb(async (db) => { await db.from("subscriptions").delete().eq("learner_id", req.user!.id).eq("creator_id", req.params.creatorId); return null; }, null);
  ok(res, { subscribed: false });
});

app.get("/:creatorId/subscribers/count", async (req, res) => {
  const count = await withDb(async (db) => {
    const { count } = await db.from("subscriptions").select("learner_id", { count: "exact", head: true }).eq("creator_id", req.params.creatorId);
    return count || 0;
  }, () => 0);
  ok(res, { count });
});

// ─── Following list + feed ────────────────────────────────────────

// Creators the caller follows (drives the Subscribe button state and /feed).
app.get("/me/subscriptions", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("subscriptions")
      .select("creator_id, created_at, users:creator_id(profiles(display_name, username, avatar_url))")
      .eq("learner_id", req.user!.id)
      .order("created_at", { ascending: false });
    type Row = { creator_id: string; created_at: string; users?: { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null } | { profiles?: { display_name?: string; username?: string; avatar_url?: string } | null }[] | null };
    return ((data as Row[] | null) || []).map((r) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      return { creator_id: r.creator_id, followed_at: r.created_at, profile: u?.profiles || null };
    });
  }, () => []);
  ok(res, list);
});

// Activity from followed creators — currently "new course published" events,
// newest first, paginated. Returns a stable empty result when the caller
// follows nobody yet.
app.get("/me/feed", requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 20)));
  const result = await withDb<{ items: unknown[]; total: number }>(async (db) => {
    const { data: subs } = await db.from("subscriptions").select("creator_id").eq("learner_id", req.user!.id);
    const creatorIds = (subs || []).map((s) => s.creator_id);
    if (creatorIds.length === 0) return { items: [], total: 0 };

    const { data, count } = await db.from("courses")
      .select("id, title, subtitle, thumbnail_url, price, discounted_price, rating_avg, enrollment_count, level, published_at, creator_id, users:creator_id(profiles(display_name, username, avatar_url))", { count: "exact" })
      .in("creator_id", creatorIds)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    type Row = Record<string, unknown> & { users?: { profiles?: Record<string, unknown> | null } | { profiles?: Record<string, unknown> | null }[] | null };
    const items = ((data as Row[] | null) || []).map((c) => {
      const u = Array.isArray(c.users) ? c.users[0] : c.users;
      const { users: _users, ...course } = c;
      return { type: "course_published", at: c.published_at, course, creator: u?.profiles || null };
    });
    return { items, total: count || 0 };
  }, { items: [], total: 0 });
  ok(res, result.items, { page, pageSize, total: result.total });
});

// Creator T&C status — drives the acceptance modal and the submit-for-review gate.
app.get("/me/creator-terms-status", requireAuth, async (req, res) => {
  const [currentVersion, commissionRate] = await Promise.all([
    getPlatformSetting("creator_terms_version", "2026-05-01"),
    getPlatformSetting("commission_rate", 0.15),
  ]);
  const acceptance = await withDb(async (db) => {
    const { data } = await db.from("creator_terms_acceptance")
      .select("terms_version, accepted_at, commission_rate_at_acceptance")
      .eq("creator_id", req.user!.id)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }, null);
  ok(res, {
    currentVersion: String(currentVersion),
    commissionRate: Number(commissionRate),
    acceptedVersion: acceptance?.terms_version || null,
    acceptedAt: acceptance?.accepted_at || null,
    accepted: acceptance?.terms_version === String(currentVersion),
  });
});

// Creator T&C acceptance
const TermsAccept = z.object({ termsVersion: z.string(), commissionRate: z.number() });
app.post("/me/accept-creator-terms", requireAuth, async (req, res) => {
  const parsed = TermsAccept.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  await withDb(async (db) => {
    await db.from("creator_terms_acceptance").upsert({
      creator_id: req.user!.id,
      terms_version: parsed.data.termsVersion,
      commission_rate_at_acceptance: parsed.data.commissionRate,
    }, { onConflict: "creator_id,terms_version" });
    // Ensure creator role
    await db.from("user_roles").insert({ user_id: req.user!.id, role: "creator" }).select();
    return null;
  }, null);
  ok(res, { accepted: true });
});

app.get("/", async (req, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  type ListResult = { items: unknown[]; total: number } | { items: unknown[]; meta: { page: number; pageSize: number; total: number } };
  const result = await withDb<ListResult>(async (db) => {
    let q = db.from("profiles").select("*, user_roles!inner(role)", { count: "exact" });
    if (req.query.role) q = q.eq("user_roles.role", req.query.role as string);
    q = q.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count } = await q;
    return { items: data || [], total: count || 0 };
  }, () => {
    const all = mock.users;
    return paginate(all, page, pageSize);
  });
  ok(res, result.items, { page, pageSize, total: "total" in result ? result.total : 0 });
});

void publish; void Topics;
listen(PORT);
