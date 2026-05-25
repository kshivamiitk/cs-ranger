import type { Express } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ok, fail, requireAuth, requireRole, withDb, writeAuditLog, sendRealtimeNotification } from "@cs-ranger/shared";

/**
 * Content moderation (gateway path: /api/courses/...):
 *   POST /reports                       — learner/creator reports a course, lesson or comment
 *   GET  /admin/reports                 — flagged-content queue (filters + pagination)
 *   POST /admin/reports/:id/dismiss     — close a report without action
 *   POST /admin/reports/:id/reviewed    — mark handled (action taken elsewhere)
 *   POST /admin/reports/:id/suspend-course — pull the course from the catalog + notify creator
 *
 * "Suspend" maps to courses.status = 'archived' (the catalog and new
 * enrollments only consider 'published'); existing learners keep access.
 */

const ReportCreate = z.object({
  courseId: z.string().uuid().optional(),
  nodeId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  reason: z.string().min(10, "Tell us a little more (at least 10 characters)").max(500),
}).refine((d) => [d.courseId, d.nodeId, d.commentId].filter(Boolean).length === 1, {
  message: "Report exactly one item (course, lesson or comment)",
});

const REPORTS_PER_HOUR = 10;

interface ModerationHelpers {
  nodeCourseId: (db: SupabaseClient, nodeId: string) => Promise<string | null>;
  refreshCatalogSnapshot: (db: SupabaseClient) => Promise<void>;
}

interface ReportRow {
  id: string; reporter_id: string; reason: string; status: string; created_at: string;
  reviewed_at: string | null; reviewed_by: string | null;
  target_course: string | null; target_node: string | null; target_comment: string | null; target_user: string | null;
  reporter?: { profiles?: { display_name?: string; username?: string } | null } | null;
  courses?: { id: string; title: string; status: string; creator_id: string } | null;
  nodes?: { id: string; title: string } | null;
  comments?: { id: string; body: string; node_id: string } | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function registerModerationRoutes(app: Express, helpers: ModerationHelpers) {
  const { nodeCourseId, refreshCatalogSnapshot } = helpers;

  // ── Report content ──
  app.post("/reports", requireAuth, async (req, res) => {
    const parsed = ReportCreate.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

    const result = await withDb<{ reported: true } | { error: { status: number; message: string; code: string } }>(async (db) => {
      // Light spam guard on top of the gateway rate limit.
      const { count } = await db.from("user_reports")
        .select("id", { count: "exact", head: true })
        .eq("reporter_id", req.user!.id)
        .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
      if ((count || 0) >= REPORTS_PER_HOUR) {
        return { error: { status: 429, message: "You've filed several reports recently — please try again later", code: "RATE_LIMIT" } };
      }
      const { error } = await db.from("user_reports").insert({
        reporter_id: req.user!.id,
        target_course: parsed.data.courseId || null,
        target_node: parsed.data.nodeId || null,
        target_comment: parsed.data.commentId || null,
        reason: parsed.data.reason,
      });
      if (error) throw error;
      return { reported: true };
    }, { reported: true });

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
    ok(res, result);
  });

  // ── Admin queue ──
  app.get("/admin/reports", requireRole("admin"), async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    const status = ["open", "dismissed", "actioned"].includes(String(req.query.status)) ? String(req.query.status) : null;
    const type = ["course", "node", "comment"].includes(String(req.query.type)) ? String(req.query.type) : null;

    const result = await withDb(async (db) => {
      let q = db.from("user_reports")
        .select(`
          id, reporter_id, reason, status, created_at, reviewed_at, reviewed_by,
          target_course, target_node, target_comment, target_user,
          reporter:users!user_reports_reporter_id_fkey(profiles(display_name, username)),
          courses!user_reports_target_course_fkey(id, title, status, creator_id),
          nodes!user_reports_target_node_fkey(id, title),
          comments!user_reports_target_comment_fkey(id, body, node_id)
        `, { count: "exact" });
      if (status) q = q.eq("status", status);
      if (type === "course") q = q.not("target_course", "is", null);
      if (type === "node") q = q.not("target_node", "is", null);
      if (type === "comment") q = q.not("target_comment", "is", null);
      const { data, count, error } = await q
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw error;

      const items = ((data as unknown as ReportRow[] | null) || []).map((r) => {
        const course = one(r.courses);
        const node = one(r.nodes);
        const comment = one(r.comments);
        const reporter = one(r.reporter);
        return {
          id: r.id,
          reason: r.reason,
          status: r.status,
          created_at: r.created_at,
          reviewed_at: r.reviewed_at,
          reporter: reporter?.profiles || null,
          target_type: r.target_course ? "course" : r.target_node ? "node" : r.target_comment ? "comment" : "user",
          course: course ? { id: course.id, title: course.title, status: course.status } : null,
          node: node ? { id: node.id, title: node.title } : null,
          comment: comment ? { id: comment.id, body: comment.body, node_id: comment.node_id } : null,
        };
      });
      return { items, total: count || 0 };
    }, { items: [] as Record<string, unknown>[], total: 0 });

    ok(res, result.items, { page, pageSize, total: result.total });
  });

