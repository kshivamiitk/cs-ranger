import type { Express, Request } from "express";
import { z } from "zod";
import {
  ok, fail, requireRole, withDb, writeAuditLog, mock,
  getPlatformSettings, platformSettingDefaults, invalidatePlatformSettingsCache,
  type PlatformSettingKey,
} from "@cs-ranger/shared";

/**
 * Admin governance routes, exposed through the gateway as /api/users/admin/*.
 * Covers DB-backed platform settings, the audit-log viewer, and user
 * management (suspend / roles). Every mutation writes to admin_audit_log.
 */

// Accept both camelCase (repo convention) and snake_case (API spec) query params.
function qp(req: Request, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = req.query[n];
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

function pageParams(req: Request) {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

// ─── Platform settings ────────────────────────────────────────────

const SettingsPatchSchema = z.object({
  site_name: z.string().min(2, "Site name needs at least 2 characters").max(80).optional(),
  commission_rate: z.number().min(0, "Commission rate cannot be negative").max(0.95, "Commission rate is a fraction — use 0.15 for 15% (max 0.95)").optional(),
  min_payout_inr: z.number().int("Minimum payout must be a whole rupee amount").min(1, "Minimum payout must be at least ₹1").max(1_000_000).optional(),
  refund_window_days: z.number().int().min(0).max(90, "Refund window cannot exceed 90 days").optional(),
  tds_threshold_inr: z.number().int().min(0).optional(),
  tds_rate: z.number().min(0).max(0.5, "TDS rate is a fraction — use 0.10 for 10% (max 0.5)").optional(),
  creator_terms_version: z.string().min(1).max(40).optional(),
  payout_schedule: z.enum(["manual", "monthly_1st", "monthly_1st_15th"], { message: "Payout schedule must be manual, monthly_1st or monthly_1st_15th" }).optional(),
  refund_auto_approval: z.boolean().optional(),
  feature_flags: z.record(z.boolean()).optional(),
}).strict();

type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

const SETTING_DESCRIPTIONS: Record<string, string> = {
  site_name: "Public site name",
  commission_rate: "Platform fee as a fraction (0.15 = 15%)",
  min_payout_inr: "Minimum pending balance (₹) before payout",
  refund_window_days: "No-questions-asked refund window in days",
  tds_threshold_inr: "Annual gross over which TDS applies",
  tds_rate: "TDS withholding rate",
  creator_terms_version: "Current Creator T&C version",
  payout_schedule: "Bulk payout cadence: manual | monthly_1st | monthly_1st_15th",
  refund_auto_approval: "Auto-approve refund requests inside the refund window",
  feature_flags: "Boolean toggles for experimental features",
};

async function applySettingsPatch(adminId: string, patch: SettingsPatch) {
  const keys = Object.keys(patch) as PlatformSettingKey[];
  const before = await getPlatformSettings();
  const now = new Date().toISOString();

  const persisted = await withDb(async (db) => {
    const rows = keys.map((key) => ({
      key,
      value: patch[key as keyof SettingsPatch] as unknown,
      description: SETTING_DESCRIPTIONS[key],
      updated_by: adminId,
      updated_at: now,
    }));
    const { error } = await db.from("platform_settings").upsert(rows, { onConflict: "key" });
    if (error) throw error;
    return true;
  }, false);

  invalidatePlatformSettingsCache();

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(patch[key as keyof SettingsPatch])) {
      changes[key] = { before: before[key], after: patch[key as keyof SettingsPatch] };
    }
  }

  // High-stakes keys get their own audit action; everything else is grouped.
  if (changes.commission_rate) {
    await writeAuditLog({ adminId, action: "commission.update", targetType: "setting", targetId: "commission_rate", metadata: { ...changes.commission_rate } });
  }
  if (changes.creator_terms_version) {
    await writeAuditLog({ adminId, action: "terms.update", targetType: "setting", targetId: "creator_terms_version", metadata: { ...changes.creator_terms_version } });
  }
  const otherChanges = Object.fromEntries(Object.entries(changes).filter(([k]) => k !== "commission_rate" && k !== "creator_terms_version"));
  if (Object.keys(otherChanges).length) {
    await writeAuditLog({ adminId, action: "settings.update", targetType: "setting", metadata: { changes: otherChanges } });
  }

  return { persisted, changes };
}

// ─── User management helpers ──────────────────────────────────────

