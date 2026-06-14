import { createService, ok, fail, mock, requireAuth, withDb, isSupabaseConfigured, consume, Topics, publish, sendRealtimeNotification, getPlatformSetting, buildCertificatePdf } from "@cs-ranger/shared";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const { app, listen, log } = createService("achievement-service");
const PORT = Number(process.env.PORT_ACHIEVEMENT || 4011);
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

type CertificateTemplate = {
  heading?: string;
  body?: string;
  accentColor?: string;
  footerNote?: string;
};

type CertificateCourseSettings = {
  title?: string;
  creator_id?: string;
  certificate_enabled?: boolean;
  certificate_min_progress?: number | null;
  certificate_require_quiz_pass?: boolean | null;
  certificate_template?: CertificateTemplate | null;
};

type CertificateEligibility =
  | { ok: true; course: CertificateCourseSettings }
  | { ok: false; status: number; message: string; code: string };

async function evaluateCertificateEligibility(db: SupabaseClient, learnerId: string, courseId: string): Promise<CertificateEligibility> {
  const [{ data: enrollment }, { data: course }] = await Promise.all([
    db.from("enrollments").select("completed_at, progress_percent").eq("learner_id", learnerId).eq("course_id", courseId).maybeSingle(),
    db.from("courses")
      .select("title, creator_id, certificate_enabled, certificate_min_progress, certificate_require_quiz_pass, certificate_template")
      .eq("id", courseId)
      .maybeSingle(),
  ]);
  if (!course) return { ok: false, status: 404, message: "Course not found", code: "NOT_FOUND" };
  const c = course as CertificateCourseSettings;
  if (!c.certificate_enabled) return { ok: false, status: 400, message: "This course does not issue certificates", code: "CERTIFICATE_DISABLED" };
  const minProgress = c.certificate_min_progress ?? 100;
  const progress = Number(enrollment?.progress_percent ?? 0);
  if (!enrollment || progress < minProgress) {
    return { ok: false, status: 400, message: `Reach ${minProgress}% course progress before claiming a certificate`, code: "CERTIFICATE_PROGRESS_REQUIRED" };
  }
  if (minProgress >= 100 && !enrollment.completed_at) {
    return { ok: false, status: 400, message: "Complete the course before claiming a certificate", code: "NOT_COMPLETED" };
  }
  if (c.certificate_require_quiz_pass) {
    const { data: quizzes } = await db.from("nodes")
      .select("id, modules!inner(course_id)")
      .eq("type", "quiz")
      .eq("modules.course_id", courseId);
    const quizIds = (quizzes || []).map((q) => q.id).filter(Boolean);
    if (quizIds.length > 0) {
      const { data: passed } = await db.from("quiz_attempts")
        .select("node_id")
        .eq("learner_id", learnerId)
        .eq("passed", true)
        .in("node_id", quizIds);
      const passedIds = new Set((passed || []).map((p) => p.node_id));
      if (quizIds.some((id) => !passedIds.has(id))) {
        return { ok: false, status: 400, message: "Pass every quiz lesson before claiming a certificate", code: "QUIZ_PASS_REQUIRED" };
      }
    }
  }
  return { ok: true, course: c };
}

async function issueCertificate(db: SupabaseClient, learnerId: string, courseId: string) {
  const { data: existing } = await db.from("certificates").select("*").eq("learner_id", learnerId).eq("course_id", courseId).maybeSingle();
  if (existing) return { certificate: existing, alreadyIssued: true };
  const token = randomBytes(8).toString("hex");
  const { data: inserted, error } = await db.from("certificates")
    .insert({ learner_id: learnerId, course_id: courseId, verification_token: token })
    .select("*").maybeSingle();
  if (error || !inserted) {
    const { data: raced } = await db.from("certificates").select("*").eq("learner_id", learnerId).eq("course_id", courseId).maybeSingle();
    if (raced) return { certificate: raced, alreadyIssued: true };
    throw error || new Error("Certificate insert failed");
  }
  const detail = await loadCertificateDetail(db, inserted.id as string);
  if (detail) await storeCertificatePdf(db, detail);
  return { certificate: inserted, alreadyIssued: false };
}

