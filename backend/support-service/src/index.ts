import { createService, ok, fail, paginate, mock, requireAuth, requireRole, withDb, publish, Topics, getPlatformSetting, sendRealtimeNotification, writeAuditLog } from "@cs-ranger/shared";
import { z } from "zod";
import { RefundDecision } from "./validation.js";

const { app, listen } = createService("support-service");
const PORT = Number(process.env.PORT_SUPPORT || 4010);

const Create = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(5),
  category: z.string().optional(),
  // Refund-request tickets carry the payment they're about so the admin can
  // approve/reject the refund from inside the ticket.
  relatedPaymentId: z.string().uuid().optional(),
});

app.post("/", requireAuth, async (req, res) => {
  const parsed = Create.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
  const result = await withDb(async (db) => {
    // A learner can only link payments that belong to them.
    if (parsed.data.relatedPaymentId) {
      const { data: payment } = await db.from("payments").select("id, learner_id").eq("id", parsed.data.relatedPaymentId).maybeSingle();
      if (!payment || (payment.learner_id !== req.user!.id && req.user!.role !== "admin")) {
        return { error: { status: 400, message: "That payment doesn't belong to your account", code: "VALIDATION" } } as const;
      }
    }
    const { data: ticket, error } = await db.from("support_tickets").insert({
      user_id: req.user!.id,
      subject: parsed.data.subject,
      related_payment_id: parsed.data.relatedPaymentId || null,
    }).select("*").single();
    if (error) throw error;
    await db.from("ticket_messages").insert({ ticket_id: ticket.id, author_id: req.user!.id, body: parsed.data.body });
    return ticket;
  }, () => ({ id: `tkt-${Date.now()}`, user_id: req.user!.id, subject: parsed.data.subject, status: "open" }));
  if (result && typeof result === "object" && "error" in result) {
    const e = (result as { error: { status: number; message: string; code: string } }).error;
    return fail(res, e.status, e.message, e.code);
  }
  await publish(Topics.SUPPORT_TICKET_UPDATED, { ticketId: (result as { id: string }).id, userId: req.user!.id });
  res.status(201);
  ok(res, result);
});

