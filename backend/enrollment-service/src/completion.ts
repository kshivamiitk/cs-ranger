import type { SupabaseClient } from "@supabase/supabase-js";
import { publish, redis, sendRealtimeNotification, Topics } from "@cs-ranger/shared";

/**
 * Node completion policy + course progress recompute.
 *
 * Per-type rules (80% thresholds, or an explicit Mark-as-Done where allowed):
 *   markdown / pdf      → scrollPercent >= 80, or markDone
 *   video               → watchSeconds >= 80% of duration, or markDone
 *   static_website      → markDone only
 *   quiz                → passing score only (handled by the quiz attempt path)
 *
 * All writes are idempotent merges: progress metadata only ever ratchets up
 * (max of old/new) and a completed node never flips back to incomplete, so
 * duplicate or out-of-order events cannot corrupt state.
 */

export type CompletionRule = "manual" | "scroll_80" | "watch_80" | "quiz_pass";

export interface ProgressSignal {
  scrollPercent?: number;
  watchSeconds?: number;
  durationSeconds?: number;
  lastPositionSeconds?: number;
  markDone?: boolean;
}

export interface NodeCore {
  id: string;
  type: "video" | "markdown" | "quiz" | "pdf" | "static_website";
  duration_seconds: number | null;
  course_id: string;
}

interface ProgressRow {
  is_completed: boolean;
  completed_at: string | null;
  completed_by_rule: string | null;
  scroll_percent: number;
  watch_seconds: number;
  duration_seconds: number | null;
  watch_position_s: number;
  quiz_attempt_id: string | null;
}

export async function getNodeCore(db: SupabaseClient, nodeId: string): Promise<NodeCore | null> {
  const { data } = await db.from("nodes")
    .select("id, type, duration_seconds, modules!inner(course_id)")
    .eq("id", nodeId)
    .maybeSingle();
  if (!data) return null;
  const m = (data as { modules?: { course_id: string } | { course_id: string }[] }).modules;
  const courseId = Array.isArray(m) ? m[0]?.course_id : m?.course_id;
  if (!courseId) return null;
  const row = data as { id: string; type: NodeCore["type"]; duration_seconds: number | null };
  return { id: row.id, type: row.type, duration_seconds: row.duration_seconds, course_id: courseId };
}

/** Decide whether the merged signals satisfy this node type's completion rule. */
export function evaluateCompletion(node: NodeCore, merged: { scrollPercent: number; watchSeconds: number; durationSeconds: number | null }, markDone: boolean): { completed: boolean; rule: CompletionRule | null } {
  if (node.type === "quiz") return { completed: false, rule: null };
  if (markDone) return { completed: true, rule: "manual" };
  if (node.type === "markdown" || node.type === "pdf") {
    if (merged.scrollPercent >= 80) return { completed: true, rule: "scroll_80" };
  }
  if (node.type === "video") {
    const duration = merged.durationSeconds || node.duration_seconds || 0;
    if (duration > 0 && merged.watchSeconds >= duration * 0.8) return { completed: true, rule: "watch_80" };
  }
  return { completed: false, rule: null };
}

export interface ApplyResult {
  completed: boolean;
  newlyCompleted: boolean;
  completedByRule: string | null;
  scrollPercent: number;
  watchSeconds: number;
}