// ─── Streak + badge evaluation on node completion ─────────────────
consume<{ learnerId: string; nodeId: string }>(Topics.NODE_COMPLETED, async ({ learnerId }) => {
  await withDb(async (db) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: streak } = await db.from("user_streaks").select("*").eq("user_id", learnerId).maybeSingle();
    const last = streak?.last_activity_date;
    let current = streak?.current_streak || 0;
    if (!last) {
      current = 1;
    } else {
      const diff = (new Date(today).getTime() - new Date(last).getTime()) / 86400000;
      if (diff === 0) { /* same day, no change */ }
      else if (diff === 1) { current += 1; }
      else if (diff <= 2 && current >= 3) { current += 1; /* grace period */ }
      else { current = 1; }
    }
    const longest = Math.max(current, streak?.longest_streak || 0);
    await db.from("user_streaks").upsert({ user_id: learnerId, current_streak: current, longest_streak: longest, last_activity_date: today }, { onConflict: "user_id" });
    // Streak-based badges
    if (current >= 7) await awardBadge(db, learnerId, "streak_7");
    if (current >= 30) await awardBadge(db, learnerId, "month_master");
    return null;
  }, null);
});

async function awardBadge(db: SupabaseClient, userId: string, ruleKey: string) {
  const { data: badge } = await db.from("badges").select("id").eq("rule_key", ruleKey).maybeSingle();
  if (!badge) return;
  const { data: existing } = await db.from("user_badges").select("user_id").eq("user_id", userId).eq("badge_id", badge.id).maybeSingle();
  if (existing) return;
  await db.from("user_badges").insert({ user_id: userId, badge_id: badge.id });
  await publish(Topics.ACHIEVEMENT_BADGE_EARNED, { userId, badgeRuleKey: ruleKey });
}

// ─── Certificate on enrollment.completed ─────────────────────────
consume<{ learnerId: string; courseId: string }>(Topics.ENROLLMENT_COMPLETED, async ({ learnerId, courseId }) => {
  await withDb(async (db) => {
    const eligibility = await evaluateCertificateEligibility(db, learnerId, courseId);
    if (!eligibility.ok) return null;
    const issued = await issueCertificate(db, learnerId, courseId);
    if (!issued.alreadyIssued) {
      await publish(Topics.ACHIEVEMENT_CERTIFICATE_ISSUED, { learnerId, courseId, certificateId: issued.certificate.id });
      await awardBadge(db, learnerId, "first_course");
    }
    return null;
  }, null);
  log.info("certificate flow triggered", { learnerId, courseId });
});

// ─── Reads ────────────────────────────────────────────────────────
// Per-user achievement data (badges, streak, activity heatmap) is private to the
// user — only the user themself or an admin may read it. Without this gate these
// were unauthenticated, so anyone could enumerate any user's activity by id.
function ownUserOnly(req: import("express").Request, res: import("express").Response): boolean {
  if (req.params.userId !== req.user!.id && req.user!.role !== "admin") {
    fail(res, 403, "You can only view your own achievements", "FORBIDDEN");
    return false;
  }
  return true;
}

app.get("/:userId/badges", requireAuth, async (req, res) => {
  if (!ownUserOnly(req, res)) return;
  const data = await withDb(async (db) => {
    const { data: all } = await db.from("badges").select("*").order("position");
    const { data: earned } = await db.from("user_badges").select("badge_id, earned_at").eq("user_id", req.params.userId);
    const earnedMap = new Map(earned?.map((e) => [e.badge_id, e.earned_at]) || []);
    return {
      earned: (all || []).filter((b) => earnedMap.has(b.id)).map((b) => ({ ...b, earned_at: earnedMap.get(b.id) })),
      locked: (all || []).filter((b) => !earnedMap.has(b.id)),
    };
  }, () => ({
    earned: mock.badges.filter((b) => b.earnedAt),
    locked: mock.badges.filter((b) => !b.earnedAt),
  }));
  ok(res, data);
});

app.get("/:userId/streak", requireAuth, async (req, res) => {
  if (!ownUserOnly(req, res)) return;
  const row = await withDb(async (db) => {
    const { data } = await db.from("user_streaks").select("*").eq("user_id", req.params.userId).maybeSingle();
    return data;
  }, () => ({ current_streak: 7, longest_streak: 21, last_activity_date: new Date().toISOString().slice(0, 10) }));
  ok(res, row || { current_streak: 0, longest_streak: 0 });
});

