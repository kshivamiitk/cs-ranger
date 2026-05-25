import { createService, ok, fail, requireAuth, withDb, isSupabaseConfigured, consume, Topics, publish } from "@cs-ranger/shared";
import { z } from "zod";
import { applyProgress, getNodeCore, onCourseCompleted, recomputeCourseProgress, type CourseProgressResult } from "./completion.js";

const { app, listen, log } = createService("enrollment-service");
const PORT = Number(process.env.PORT_ENROLLMENT || 4004);

// ─── Listen for payment.verified → create enrollment ─────────────
consume<{ paymentId: string; courseId: string; learnerId: string; amount: number }>(Topics.PAYMENT_VERIFIED, async ({ courseId, learnerId }) => {
  await withDb(async (db) => {
    // Idempotent: unique(learner_id, course_id) prevents duplicates
    const { data } = await db.from("enrollments").insert({
      learner_id: learnerId, course_id: courseId, progress_percent: 0,
    }).select("id").maybeSingle();
    if (data) {
      await publish(Topics.ENROLLMENT_CREATED, { enrollmentId: data.id, learnerId, courseId });
    }
    return null;
  }, null);
  log.info("enrollment created from payment.verified", { courseId, learnerId });
});

// ─── Listen for payment.refunded → revoke enrollment ──────────────
consume<{ courseId: string; learnerId: string }>(Topics.PAYMENT_REFUNDED, async ({ courseId, learnerId }) => {
  await withDb(async (db) => {
    await db.from("enrollments").delete().eq("learner_id", learnerId).eq("course_id", courseId);
    return null;
  }, null);
});

// ─── REST endpoints ──────────────────────────────────────────────
app.get("/check", requireAuth, async (req, res) => {
  const courseId = String(req.query.courseId || "");
  const found = await withDb(async (db) => {
    const { data } = await db.from("enrollments").select("id, progress_percent, last_node_id").eq("learner_id", req.user!.id).eq("course_id", courseId).maybeSingle();
    return data;
  }, null);
  ok(res, { enrolled: !!found, ...found });
});

app.get("/", requireAuth, async (req, res) => {
  // Lean select — the My Courses / Home cards only display these fields, and
  // the page was returning [] before because PostgREST can't auto-resolve the
  // courses→profiles relationship (courses.creator_id FKs users, not profiles).
  // Uses idx_enrollments_learner_last (learner_id, last_accessed_at desc).
  const list = await withDb(async (db) => {
    const { data } = await db.from("enrollments")
      .select("id, course_id, progress_percent, last_node_id, last_accessed_at, completed_at, enrolled_at, courses(id, title, thumbnail_url, duration_seconds)")
      .eq("learner_id", req.user!.id)
      .order("last_accessed_at", { ascending: false });
    return data || [];
  }, () => []);
  ok(res, list);
});

// Free-course enrollment
const FreeEnroll = z.object({ courseId: z.string() });
app.post("/", requireAuth, async (req, res) => {
  const parsed = FreeEnroll.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  const course = await withDb(async (db) => {
    const { data } = await db.from("courses").select("id, price, status").eq("id", parsed.data.courseId).maybeSingle();
    return data;
  }, null);
  if (!course) return fail(res, 404, "Course not found", "NOT_FOUND");
  if (course.status !== "published") return fail(res, 400, "Course not available", "UNAVAILABLE");
  if (course.price && course.price > 0) return fail(res, 400, "Course is paid — use payment flow", "PAID_COURSE");

  const result = await withDb(async (db) => {
    const { data, error } = await db.from("enrollments").insert({
      learner_id: req.user!.id, course_id: course.id, progress_percent: 0,
    }).select("*").single();
    if (error) throw error;
    return data;
  }, null);
  if (!result) return fail(res, 409, "Already enrolled", "ALREADY_ENROLLED");

  await publish(Topics.ENROLLMENT_CREATED, { enrollmentId: result.id, learnerId: req.user!.id, courseId: course.id });
  res.status(201);
  ok(res, result);
});