const ReasonSchema = z.object({ reason: z.string().min(10, "Reason must be at least 10 characters").max(500) });
const RevokeCreatorSchema = ReasonSchema.extend({ override: z.boolean().optional() });
const AdminRequestSchema = z.object({ reason: z.string().min(20, "Reason must be at least 20 characters").max(500) });

interface UserCore {
  id: string;
  email: string;
  is_verified: boolean;
  is_suspended: boolean;
  roles: string[];
}

interface AdminUserItem {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url?: string | null;
  college?: string | null;
  email: string;
  roles: string[];
  is_admin: boolean;
  is_verified: boolean;
  is_suspended: boolean;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  kyc_status?: string | null;
  joined_at: string;
  last_login_at?: string | null;
}

async function loadUserCore(dbUserId: string): Promise<UserCore | null> {
  return withDb(async (db) => {
    const [{ data: user }, { data: roles }] = await Promise.all([
      db.from("users").select("id, email, is_verified, is_suspended").eq("id", dbUserId).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", dbUserId),
    ]);
    if (!user) return null;
    return { ...user, roles: roles?.map((r) => r.role) || [] } as UserCore;
  }, () => {
    const u = mock.users.find((x) => x.id === dbUserId);
    if (!u) return null;
    return { id: u.id, email: u.email, is_verified: u.isVerified, is_suspended: false, roles: u.roles };
  });
}

/** Revoke every active refresh token for a user — the suspension "session invalidation" path.
 *  Access tokens are short-lived (≤15 min) JWTs and cannot be revoked; they simply expire. */