app.get("/:userId/heatmap", requireAuth, async (req, res) => {
  if (!ownUserOnly(req, res)) return;
  const data = await withDb(async (db) => {
    const start = new Date(); start.setDate(start.getDate() - 365);
    const { data } = await db.from("node_progress").select("completed_at").eq("learner_id", req.params.userId).gte("completed_at", start.toISOString()).eq("is_completed", true);
    const map: Record<string, number> = {};
    for (const r of data || []) {
      const day = r.completed_at?.slice(0, 10);
      if (day) map[day] = (map[day] || 0) + 1;
    }
    return map;
  }, () => mock.heatmap);
  ok(res, data);
});

// Aggregated learner-dashboard payload: streak + badge counts + 1-year heatmap in
// ONE round trip. The home page previously fired three separate calls (streak,
// badges, heatmap) to this service; this collapses them into a single request
// with the queries fanned out via Promise.all.
app.get("/:userId/summary", requireAuth, async (req, res) => {
  if (!ownUserOnly(req, res)) return;
  const data = await withDb(async (db) => {
    const start = new Date(); start.setDate(start.getDate() - 365);
    const [streakRes, totalBadgesRes, earnedBadgesRes, progressRes] = await Promise.all([
      db.from("user_streaks").select("current_streak, longest_streak").eq("user_id", req.params.userId).maybeSingle(),
      db.from("badges").select("id", { count: "exact", head: true }),
      db.from("user_badges").select("badge_id", { count: "exact", head: true }).eq("user_id", req.params.userId),
      db.from("node_progress").select("completed_at").eq("learner_id", req.params.userId).eq("is_completed", true).gte("completed_at", start.toISOString()),
    ]);
    const total = totalBadgesRes.count || 0;
    const earned = earnedBadgesRes.count || 0;
    const heatmap: Record<string, number> = {};
    for (const r of progressRes.data || []) {
      const day = r.completed_at?.slice(0, 10);
      if (day) heatmap[day] = (heatmap[day] || 0) + 1;
    }
    return {
      streak: { current_streak: streakRes.data?.current_streak || 0, longest_streak: streakRes.data?.longest_streak || 0 },
      badges: { earned, locked: Math.max(0, total - earned) },
      heatmap,
    };
  }, () => ({
    streak: { current_streak: 7, longest_streak: 21 },
    badges: { earned: mock.badges.filter((b) => b.earnedAt).length, locked: mock.badges.filter((b) => !b.earnedAt).length },
    heatmap: mock.heatmap,
  }));
  ok(res, data);
});

// ─── Certificates ─────────────────────────────────────────────────

interface CertificateDetail {
  id: string; learner_id: string; course_id: string; pdf_url: string | null;
  verification_token: string; issued_at: string;
  courseTitle: string; creatorName: string; learnerName: string;
  template: CertificateTemplate;
}

async function loadCertificateDetail(db: SupabaseClient, certId: string): Promise<CertificateDetail | null> {
  const { data: cert } = await db.from("certificates")
    .select("*, courses(title, creator_id, certificate_template), profiles!certificates_learner_id_fkey(display_name)")
    .eq("id", certId).maybeSingle();
  if (!cert) return null;
  type Row = { id: string; learner_id: string; course_id: string; pdf_url: string | null; verification_token: string; issued_at: string; courses?: { title?: string; creator_id?: string; certificate_template?: CertificateTemplate | null } | null; profiles?: { display_name?: string } | null };
  const r = cert as Row;
  let creatorName = "LearnRift Creator";
  if (r.courses?.creator_id) {
    const { data: creator } = await db.from("profiles").select("display_name").eq("user_id", r.courses.creator_id).maybeSingle();
    creatorName = creator?.display_name || creatorName;
  }
  return {
    id: r.id, learner_id: r.learner_id, course_id: r.course_id, pdf_url: r.pdf_url,
    verification_token: r.verification_token, issued_at: r.issued_at,
    courseTitle: r.courses?.title || "Course", creatorName, learnerName: r.profiles?.display_name || "Learner",
    template: r.courses?.certificate_template || {},
  };
}

async function renderCertificatePdf(detail: CertificateDetail): Promise<Uint8Array> {
  const siteName = await getPlatformSetting("site_name", "LearnRift");
  return buildCertificatePdf({
    siteName: String(siteName),
    learnerName: detail.learnerName,
    courseTitle: detail.courseTitle,
    creatorName: detail.creatorName,
    completedAt: detail.issued_at,
    certificateId: detail.id,
    verifyUrl: `${APP_URL}/verify/${detail.verification_token}`,
    heading: detail.template.heading,
    body: detail.template.body,
    accentColor: detail.template.accentColor,
    footerNote: detail.template.footerNote,
  });
}

