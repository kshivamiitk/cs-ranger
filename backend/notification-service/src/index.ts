import { createService, ok, fail, paginate, mock, requireAuth, requireRole, withDb, consume, Topics, sendEmail, sendBulkEmail, emailLayout, sendRealtimeNotification, writeAuditLog } from "@cs-ranger/shared";
import { z } from "zod";

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

// ─── Admin broadcast ──────────────────────────────────────────────
// One admin message fanned out to every targeted account over two channels:
// an in-app notification (single bulk insert) and a transactional email
// (batched, one private message per recipient). Every send is audited.
const BroadcastSchema = z.object({
  subject: z.string().trim().min(3, "Subject must be at least 3 characters").max(150, "Subject is too long (max 150 characters)"),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(5000, "Message is too long (max 5000 characters)"),
  // "all" = every active user (learners AND creators) — the default broadcast.
  audience: z.enum(["all", "learners", "creators"]).default("all"),
  channels: z.object({ email: z.boolean(), inapp: z.boolean() }).default({ email: true, inapp: true }),
}).strict();

// Safety ceiling for a single synchronous send. Well above a realistic active
// user base; a broadcast larger than this should go through a dedicated ESP
// campaign, not this endpoint.
const MAX_BROADCAST_RECIPIENTS = 5000;

interface BroadcastRecipient { id: string; email: string; is_verified: boolean }

async function resolveBroadcastRecipients(audience: "all" | "learners" | "creators"): Promise<BroadcastRecipient[]> {
  return withDb(async (db) => {
    if (audience === "all") {
      const { data, error } = await db.from("users").select("id, email, is_verified").eq("is_suspended", false);
      if (error) throw error;
      return (data || []) as BroadcastRecipient[];
    }
    const role = audience === "creators" ? "creator" : "learner";
    const { data, error } = await db
      .from("users")
      .select("id, email, is_verified, user_roles!inner(role)")
      .eq("is_suspended", false)
      .eq("user_roles.role", role);
    if (error) throw error;
    // The inner join on user_roles can repeat a user row; de-dupe by id.
    const seen = new Set<string>();
    const out: BroadcastRecipient[] = [];
    for (const r of (data || []) as BroadcastRecipient[]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, email: r.email, is_verified: r.is_verified });
    }
    return out;
  }, []);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function broadcastHtml(subject: string, message: string): string {
  // Admin-authored plain text → safe HTML: escape, then keep line breaks.
  const body = escapeHtml(message).replace(/\n/g, "<br/>");
  return emailLayout(
    `<h1 style="margin:0 0 16px;font-size:22px;">${escapeHtml(subject)}</h1>
     <div style="font-size:15px;line-height:1.7;color:#e2e8f0;">${body}</div>`,
    { preheader: subject },
  );
}

app.post("/admin/broadcast", requireRole("admin"), async (req, res) => {
  const parsed = BroadcastSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const { subject, message, audience, channels } = parsed.data;
  if (!channels.email && !channels.inapp) return fail(res, 400, "Select at least one channel (email or in-app).", "VALIDATION");

  const recipients = await resolveBroadcastRecipients(audience);
  if (recipients.length === 0) return fail(res, 400, "No active users match this audience.", "NO_RECIPIENTS");
  if (recipients.length > MAX_BROADCAST_RECIPIENTS) {
    return fail(res, 413, `This broadcast would reach ${recipients.length} users, above the ${MAX_BROADCAST_RECIPIENTS} per-send safety cap.`, "TOO_MANY_RECIPIENTS");
  }

  // In-app: a single bulk insert (one Supabase round trip for the whole audience).
  // No per-user realtime ping here — that would be thousands of socket messages;
  // the bell picks the rows up on its next poll.
  let inappCreated = 0;
  if (channels.inapp) {
    inappCreated = await withDb(async (db) => {
      const rows = recipients.map((u) => ({
        user_id: u.id,
        type: "broadcast",
        title: subject,
        body: message,
        payload: { broadcast: true, audience },
      }));
      const { error } = await db.from("notifications").insert(rows);
      if (error) throw error;
      return rows.length;
    }, 0);
  }

  // Email: only to verified addresses (unverified accounts never confirmed the
  // mailbox — sending risks bounces / spam complaints against our domain).
  const emailTargets = channels.email ? recipients.filter((u) => u.is_verified && u.email).map((u) => u.email) : [];
  const emailResult = emailTargets.length
    ? await sendBulkEmail({ to: emailTargets, subject, html: broadcastHtml(subject, message), text: message })
    : { total: 0, sent: 0, failed: 0 };

  await writeAuditLog({
    adminId: req.user!.id,
    action: "broadcast.send",
    targetType: "broadcast",
    metadata: {
      subject, audience, channels,
      recipientCount: recipients.length,
      emailTargeted: emailTargets.length,
      emailSent: emailResult.sent,
      emailFailed: emailResult.failed,
      emailError: emailResult.error,
      inappCreated,
    },
  });
  log.info("admin broadcast sent", { audience, recipientCount: recipients.length, emailSent: emailResult.sent, emailFailed: emailResult.failed, emailError: emailResult.error, inappCreated });

  ok(res, {
    audience,
    recipientCount: recipients.length,
    inappCreated,
    emailTargeted: emailTargets.length,
    emailSent: emailResult.sent,
    emailFailed: emailResult.failed,
    emailError: emailResult.error,
  });
});

// Audience preview — how many accounts a broadcast would reach, and how many
// of those have a verified address (the email-eligible subset). Lets the admin
// confirm the blast radius before sending something irreversible.
app.get("/admin/broadcast/audience", requireRole("admin"), async (req, res) => {
  const raw = String(req.query.audience || "all");
  const audience = (["all", "learners", "creators"].includes(raw) ? raw : "all") as "all" | "learners" | "creators";
  const recipients = await resolveBroadcastRecipients(audience);
  ok(res, {
    audience,
    recipientCount: recipients.length,
    emailEligible: recipients.filter((u) => u.is_verified && u.email).length,
  });
});

// Broadcast history — derived from the immutable admin_audit_log (no extra
// table needed); each "broadcast.send" row carries the full delivery summary.
app.get("/admin/broadcasts", requireRole("admin"), async (_req, res) => {
  const rows = await withDb(async (db) => {
    const { data, error } = await db
      .from("admin_audit_log")
      .select("id, admin_id, metadata, created_at, admin:users!admin_audit_log_admin_id_fkey(email, profiles(display_name))")
      .eq("action", "broadcast.send")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }, []);
  ok(res, rows);
});

listen(PORT);
