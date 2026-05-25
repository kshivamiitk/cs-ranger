import { createService, ok, paginate, mock, requireAuth, withDb, consume, Topics, sendEmail, emailLayout, sendRealtimeNotification } from "@cs-ranger/shared";

const { app, listen, log } = createService("notification-service");
const PORT = Number(process.env.PORT_NOTIFICATION || 4009);
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

async function createNotif(userId: string, type: string, title: string, body: string, href?: string, payload: Record<string, unknown> = {}) {
  await withDb(async (db) => {
    await db.from("notifications").insert({ user_id: userId, type, title, body, href, payload });
    return null;
  }, null);
  // Realtime wake-up so the bell updates without waiting for the next poll.
  await sendRealtimeNotification(userId, { type });
}

// ─── Event consumers ──────────────────────────────────────────────
consume<{ userId: string; email: string; displayName: string }>(Topics.USER_REGISTERED, async ({ email, displayName }) => {
  // Welcome email is sent by auth-service for verification; this is for any *post-verification* welcome.
  log.info("user.registered processed", { email, displayName });
});

consume<{ enrollmentId: string; learnerId: string; courseId: string }>(Topics.ENROLLMENT_CREATED, async ({ learnerId, courseId }) => {
  const course = await withDb(async (db) => {
    const { data } = await db.from("courses").select("title, creator_id").eq("id", courseId).maybeSingle();
    return data;
  }, null);
  if (!course) return;
  await createNotif(learnerId, "enrollment", "Enrollment confirmed", `Welcome to ${course.title}!`, `/course/${courseId}/learn/start`);
  // Email
  const learner = await withDb(async (db) => {
    const { data: profile } = await db.from("profiles").select("display_name").eq("user_id", learnerId).maybeSingle();
    const { data: user } = await db.from("users").select("email").eq("id", learnerId).maybeSingle();
    return { displayName: profile?.display_name, email: user?.email };
  }, () => ({ displayName: "Learner", email: "" }));
  if (learner.email) {
    await sendEmail({
      to: learner.email,
      subject: `Welcome to ${course.title}`,
      html: emailLayout(`<h1>You're enrolled, ${learner.displayName?.split(" ")[0] || "there"}!</h1>
        <p>Your spot in <b>${course.title}</b> is confirmed.</p>
        <p style="margin:24px 0;"><a href="${APP_URL}/course/${courseId}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(135deg,#a78bfa,#22d3ee);color:white;text-decoration:none;font-weight:600;">Start learning</a></p>`),
    });
  }
});

consume<{ enrollmentId: string; learnerId: string; courseId: string }>(Topics.ENROLLMENT_COMPLETED, async ({ learnerId, courseId }) => {
  const course = await withDb(async (db) => {
    const { data } = await db.from("courses").select("title").eq("id", courseId).maybeSingle();
    return data;
  }, null);
  await createNotif(learnerId, "completion", "Course completed! 🎉", `You finished ${course?.title || "a course"}`, "/achievements");
});

consume<{ creatorId: string; status: string }>(Topics.KYC_STATUS_CHANGED, async ({ creatorId, status }) => {
  await createNotif(creatorId, "kyc", `KYC ${status}`, status === "approved" ? "You can now receive payouts." : "KYC verification needs attention.", "/creator/finance");
});

consume<{ creatorId: string; payoutId: string; amount: number }>(Topics.PAYOUT_COMPLETED, async ({ creatorId, amount }) => {
  await createNotif(creatorId, "payout", "Payout processed", `₹${(amount / 100).toLocaleString("en-IN")} has been credited to your account.`, "/creator/finance");
});

consume<{ commentId: string; nodeId: string; kind?: "comment" | "doubt" }>(Topics.COMMENT_CREATED, async ({ nodeId, commentId, kind }) => {
  // Notifications for doubts are now written synchronously by course-service so
  // they work without Redis. When Redis is configured this consumer would
  // duplicate that work, so it short-circuits unless the payload is an old
  // pre-kind event (treat missing kind as 'doubt' for back-compat).
  if (kind && kind !== "doubt") return;
  const target = await withDb(async (db) => {
    const { data: node } = await db.from("nodes")
      .select("modules!inner(courses!inner(title, creator_id))")
      .eq("id", nodeId)
      .maybeSingle();
    type CourseRel = { title: string; creator_id: string };
    const toOne = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
    const mod = toOne((node as { modules?: unknown } | null)?.modules);
    return toOne((mod as { courses?: unknown } | undefined)?.courses) as CourseRel | undefined;
  }, null);
  if (!target) return;
  // Idempotency guard: skip if course-service already inserted a notification
  // for this exact comment (matched via the href payload below would be cleaner,
  // but our notifications table has no comment_id column — so we check for a
  // recent identical row).
  const dup = await withDb(async (db) => {
    const { data } = await db.from("notifications")
      .select("id")
      .eq("user_id", target.creator_id)
      .eq("type", "doubt")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString())
      .limit(1).maybeSingle();
    return !!data;
  }, false);
  if (dup) return;
  await createNotif(target.creator_id, "doubt", "New doubt on your course", `In ${target.title}`, `/creator/doubts`);
  void commentId;
});

// ─── REST ─────────────────────────────────────────────────────────
app.get("/", requireAuth, async (req, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  type ListResult = { items: unknown[]; total: number } | { items: unknown[]; meta: { page: number; pageSize: number; total: number } };
  const result = await withDb<ListResult>(async (db) => {
    const { data, count } = await db.from("notifications").select("*", { count: "exact" }).eq("user_id", req.user!.id).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    return { items: data || [], total: count || 0 };
  }, () => paginate(mock.notifications.filter((n) => n.userId === req.user!.id), page, pageSize));
  ok(res, result.items, { page, pageSize, total: "total" in result ? result.total : 0 });
});

app.get("/unread-count", requireAuth, async (req, res) => {
  const count = await withDb(async (db) => {
    const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", req.user!.id).eq("is_read", false);
    return count || 0;
  }, () => mock.notifications.filter((n) => n.userId === req.user!.id && !n.isRead).length);
  ok(res, { count });
});

app.put("/:id/read", requireAuth, async (req, res) => {
  await withDb(async (db) => { await db.from("notifications").update({ is_read: true }).eq("id", req.params.id).eq("user_id", req.user!.id); return null; }, null);
  ok(res, { read: true });
});

app.put("/read-all", requireAuth, async (req, res) => {
  await withDb(async (db) => { await db.from("notifications").update({ is_read: true }).eq("user_id", req.user!.id).eq("is_read", false); return null; }, null);
  ok(res, { read: true });
});

app.get("/preferences", requireAuth, async (req, res) => {
  const rows = await withDb(async (db) => {
    const { data } = await db.from("notification_preferences").select("*").eq("user_id", req.user!.id);
    return data || [];
  }, () => []);
  ok(res, rows);
});

app.put("/preferences", requireAuth, async (req, res) => {
  const prefs = (Array.isArray(req.body) ? req.body : []) as { eventType: string; emailEnabled: boolean; inappEnabled: boolean }[];
  await withDb(async (db) => {
    if (prefs.length === 0) return null;
    // Single batched upsert instead of one round trip per preference row.
    await db.from("notification_preferences").upsert(
      prefs.map((p) => ({ user_id: req.user!.id, event_type: p.eventType, email_enabled: p.emailEnabled, inapp_enabled: p.inappEnabled })),
      { onConflict: "user_id,event_type" },
    );
    return null;
  }, null);
  ok(res, { saved: true });
});

listen(PORT);