/** Generate the PDF and store it in the private `certificates` bucket (best-effort — downloads also render on the fly). */
async function storeCertificatePdf(db: SupabaseClient, detail: CertificateDetail): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const bytes = await renderCertificatePdf(detail);
    const path = `${detail.id}.pdf`;
    const { error } = await db.storage.from("certificates").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    await db.from("certificates").update({ pdf_url: path }).eq("id", detail.id);
    return path;
  } catch (e) {
    log.warn("certificate pdf upload failed — falling back to on-the-fly rendering", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// Claim a certificate after completing a course. Idempotent: the unique
// (learner_id, course_id) constraint means repeated claims return the same row.
const ClaimSchema = z.object({ courseId: z.string().min(1) });
app.post("/certificates/claim", requireAuth, async (req, res) => {
  const parsed = ClaimSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const courseId = parsed.data.courseId;
  const learnerId = req.user!.id;

  const result = await withDb<
    | { error: { status: number; message: string; code: string } }
    | { certificate: Record<string, unknown>; alreadyIssued: boolean }
  >(async (db) => {
    const eligibility = await evaluateCertificateEligibility(db, learnerId, courseId);
    if (!eligibility.ok) return { error: { status: eligibility.status, message: eligibility.message, code: eligibility.code } };
    const issued = await issueCertificate(db, learnerId, courseId);
    if (!issued.alreadyIssued) {
      await awardBadge(db, learnerId, "first_course");
      await db.from("notifications").insert({
        user_id: learnerId,
        type: "certificate_issued",
        title: "Certificate issued 🎓",
        body: `Your certificate for ${eligibility.course.title || "this course"} is ready to download.`,
        href: "/achievements",
        payload: { courseId, certificateId: issued.certificate.id },
      });
    }
    return issued;
  }, () => ({ error: { status: 503, message: "Certificates need a configured database", code: "DB_REQUIRED" } }));

  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  if (!result.alreadyIssued) {
    await publish(Topics.ACHIEVEMENT_CERTIFICATE_ISSUED, { learnerId, courseId, certificateId: result.certificate.id });
    await sendRealtimeNotification(learnerId, { type: "certificate_issued", courseId });
  }
  ok(res, result);
});

// The authenticated learner's certificates (achievements page).
app.get("/certificates/mine", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("certificates")
      .select("id, course_id, pdf_url, verification_token, issued_at, courses(title, thumbnail_url)")
      .eq("learner_id", req.user!.id)
      .order("issued_at", { ascending: false });
    return data || [];
  }, () => []);
  ok(res, list);
});

app.get("/certificates/verify/:token", async (req, res) => {
  // Public, unauthenticated verification by random token. Return ONLY the fields
  // the verify page renders — not select("*") — so this doesn't leak the
  // internal learner_id/course_id or other certificate columns.
  const data = await withDb(async (db) => {
    const { data: cert } = await db.from("certificates")
      .select("id, verification_token, issued_at, courses(title), profiles!certificates_learner_id_fkey(display_name, username)")
      .eq("verification_token", req.params.token).maybeSingle();
    if (!cert) return null;
    return cert;
  }, null);
  if (!data) return fail(res, 404, "Certificate not found", "NOT_FOUND");
  ok(res, data);
});

// Download the certificate PDF. Ownership-gated; rendered on the fly so the
// local/dev fallback (no Supabase Storage) returns the exact same document.
app.get("/certificates/:id/download", requireAuth, async (req, res) => {
  const detail = await withDb(async (db) => loadCertificateDetail(db, String(req.params.id)), null);
  if (!detail) return fail(res, 404, "Certificate not found", "NOT_FOUND");
  if (detail.learner_id !== req.user!.id && req.user!.role !== "admin") {
    return fail(res, 403, "You can only download your own certificates", "FORBIDDEN");
  }
  try {
    const bytes = await renderCertificatePdf(detail);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="learnrift-certificate-${detail.id}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) {
    log.error("certificate pdf render failed", { err: e instanceof Error ? e.message : String(e) });
    fail(res, 500, "Could not render the certificate PDF", "PDF_FAILED");
  }
});

listen(PORT);