/** Idempotent merge of a progress signal into node_progress (ratchet semantics). */
export async function applyProgress(
  db: SupabaseClient,
  learnerId: string,
  node: NodeCore,
  signal: ProgressSignal,
  forced?: { completed: true; rule: CompletionRule; quizAttemptId?: string },
): Promise<ApplyResult> {
  const { data: existingRaw } = await db.from("node_progress")
    .select("is_completed, completed_at, completed_by_rule, scroll_percent, watch_seconds, duration_seconds, watch_position_s, quiz_attempt_id")
    .eq("learner_id", learnerId).eq("node_id", node.id).maybeSingle();
  const existing = (existingRaw || null) as ProgressRow | null;

  const merged = {
    scrollPercent: Math.min(100, Math.max(existing?.scroll_percent || 0, Math.round(signal.scrollPercent || 0))),
    watchSeconds: Math.max(existing?.watch_seconds || 0, Math.round(signal.watchSeconds || 0)),
    durationSeconds: signal.durationSeconds ? Math.round(signal.durationSeconds) : existing?.duration_seconds ?? null,
  };

  const verdict = forced ?? evaluateCompletion(node, merged, !!signal.markDone);
  const wasCompleted = !!existing?.is_completed;
  const completed = wasCompleted || verdict.completed;
  const newlyCompleted = completed && !wasCompleted;
  const now = new Date().toISOString();

  await db.from("node_progress").upsert({
    learner_id: learnerId,
    node_id: node.id,
    is_completed: completed,
    completed_at: existing?.completed_at || (newlyCompleted ? now : null),
    completed_by_rule: existing?.completed_by_rule || (newlyCompleted ? ("rule" in verdict ? verdict.rule : null) : null),
    scroll_percent: merged.scrollPercent,
    watch_seconds: merged.watchSeconds,
    duration_seconds: merged.durationSeconds,
    watch_position_s: signal.lastPositionSeconds != null ? Math.round(signal.lastPositionSeconds) : existing?.watch_position_s || 0,
    quiz_attempt_id: forced?.quizAttemptId || existing?.quiz_attempt_id || null,
    last_accessed_at: now,
  }, { onConflict: "learner_id,node_id" });

  return {
    completed,
    newlyCompleted,
    completedByRule: existing?.completed_by_rule || (newlyCompleted && "rule" in verdict ? verdict.rule : null),
    scrollPercent: merged.scrollPercent,
    watchSeconds: merged.watchSeconds,
  };
}

export interface CourseProgressResult {
  courseProgressPercent: number;
  courseCompleted: boolean;
  courseJustCompleted: boolean;
}

/**
 * Recompute the learner's enrollment progress from the course's CURRENT node
 * set (required nodes), not raw node_progress counts — deleted nodes or
 * progress rows from other courses can never skew the percentage. Marks the
 * enrollment completed exactly once.
 */
export async function recomputeCourseProgress(
  db: SupabaseClient,
  learnerId: string,
  courseId: string,
  lastNodeId?: string,
): Promise<CourseProgressResult | null> {
  const { data: enrollment } = await db.from("enrollments")
    .select("id, completed_at, progress_percent")
    .eq("learner_id", learnerId).eq("course_id", courseId).maybeSingle();
  if (!enrollment) return null;

  const { data: courseNodes } = await db.from("nodes")
    .select("id, modules!inner(course_id)")
    .eq("modules.course_id", courseId);
  const requiredIds = (courseNodes || []).map((n) => n.id as string);
  if (requiredIds.length === 0) {
    return { courseProgressPercent: enrollment.progress_percent || 0, courseCompleted: !!enrollment.completed_at, courseJustCompleted: false };
  }

  const { count } = await db.from("node_progress")
    .select("node_id", { count: "exact", head: true })
    .eq("learner_id", learnerId).eq("is_completed", true).in("node_id", requiredIds);
  const completedCount = Math.min(count || 0, requiredIds.length);
  const percent = Math.max(0, Math.min(100, Math.round((completedCount / requiredIds.length) * 100)));

  const now = new Date().toISOString();
  const justCompleted = percent === 100 && !enrollment.completed_at;
  await db.from("enrollments").update({
    progress_percent: percent,
    last_node_id: lastNodeId || undefined,
    last_accessed_at: now,
    ...(justCompleted ? { completed_at: now } : {}),
  }).eq("id", enrollment.id);

  return { courseProgressPercent: percent, courseCompleted: percent === 100 || !!enrollment.completed_at, courseJustCompleted: justCompleted };
}

/** Course-completed side effects: event for consumers + Redis-less synchronous notification. */
export async function onCourseCompleted(db: SupabaseClient, learnerId: string, courseId: string): Promise<void> {
  await publish(Topics.ENROLLMENT_COMPLETED, { learnerId, courseId });
  // Without Redis the notification consumer never runs — write the in-app
  // notification synchronously (same precedent as course-service doubt notifs).
  if (!redis()) {
    const { data: course } = await db.from("courses").select("title").eq("id", courseId).maybeSingle();
    await db.from("notifications").insert({
      user_id: learnerId,
      type: "course_completed",
      title: "Course completed! 🎉",
      body: `You finished ${course?.title || "a course"}. Your certificate is ready to claim.`,
      href: "/achievements",
      payload: { courseId },
    });
  }
  await sendRealtimeNotification(learnerId, { type: "course_completed", courseId });
}