// ─── Completion engine ────────────────────────────────────────────
// Unified, idempotent progress update. The player streams scroll/watch signals
// here; the per-node-type policy (completion.ts) decides when a node flips to
// completed, and course progress is recomputed from the course's actual node set.
const ProgressUpdate = z.object({
  scrollPercent: z.number().min(0, "scrollPercent cannot be negative").max(100, "scrollPercent cannot exceed 100").optional(),
  watchSeconds: z.number().min(0, "watchSeconds cannot be negative").max(86_400).optional(),
  durationSeconds: z.number().min(0).max(86_400).optional(),
  lastPositionSeconds: z.number().min(0).max(86_400).optional(),
  markDone: z.boolean().optional(),
}).strict();

type ProgressResponse = {
  completed: boolean; newlyCompleted: boolean; completedByRule: string | null;
  scrollPercent: number; watchSeconds: number;
} & Partial<CourseProgressResult> & { quizRequired?: boolean };

async function handleProgressUpdate(learnerId: string, nodeId: string, signal: z.infer<typeof ProgressUpdate>): Promise<ProgressResponse | { error: { status: number; message: string; code: string } }> {
  return withDb<ProgressResponse | { error: { status: number; message: string; code: string } }>(async (db) => {
    const node = await getNodeCore(db, nodeId);
    if (!node) return { error: { status: 404, message: "Lesson not found", code: "NOT_FOUND" } };
    if (node.type === "quiz" && signal.markDone) {
      return { error: { status: 400, message: "Quizzes are completed by reaching the passing score, not by marking done", code: "QUIZ_PASS_REQUIRED" } };
    }

    const result = await applyProgress(db, learnerId, node, signal);
    let course: CourseProgressResult | null = null;
    if (result.newlyCompleted || signal.markDone) {
      course = await recomputeCourseProgress(db, learnerId, node.course_id, nodeId);
      if (course?.courseJustCompleted) await onCourseCompleted(db, learnerId, node.course_id);
    } else {
      // Light "continue learning" touch — keeps last_node_id fresh without a full recompute.
      await db.from("enrollments").update({ last_node_id: nodeId, last_accessed_at: new Date().toISOString() })
        .eq("learner_id", learnerId).eq("course_id", node.course_id);
    }
    return { ...result, ...(course || {}), quizRequired: node.type === "quiz" || undefined };
  }, () => ({
    completed: !!signal.markDone, newlyCompleted: !!signal.markDone, completedByRule: signal.markDone ? "manual" : null,
    scrollPercent: Math.round(signal.scrollPercent || 0), watchSeconds: Math.round(signal.watchSeconds || 0),
    courseProgressPercent: 0, courseCompleted: false, courseJustCompleted: false,
  }));
}

app.post("/progress/:nodeId", requireAuth, async (req, res) => {
  const parsed = ProgressUpdate.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const result = await handleProgressUpdate(req.user!.id, String(req.params.nodeId), parsed.data);
  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  if (result.newlyCompleted) await publish(Topics.NODE_COMPLETED, { learnerId: req.user!.id, nodeId: req.params.nodeId });
  ok(res, result);
});

// Mark a node complete (legacy explicit Mark-as-Done — same policy path; quizzes are rejected).
app.post("/progress/:nodeId/complete", requireAuth, async (req, res) => {
  const result = await handleProgressUpdate(req.user!.id, String(req.params.nodeId), { markDone: true });
  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  if (result.newlyCompleted) await publish(Topics.NODE_COMPLETED, { learnerId: req.user!.id, nodeId: req.params.nodeId });
  ok(res, result);
});

// Save watch position (video, every 10s)
app.put("/progress/:nodeId/watch-position", requireAuth, async (req, res) => {
  const seconds = Math.max(0, Math.floor(Number(req.body.seconds || 0)));
  await withDb(async (db) => {
    await db.from("node_progress").upsert({
      learner_id: req.user!.id, node_id: req.params.nodeId,
      watch_position_s: seconds, last_accessed_at: new Date().toISOString(),
    }, { onConflict: "learner_id,node_id" });
    return null;
  }, null);
  ok(res, { saved: true });
});

app.get("/progress/:nodeId/watch-position", requireAuth, async (req, res) => {
  const row = await withDb(async (db) => {
    const { data } = await db.from("node_progress").select("watch_position_s, is_completed").eq("learner_id", req.user!.id).eq("node_id", req.params.nodeId).maybeSingle();
    return data;
  }, null);
  ok(res, { seconds: row?.watch_position_s || 0, completed: !!row?.is_completed });
});