async function revokeAllSessions(userId: string) {
  await withDb(async (db) => {
    await db.from("refresh_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
    return null;
  }, null);
}

// ─── Route registration ───────────────────────────────────────────

export function registerAdminRoutes(app: Express) {
  // ── Platform settings ──
  app.get("/admin/platform-settings", requireRole("admin"), async (_req, res) => {
    const settings = await getPlatformSettings();
    const rows = await withDb(async (db) => {
      const { data, error } = await db.from("platform_settings").select("key, value, description, updated_at, updated_by");
      if (error) throw error;
      return data || [];
    }, () => Object.entries(platformSettingDefaults()).map(([key, value]) => ({ key, value, description: SETTING_DESCRIPTIONS[key], updated_at: null, updated_by: null })));
    ok(res, { settings, rows });
  });

  app.patch("/admin/platform-settings", requireRole("admin"), async (req, res) => {
    const parsed = SettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    if (Object.keys(parsed.data).length === 0) return fail(res, 400, "Provide at least one setting to update", "VALIDATION");

    const { changes } = await applySettingsPatch(req.user!.id, parsed.data);
    const settings = await getPlatformSettings();
    ok(res, { settings, changedKeys: Object.keys(changes) });
  });

  // ── Audit log ──
  app.get("/admin/audit-log", requireRole("admin"), async (req, res) => {
    const { page, pageSize, from, to } = pageParams(req);
    const actionType = qp(req, "actionType", "action_type");
    const adminId = qp(req, "adminId", "admin_id");
    const targetType = qp(req, "targetType", "target_type");
    const dateFrom = qp(req, "dateFrom", "date_from");
    const dateToRaw = qp(req, "dateTo", "date_to");
    // Date-only "to" filters should include the whole day.
    const dateTo = dateToRaw && dateToRaw.length === 10 ? `${dateToRaw}T23:59:59.999Z` : dateToRaw;

    const result = await withDb(async (db) => {
      let q = db.from("admin_audit_log")
        .select("id, admin_id, action, target_type, target_id, metadata, created_at, admin:users!admin_audit_log_admin_id_fkey(email, profiles(display_name, username, avatar_url))", { count: "exact" });
      if (actionType) q = q.eq("action", actionType);
      if (adminId) q = q.eq("admin_id", adminId);
      if (targetType) q = q.eq("target_type", targetType);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo);
      q = q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
      const { data, count, error } = await q;
      if (error) throw error;
      return { items: data || [], total: count || 0 };
    }, { items: [], total: 0 });

    ok(res, result.items, { page, pageSize, total: result.total });
  });

  // ── User list ──
  app.get("/admin/users", requireRole("admin"), async (req, res) => {
    const { page, pageSize, from, to } = pageParams(req);
    const role = qp(req, "role");
    const status = qp(req, "status");
    // Strip PostgREST filter syntax characters so the search string can't break out of the .or() expression.
    const search = qp(req, "q", "search")?.replace(/[,()]/g, " ").trim();

    const result = await withDb<{ items: AdminUserItem[]; total: number }>(async (db) => {
      const roleEmbed = role ? ", user_roles!inner(role)" : "";
      let q = db.from("profiles").select(
        `user_id, display_name, username, avatar_url, college, is_admin, created_at,
         users!profiles_user_id_fkey!inner(email, is_verified, is_suspended, suspended_at, suspension_reason, created_at, last_login_at, kyc_details(kyc_status, verified_at))${roleEmbed}`,
        { count: "exact" },
      );
      if (role) q = q.eq("user_roles.role", role);
      if (status === "suspended") q = q.eq("users.is_suspended", true);
      if (status === "active") q = q.eq("users.is_suspended", false);
      if (status === "unverified") q = q.eq("users.is_verified", false);
      if (search) q = q.or(`display_name.ilike.%${search}%,username.ilike.%${search}%`);
      q = q.order("created_at", { ascending: false }).range(from, to);
      const { data, count, error } = await q;
      if (error) throw error;

      type Row = {
        user_id: string; display_name: string; username: string; avatar_url?: string | null; college?: string | null;
        is_admin: boolean; created_at: string;
        users: {
          email: string; is_verified: boolean; is_suspended: boolean; suspended_at?: string | null; suspension_reason?: string | null;
          created_at: string; last_login_at?: string | null; kyc_details?: { kyc_status: string; verified_at?: string | null } | null;
        };
      };
      const rows = (data as unknown as Row[]) || [];
      // Roles fetched separately so the chips always show the FULL role set even
      // when the list is filtered down to a single role.
      const ids = rows.map((r) => r.user_id);
      const { data: roleRows } = ids.length
        ? await db.from("user_roles").select("user_id, role").in("user_id", ids)
        : { data: [] as { user_id: string; role: string }[] };
      const rolesByUser = new Map<string, string[]>();
      for (const r of roleRows || []) rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) || []), r.role]);

      const items = rows.map((r) => ({
        user_id: r.user_id,
        display_name: r.display_name,
        username: r.username,
        avatar_url: r.avatar_url,
        college: r.college,
        email: r.users.email,
        roles: rolesByUser.get(r.user_id) || ["learner"],
        is_admin: r.is_admin,
        is_verified: r.users.is_verified,
        is_suspended: r.users.is_suspended,
        suspended_at: r.users.suspended_at,
        suspension_reason: r.users.suspension_reason,
        kyc_status: r.users.kyc_details?.kyc_status || null,
        joined_at: r.users.created_at,
        last_login_at: r.users.last_login_at,
      }));
      return { items, total: count || 0 };
    }, () => {
      let all = mock.users.map((u) => ({
        user_id: u.id, display_name: u.displayName, username: u.username, avatar_url: u.avatarUrl, college: u.college,
        email: u.email, roles: u.roles, is_admin: u.roles.includes("admin"), is_verified: u.isVerified,
        is_suspended: false, suspended_at: null, suspension_reason: null, kyc_status: null,
        joined_at: u.createdAt, last_login_at: null,
      }));
      if (role) all = all.filter((u) => u.roles.includes(role as "learner" | "creator" | "admin"));
      if (status === "suspended") all = [];
      if (search) all = all.filter((u) => `${u.display_name}${u.username}`.toLowerCase().includes(search.toLowerCase()));
      return { items: all.slice(from, to + 1), total: all.length };
    });

    ok(res, result.items, { page, pageSize, total: result.total });
  });

  // ── Suspend / unsuspend ──
  app.post("/admin/users/:userId/suspend", requireRole("admin"), async (req, res) => {
    const parsed = ReasonSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const targetId = String(req.params.userId);
    if (targetId === req.user!.id) return fail(res, 400, "You cannot suspend your own account", "INVALID_STATE");

    const target = await loadUserCore(targetId);
    if (!target) return fail(res, 404, "User not found", "NOT_FOUND");
    if (target.roles.includes("admin")) return fail(res, 400, "Admin accounts cannot be suspended — revoke admin first", "INVALID_STATE");
    if (target.is_suspended) return fail(res, 400, "User is already suspended", "INVALID_STATE");

    await withDb(async (db) => {
      const { error } = await db.from("users").update({
        is_suspended: true, suspended_at: new Date().toISOString(), suspension_reason: parsed.data.reason,
      }).eq("id", targetId);
      if (error) throw error;
      return null;
    }, null);
    await revokeAllSessions(targetId);
    await writeAuditLog({ adminId: req.user!.id, action: "user.suspend", targetType: "user", targetId, metadata: { reason: parsed.data.reason, email: target.email } });
    ok(res, { suspended: true });
  });

  app.post("/admin/users/:userId/unsuspend", requireRole("admin"), async (req, res) => {
    const parsed = ReasonSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const targetId = String(req.params.userId);

    const target = await loadUserCore(targetId);
    if (!target) return fail(res, 404, "User not found", "NOT_FOUND");
    if (!target.is_suspended) return fail(res, 400, "User is not suspended", "INVALID_STATE");

    await withDb(async (db) => {
      const { error } = await db.from("users").update({ is_suspended: false, suspended_at: null, suspension_reason: null }).eq("id", targetId);
      if (error) throw error;
      return null;
    }, null);
    await writeAuditLog({ adminId: req.user!.id, action: "user.unsuspend", targetType: "user", targetId, metadata: { reason: parsed.data.reason, email: target.email } });
    ok(res, { suspended: false });
  });

  // ── Creator role grant / revoke ──
  app.post("/admin/users/:userId/grant-creator", requireRole("admin"), async (req, res) => {
    const parsed = ReasonSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const targetId = String(req.params.userId);

    const target = await loadUserCore(targetId);
    if (!target) return fail(res, 404, "User not found", "NOT_FOUND");
    if (target.roles.includes("creator")) return fail(res, 400, "User already has the creator role", "INVALID_STATE");

    await withDb(async (db) => {
      const { error } = await db.from("user_roles").insert({ user_id: targetId, role: "creator" });
      if (error && !String(error.message).includes("duplicate")) throw error;
      return null;
    }, null);
    await writeAuditLog({ adminId: req.user!.id, action: "user.grant_creator", targetType: "user", targetId, metadata: { reason: parsed.data.reason } });
    ok(res, { roles: [...target.roles, "creator"] });
  });

  app.post("/admin/users/:userId/revoke-creator", requireRole("admin"), async (req, res) => {
    const parsed = RevokeCreatorSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const targetId = String(req.params.userId);

    const target = await loadUserCore(targetId);
    if (!target) return fail(res, 404, "User not found", "NOT_FOUND");
    if (!target.roles.includes("creator")) return fail(res, 400, "User does not have the creator role", "INVALID_STATE");
    if (target.roles.includes("admin")) return fail(res, 400, "Cannot revoke creator from an admin account", "INVALID_STATE");

    const pending = await withDb(async (db) => {
      const { data } = await db.from("creator_balances").select("pending").eq("creator_id", targetId).maybeSingle();
      return data?.pending || 0;
    }, 0);
    if (pending > 0 && !parsed.data.override) {
      return fail(res, 409, `Creator has a pending balance of ₹${(pending / 100).toFixed(2)} — pass override to revoke anyway`, "PENDING_BALANCE", { pending });
    }

    await withDb(async (db) => {
      const { error } = await db.from("user_roles").delete().eq("user_id", targetId).eq("role", "creator");
      if (error) throw error;
      return null;
    }, null);
    await writeAuditLog({ adminId: req.user!.id, action: "user.revoke_creator", targetType: "user", targetId, metadata: { reason: parsed.data.reason, pendingBalance: pending, override: !!parsed.data.override } });
    ok(res, { roles: target.roles.filter((r) => r !== "creator") });
  });

  // ── Admin role: two-person request/approve flow ──
  // Granting admin is deliberately NOT a single call: one admin files a request,
  // a DIFFERENT admin approves it. Approval flips profiles.is_admin, and the
  // sync_admin_role trigger (migration 0012) materialises the user_roles row.
  app.post("/admin/users/:userId/request-admin", requireRole("admin"), async (req, res) => {
    const parsed = AdminRequestSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0].message, "VALIDATION");
    const targetId = String(req.params.userId);
    if (targetId === req.user!.id) return fail(res, 400, "You cannot request admin for your own account", "INVALID_STATE");

    const target = await loadUserCore(targetId);
    if (!target) return fail(res, 404, "User not found", "NOT_FOUND");
    if (target.roles.includes("admin")) return fail(res, 400, "User is already an admin", "INVALID_STATE");
    if (target.is_suspended) return fail(res, 400, "Cannot grant admin to a suspended account", "INVALID_STATE");

    const request = await withDb(async (db) => {
      const { data: existing } = await db.from("admin_role_requests").select("id").eq("target_user", targetId).eq("status", "pending").maybeSingle();
      if (existing) return { duplicate: true as const };
      const { data, error } = await db.from("admin_role_requests").insert({
        target_user: targetId, requested_by: req.user!.id, reason: parsed.data.reason,
      }).select("*").single();
      if (error) throw error;
      return data;
    }, () => ({ id: `req_dev_${Date.now()}`, target_user: targetId, requested_by: req.user!.id, reason: parsed.data.reason, status: "pending", created_at: new Date().toISOString() }));

    if (request && "duplicate" in request) return fail(res, 409, "An admin grant request for this user is already pending", "DUPLICATE");
    await writeAuditLog({ adminId: req.user!.id, action: "user.admin_grant_requested", targetType: "user", targetId, metadata: { reason: parsed.data.reason, requestId: (request as { id: string }).id } });
    ok(res, request);
  });

  app.get("/admin/admin-requests", requireRole("admin"), async (req, res) => {
    const status = qp(req, "status") || "pending";
    const list = await withDb(async (db) => {
      const { data, error } = await db.from("admin_role_requests")
        .select("*, target:users!admin_role_requests_target_user_fkey(email, profiles(display_name, username)), requester:users!admin_role_requests_requested_by_fkey(email, profiles(display_name, username))")
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }, () => []);
    ok(res, list);
  });

  app.post("/admin/admin-requests/:requestId/approve", requireRole("admin"), async (req, res) => {
    const requestId = String(req.params.requestId);
    type ReviewResult = { notFound: true } | { invalid: string } | { request: { id: string; target_user: string; requested_by: string } };
    const result = await withDb<ReviewResult>(async (db) => {
      const { data: request } = await db.from("admin_role_requests").select("*").eq("id", requestId).maybeSingle();
      if (!request) return { notFound: true as const };
      if (request.status !== "pending") return { invalid: "Request has already been reviewed" } as const;
      if (request.requested_by === req.user!.id) return { invalid: "A different admin must approve this request (two-person rule)" } as const;

      const { error: profileError } = await db.from("profiles").update({ is_admin: true }).eq("user_id", request.target_user);
      if (profileError) throw profileError;
      const { error } = await db.from("admin_role_requests").update({
        status: "approved", reviewed_by: req.user!.id, reviewed_at: new Date().toISOString(),
      }).eq("id", requestId);
      if (error) throw error;
      return { request };
    }, () => ({ request: { id: requestId, target_user: "unknown", requested_by: "unknown" } }));

    if ("notFound" in result) return fail(res, 404, "Admin grant request not found", "NOT_FOUND");
    if ("invalid" in result) return fail(res, 400, result.invalid, "INVALID_STATE");
    await writeAuditLog({
      adminId: req.user!.id, action: "user.grant_admin", targetType: "user", targetId: result.request.target_user,
      metadata: { requestId, requestedBy: result.request.requested_by },
    });
    ok(res, { approved: true, targetUserId: result.request.target_user });
  });

  app.post("/admin/admin-requests/:requestId/reject", requireRole("admin"), async (req, res) => {
    const requestId = String(req.params.requestId);
    type ReviewResult = { notFound: true } | { invalid: string } | { request: { id: string; target_user: string } };
    const result = await withDb<ReviewResult>(async (db) => {
      const { data: request } = await db.from("admin_role_requests").select("*").eq("id", requestId).maybeSingle();
      if (!request) return { notFound: true as const };
      if (request.status !== "pending") return { invalid: "Request has already been reviewed" } as const;
      const { error } = await db.from("admin_role_requests").update({
        status: "rejected", reviewed_by: req.user!.id, reviewed_at: new Date().toISOString(),
      }).eq("id", requestId);
      if (error) throw error;
      return { request };
    }, () => ({ request: { id: requestId, target_user: "unknown" } }));

    if ("notFound" in result) return fail(res, 404, "Admin grant request not found", "NOT_FOUND");
    if ("invalid" in result) return fail(res, 400, result.invalid, "INVALID_STATE");
    await writeAuditLog({ adminId: req.user!.id, action: "user.admin_grant_rejected", targetType: "user", targetId: result.request.target_user, metadata: { requestId } });
    ok(res, { rejected: true });
  });
}
