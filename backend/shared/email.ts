import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRealtimeNotification } from "./realtime.js";

let _resend: Resend | null = null;
function client(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

export interface SendOpts {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendOpts): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const c = client();
  if (!c) {
    // Dev fallback: log to console so flows remain testable.
    console.log(JSON.stringify({ level: "info", msg: "[email:dev]", ...opts }));
    return { ok: true, reason: "DEV_NO_RESEND" };
  }
  const from = process.env.EMAIL_FROM || "LearnRift <no-reply@learnrift.site>";
  const res = await c.emails.send({
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo || process.env.EMAIL_REPLY_TO,
  });
  if (res.error) return { ok: false, reason: res.error.message };
  return { ok: true, id: res.data?.id };
}

export interface BulkSendOpts {
  /** One recipient per email — each address gets its OWN message (never CC'd together). */
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface BulkSendResult {
  /** Unique addresses we attempted to deliver to. */
  total: number;
  sent: number;
  failed: number;
  /** First provider/transport error seen, if any — so a failed broadcast is diagnosable. */
  error?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(name?: string | null): string {
  return name?.trim().split(/\s+/)[0] || "there";
}

function textToHtmlParagraphs(text: string): string {
  const paragraphs = text.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("");
}

function defaultCourseIntroMessage(courseTitle: string): string {
  return `Your enrollment in ${courseTitle} is confirmed. Start with the first lesson whenever you're ready.`;
}

export interface CourseIntroEmailContent {
  learnerName?: string | null;
  courseTitle: string;
  courseId: string;
  welcomeMessage?: string | null;
}

export function renderCourseIntroEmail({ learnerName, courseTitle, courseId, welcomeMessage }: CourseIntroEmailContent): { subject: string; html: string; text: string } {
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const courseUrl = `${appUrl}/course/${courseId}`;
  const message = welcomeMessage?.trim() || defaultCourseIntroMessage(courseTitle);
  const subject = `Welcome to ${courseTitle}`;
  const greeting = `You're enrolled, ${firstName(learnerName)}!`;
  const text = `${greeting}\n\n${message}\n\nStart learning: ${courseUrl}`;

  const html = emailLayout(
    `<h1 style="margin:0 0 16px;font-size:22px;">${escapeHtml(greeting)}</h1>
     <div style="font-size:15px;line-height:1.7;color:#e2e8f0;">${textToHtmlParagraphs(message)}</div>
     <p style="margin:24px 0 0;"><a href="${courseUrl}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:linear-gradient(135deg,#a78bfa,#22d3ee);color:white;text-decoration:none;font-weight:600;">Start learning</a></p>`,
    { preheader: `Welcome to ${courseTitle}` },
  );

  return { subject, html, text };
}

export interface SendCourseIntroOpts {
  learnerId: string;
  courseId: string;
  enrollmentId?: string | null;
}

export interface SendCourseIntroResult {
  notificationCreated: boolean;
  emailSent: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * Create the enrollment notification and send the course intro email exactly
 * once per learner/course. A partial unique index on enrollment notifications
 * makes this safe when the direct enrollment path and async queue both run.
 */
export async function sendCourseIntroEmail(db: SupabaseClient, opts: SendCourseIntroOpts): Promise<SendCourseIntroResult> {
  const { data: course } = await db.from("courses")
    .select("title, welcome_message")
    .eq("id", opts.courseId)
    .maybeSingle();
  if (!course) return { notificationCreated: false, emailSent: false, skipped: true, reason: "course_not_found" };

  const href = `/course/${opts.courseId}/learn/start`;
  const { data: notif, error: notifError } = await db.from("notifications")
    .insert({
      user_id: opts.learnerId,
      type: "enrollment",
      title: "Enrollment confirmed",
      body: `Welcome to ${course.title}!`,
      href,
      payload: { courseId: opts.courseId, enrollmentId: opts.enrollmentId || null, introEmail: true },
    })
    .select("id")
    .single();

  if (notifError) {
    if ((notifError as { code?: string }).code === "23505") {
      return { notificationCreated: false, emailSent: false, skipped: true, reason: "already_sent" };
    }
    throw notifError;
  }

  try {
    await sendRealtimeNotification(opts.learnerId, { type: "enrollment" });
  } catch {
    // Email delivery should not be coupled to realtime bell wake-ups.
  }

  const [{ data: profile }, { data: user }] = await Promise.all([
    db.from("profiles").select("display_name").eq("user_id", opts.learnerId).maybeSingle(),
    db.from("users").select("email").eq("id", opts.learnerId).maybeSingle(),
  ]);
  const learnerEmail = (user as { email?: string } | null)?.email;
  if (!learnerEmail) {
    return { notificationCreated: true, emailSent: false, skipped: false, reason: "missing_email" };
  }

  const content = renderCourseIntroEmail({
    learnerName: (profile as { display_name?: string | null } | null)?.display_name,
    courseTitle: course.title,
    courseId: opts.courseId,
    welcomeMessage: (course as { welcome_message?: string | null }).welcome_message,
  });
  const emailResult = await sendEmail({
    to: learnerEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  return {
    notificationCreated: true,
    emailSent: emailResult.ok,
    skipped: false,
    reason: emailResult.ok ? undefined : emailResult.reason,
  };
}

/**
 * Fan a single message out to many recipients (admin broadcasts, announcements).
 *
 * Privacy: every recipient gets a SEPARATE email with only their own address in
 * `to` — we never put the whole audience in one To/CC header. Resend's batch
 * endpoint sends up to 100 individual messages per call, so we chunk the list
 * and pace the calls to stay under the provider's rate limit. Returns per-status
 * counts so callers can record/report delivery.
 *
 * Dev fallback (no RESEND_API_KEY): logs the recipient count and reports every
 * address as "sent" so broadcast flows stay testable without a provider.
 */
export async function sendBulkEmail(opts: BulkSendOpts): Promise<BulkSendResult> {
  // De-dupe + drop blanks so the count is honest and nobody is mailed twice.
  const recipients = Array.from(new Set(opts.to.map((e) => e?.trim()).filter(Boolean))) as string[];
  const total = recipients.length;
  if (total === 0) return { total: 0, sent: 0, failed: 0 };

  const c = client();
  if (!c) {
    console.log(JSON.stringify({ level: "info", msg: "[email:dev] bulk broadcast", count: total, subject: opts.subject }));
    return { total, sent: total, failed: 0 };
  }

  const from = process.env.EMAIL_FROM || "LearnRift <no-reply@learnrift.site>";
  const replyTo = opts.replyTo || process.env.EMAIL_REPLY_TO;
  const CHUNK = 100; // Resend batch limit.
  let sent = 0;
  let failed = 0;
  // Remember the first failure reason. Without this the whole broadcast can
  // report "all failed" with no clue why (bad/stale API key, unverified sender
  // domain, rate limit, blocked egress) — the error used to be silently dropped.
  let firstError: string | undefined;

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK);
    try {
      const res = await c.batch.send(
        chunk.map((to) => ({ from, to: [to], subject: opts.subject, html: opts.html, text: opts.text, replyTo })),
      );
      if (res.error) {
        failed += chunk.length;
        firstError ??= res.error.message;
        console.error(JSON.stringify({ level: "error", msg: "[email] bulk chunk rejected by Resend", reason: res.error.message, chunkSize: chunk.length }));
      } else {
        sent += chunk.length;
      }
    } catch (e) {
      // A batch call that throws (network/5xx) fails only its own chunk; keep going.
      failed += chunk.length;
      const reason = e instanceof Error ? e.message : String(e);
      firstError ??= reason;
      console.error(JSON.stringify({ level: "error", msg: "[email] bulk chunk threw", reason, chunkSize: chunk.length }));
    }
    // Gentle pacing between batches so a large broadcast doesn't trip the
    // provider's per-second rate limit. Skipped after the final chunk.
    if (i + CHUNK < recipients.length) await new Promise((r) => setTimeout(r, 250));
  }

  return { total, sent, failed, error: firstError };
}

/**
 * Wrap content in the platform's HTML email shell.
 */
export function emailLayout(content: string, opts: { preheader?: string } = {}): string {
  const site = process.env.NEXT_PUBLIC_SITE_NAME || "LearnRift";
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<title>${site}</title></head>
<body style="margin:0;padding:0;background:#0b0b10;color:#f8fafc;font-family:Inter,system-ui,sans-serif;">
${opts.preheader ? `<div style="display:none;font-size:1px;color:#0b0b10;">${opts.preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(180deg,#14151c 0%,#0e0f15 100%);border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
      <tr><td style="padding:32px 32px 8px;">
        <div style="font-family:'Sora',Inter,sans-serif;font-size:20px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent;">${site}</div>
      </td></tr>
      <tr><td style="padding:16px 32px 32px;line-height:1.6;color:#e2e8f0;">
        ${content}
      </td></tr>
      <tr><td style="padding:24px 32px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgba(226,232,240,0.6);">
        You're receiving this because you have an account on ${site}.<br/>
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/settings" style="color:#a78bfa;">Manage notifications</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