// Per-course progress (used by the player sidebar)
app.get("/:courseId/progress", requireAuth, async (req, res) => {
  const result = await withDb(async (db) => {
    const [{ data: enrollment }, { data: completed }] = await Promise.all([
      db.from("enrollments").select("progress_percent, completed_at, last_node_id").eq("learner_id", req.user!.id).eq("course_id", req.params.courseId).maybeSingle(),
      db.from("node_progress").select("node_id").eq("learner_id", req.user!.id).eq("is_completed", true),
    ]);
    return { enrollment, completedNodeIds: completed?.map((c) => c.node_id) || [] };
  }, () => ({ enrollment: null, completedNodeIds: [] }));
  ok(res, result);
});

// Quiz attempt submission — completion only happens on a passing score.
const QuizSubmit = z.object({
  answers: z.array(z.object({ questionId: z.string(), pickedIndex: z.number().int().min(0).max(3) })),
});
type QuizAttemptResult = {
  score: number; max: number; passed: boolean; attemptId?: string;
} & Partial<CourseProgressResult>;
app.post("/quiz/:nodeId/attempt", requireAuth, async (req, res) => {
  const parsed = QuizSubmit.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  const result = await withDb<QuizAttemptResult | null>(async (db) => {
    const { data: node } = await db.from("nodes").select("quiz_payload, module_id").eq("id", req.params.nodeId).maybeSingle();
    if (!node?.quiz_payload) return null;
    type QP = { questions: { id: string; correctIndex: number }[]; passingPercent?: number };
    const qp = node.quiz_payload as QP;
    let score = 0;
    for (const a of parsed.data.answers) {
      const q = qp.questions.find((x) => x.id === a.questionId);
      if (q && q.correctIndex === a.pickedIndex) score++;
    }
    const max = qp.questions.length;
    const passing = qp.passingPercent || 60;
    const passed = max > 0 && (score / max) * 100 >= passing;

    const { data: attempt } = await db.from("quiz_attempts").insert({
      learner_id: req.user!.id, node_id: req.params.nodeId,
      answers: parsed.data.answers, score, max_score: max, passed,
    }).select("id").single();

    let course: CourseProgressResult | null = null;
    if (passed) {
      const core = await getNodeCore(db, String(req.params.nodeId));
      if (core) {
        const applied = await applyProgress(db, req.user!.id, core, {}, { completed: true, rule: "quiz_pass", quizAttemptId: attempt?.id });
        if (applied.newlyCompleted) {
          course = await recomputeCourseProgress(db, req.user!.id, core.course_id, core.id);
          if (course?.courseJustCompleted) await onCourseCompleted(db, req.user!.id, core.course_id);
        }
      }
    }
    return { score, max, passed, attemptId: attempt?.id, ...(course || {}) };
  }, () => ({ score: 0, max: 0, passed: false }));

  if (!result) return fail(res, 404, "Quiz node not found", "NOT_FOUND");
  if (result.passed) await publish(Topics.NODE_COMPLETED, { learnerId: req.user!.id, nodeId: req.params.nodeId });
  ok(res, result);
});

// Past attempts for review mode — read-only history, never editable.
app.get("/quiz/:nodeId/attempts", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("quiz_attempts")
      .select("id, score, max_score, passed, answers, attempted_at")
      .eq("learner_id", req.user!.id).eq("node_id", req.params.nodeId)
      .order("attempted_at", { ascending: false })
      .limit(20);
    return data || [];
  }, () => []);
  ok(res, list);
});

// Learner notes (timestamped against video)
app.get("/notes/:nodeId", requireAuth, async (req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("learner_notes").select("*").eq("learner_id", req.user!.id).eq("node_id", req.params.nodeId).order("timestamp_s");
    return data || [];
  }, () => []);
  ok(res, list);
});

app.post("/notes/:nodeId", requireAuth, async (req, res) => {
  const body = String(req.body.body || ""); const timestamp = req.body.timestamp_s;
  if (!body) return fail(res, 400, "body required", "VALIDATION");
  await withDb(async (db) => {
    await db.from("learner_notes").insert({ learner_id: req.user!.id, node_id: req.params.nodeId, body, timestamp_s: timestamp });
    return null;
  }, null);
  ok(res, { saved: true });
});

listen(PORT);