app.get("/", requireAuth, async (req, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  type ListResult = { items: unknown[]; total: number } | { items: unknown[]; meta: { page: number; pageSize: number; total: number } };
  const result = await withDb<ListResult>(async (db) => {
    let q = db.from("support_tickets").select("*", { count: "exact" });
    if (req.user!.role !== "admin") q = q.eq("user_id", req.user!.id);
    if (req.query.status) q = q.eq("status", req.query.status as string);
    q = q.order("updated_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count } = await q;
    return { items: data || [], total: count || 0 };
  }, () => paginate(mock.supportTickets, page, pageSize));
  ok(res, result.items, { page, pageSize, total: "total" in result ? result.total : 0 });
});

app.get("/:id", requireAuth, async (req, res) => {
  const data = await withDb(async (db) => {
    const { data: ticket } = await db.from("support_tickets").select("*").eq("id", req.params.id).maybeSingle();
    if (!ticket) return null;
    if (req.user!.role !== "admin" && ticket.user_id !== req.user!.id) return { forbidden: true } as const;
    const { data: messages } = await db.from("ticket_messages").select("*").eq("ticket_id", ticket.id).order("created_at");
    const filtered = req.user!.role === "admin" ? messages : messages?.filter((m) => !m.is_internal_note);

    // Refund-linked tickets carry the payment context the admin needs to decide.
    let refundContext: Record<string, unknown> | null = null;
    if (ticket.related_payment_id) {
      const { data: payment } = await db.from("payments")
        .select("id, amount, status, created_at, course_id, learner_id, courses(title)")
        .eq("id", ticket.related_payment_id).maybeSingle();
      if (payment) {
        const windowDays = await getPlatformSetting("refund_window_days", 7);
        const ageDays = (Date.now() - new Date(payment.created_at).getTime()) / 86_400_000;
        const courseRel = (payment as { courses?: { title?: string } | { title?: string }[] | null }).courses;
        const course = Array.isArray(courseRel) ? courseRel[0] : courseRel;
        refundContext = {
          payment_id: payment.id,
          amount: payment.amount,
          status: payment.status,
          paid_at: payment.created_at,
          course_id: payment.course_id,
          course_title: course?.title || "Course",
          learner_id: payment.learner_id,
          refund_window_days: Number(windowDays),
          within_window: ageDays <= Number(windowDays),
        };
      }
    }
    return { ...ticket, messages: filtered || [], refund_context: refundContext };
  }, null);
  if (!data) return fail(res, 404, "Ticket not found", "NOT_FOUND");
  if ("forbidden" in data) return fail(res, 403, "Forbidden", "FORBIDDEN");
  ok(res, data);
});

// Record an admin's refund decision on a refund-linked ticket. The actual money
// movement goes through payment-service POST /payments/:id/refund (idempotent —
// already-refunded payments are rejected there); this endpoint records the
// outcome on the ticket, notifies the learner, and audits the decision.
// (RefundDecision schema lives in ./validation.ts so it can be unit-tested.)
app.post("/:id/refund-decision", requireRole("admin"), async (req, res) => {
  const parsed = RefundDecision.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");

  const result = await withDb<
    | { error: { status: number; message: string; code: string } }
    | { ticketUserId: string; paymentId: string }
  >(async (db) => {
    const { data: ticket } = await db.from("support_tickets").select("id, user_id, related_payment_id, status").eq("id", req.params.id).maybeSingle();
    if (!ticket) return { error: { status: 404, message: "Ticket not found", code: "NOT_FOUND" } };
    if (!ticket.related_payment_id) return { error: { status: 400, message: "This ticket isn't linked to a payment", code: "NOT_REFUND_TICKET" } };

    const decisionText = parsed.data.approved
      ? "Refund approved — the amount will be returned to the original payment method and course access has been revoked."
      : `Refund rejected: ${parsed.data.reason}`;
    await db.from("ticket_messages").insert({ ticket_id: ticket.id, author_id: req.user!.id, body: decisionText });
    await db.from("support_tickets").update({ status: "resolved", updated_at: new Date().toISOString() }).eq("id", ticket.id);
    await db.from("notifications").insert({
      user_id: ticket.user_id,
      type: parsed.data.approved ? "refund_approved" : "refund_rejected",
      title: parsed.data.approved ? "Refund approved" : "Refund request update",
      body: decisionText,
      href: "/transactions",
    });
    return { ticketUserId: ticket.user_id, paymentId: ticket.related_payment_id };
  }, () => ({ error: { status: 503, message: "Refund decisions need a configured database", code: "DB_REQUIRED" } }));

  if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
  await sendRealtimeNotification(result.ticketUserId, { type: parsed.data.approved ? "refund_approved" : "refund_rejected" });
  await writeAuditLog({
    adminId: req.user!.id,
    action: parsed.data.approved ? "refund.approved" : "refund.rejected",
    targetType: "payment",
    targetId: result.paymentId,
    metadata: { ticketId: req.params.id, reason: parsed.data.reason },
  });
  await publish(Topics.SUPPORT_TICKET_UPDATED, { ticketId: req.params.id, userId: result.ticketUserId });
  ok(res, { recorded: true, approved: parsed.data.approved });
});

app.post("/:id/messages", requireAuth, async (req, res) => {
  const body = String(req.body.body || "");
  if (!body) return fail(res, 400, "body required", "VALIDATION");
  const isInternal = !!req.body.isInternalNote && req.user!.role === "admin";
  await withDb(async (db) => {
    await db.from("ticket_messages").insert({ ticket_id: req.params.id, author_id: req.user!.id, body, is_internal_note: isInternal });
    await db.from("support_tickets").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", req.params.id);
    return null;
  }, null);
  await publish(Topics.SUPPORT_TICKET_UPDATED, { ticketId: req.params.id, userId: req.user!.id });
  ok(res, { sent: true });
});

app.put("/:id/status", requireRole("admin"), async (req, res) => {
  await withDb(async (db) => { await db.from("support_tickets").update({ status: req.body.status }).eq("id", req.params.id); return null; }, null);
  ok(res, { updated: true });
});

app.put("/:id/assign", requireRole("admin"), async (req, res) => {
  await withDb(async (db) => { await db.from("support_tickets").update({ assigned_admin_id: req.body.adminId }).eq("id", req.params.id); return null; }, null);
  ok(res, { assigned: true });
});

app.get("/canned-responses", requireRole("admin"), async (_req, res) => {
  const list = await withDb(async (db) => {
    const { data } = await db.from("canned_responses").select("*").order("title");
    return data || [];
  }, () => []);
  ok(res, list);
});

app.post("/canned-responses", requireRole("admin"), async (req, res) => {
  await withDb(async (db) => { await db.from("canned_responses").insert({ title: req.body.title, body: req.body.body, created_by: req.user!.id }); return null; }, null);
  ok(res, { saved: true });
});

listen(PORT);