  async function setReportStatus(reportId: string, adminId: string, status: "dismissed" | "actioned"): Promise<ReportRow | null> {
    return withDb<ReportRow | null>(async (db) => {
      const { data } = await db.from("user_reports")
        .update({ status, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
        .eq("id", reportId)
        .select("*")
        .maybeSingle();
      return (data as ReportRow | null) || null;
    }, null);
  }

  app.post("/admin/reports/:id/dismiss", requireRole("admin"), async (req, res) => {
    const report = await setReportStatus(String(req.params.id), req.user!.id, "dismissed");
    if (!report) return fail(res, 404, "Report not found", "NOT_FOUND");
    await writeAuditLog({ adminId: req.user!.id, action: "report.dismissed", targetType: "report", targetId: report.id, metadata: { reason: report.reason } });
    ok(res, { dismissed: true });
  });

  app.post("/admin/reports/:id/reviewed", requireRole("admin"), async (req, res) => {
    const report = await setReportStatus(String(req.params.id), req.user!.id, "actioned");
    if (!report) return fail(res, 404, "Report not found", "NOT_FOUND");
    await writeAuditLog({ adminId: req.user!.id, action: "report.reviewed", targetType: "report", targetId: report.id, metadata: { reason: report.reason } });
    ok(res, { reviewed: true });
  });

  // Suspend the course a report points at (directly, or via its lesson/comment).
  app.post("/admin/reports/:id/suspend-course", requireRole("admin"), async (req, res) => {
    const reportId = String(req.params.id);
    const result = await withDb<
      | { error: { status: number; message: string; code: string } }
      | { courseId: string; courseTitle: string; creatorId: string }
    >(async (db) => {
      const { data: report } = await db.from("user_reports").select("*").eq("id", reportId).maybeSingle();
      if (!report) return { error: { status: 404, message: "Report not found", code: "NOT_FOUND" } };
      const r = report as ReportRow;

      let courseId = r.target_course;
      if (!courseId && r.target_node) courseId = await nodeCourseId(db, r.target_node);
      if (!courseId && r.target_comment) {
        const { data: comment } = await db.from("comments").select("node_id").eq("id", r.target_comment).maybeSingle();
        if (comment?.node_id) courseId = await nodeCourseId(db, comment.node_id);
      }
      if (!courseId) return { error: { status: 400, message: "This report isn't linked to a course", code: "NO_COURSE" } };

      const { data: course } = await db.from("courses").select("id, title, creator_id, status").eq("id", courseId).maybeSingle();
      if (!course) return { error: { status: 404, message: "Course not found", code: "NOT_FOUND" } };

      await db.from("courses").update({ status: "archived" }).eq("id", courseId);
      await refreshCatalogSnapshot(db);
      await db.from("user_reports").update({ status: "actioned", reviewed_by: req.user!.id, reviewed_at: new Date().toISOString() }).eq("id", reportId);
      await db.from("notifications").insert({
        user_id: course.creator_id,
        type: "course_suspended",
        title: "Your course was unpublished pending review",
        body: `"${course.title}" was removed from the catalog after a content report. Reply to support if you believe this is a mistake.`,
        href: `/creator/courses/${courseId}/edit`,
      });
      return { courseId, courseTitle: course.title as string, creatorId: course.creator_id as string };
    }, () => ({ error: { status: 503, message: "Moderation actions need a configured database", code: "DB_REQUIRED" } }));

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
    await sendRealtimeNotification(result.creatorId, { type: "course_suspended", courseId: result.courseId });
    await writeAuditLog({
      adminId: req.user!.id, action: "course.suspend", targetType: "course", targetId: result.courseId,
      metadata: { reportId, title: result.courseTitle, via: "flagged_content" },
    });
    ok(res, { suspended: true, courseId: result.courseId });
  });
}
