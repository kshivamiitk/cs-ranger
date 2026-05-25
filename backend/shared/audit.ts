import { withDb } from "./supabase.js";

export interface AuditLogEntry {
  adminId: string;
  /** Dot-namespaced action key, e.g. "settings.update", "user.suspend", "payout.manual". */
  action: string;
  targetType?: "course" | "user" | "payout_run" | "payout_item" | "setting" | string;
  targetId?: string;
  /** Before/after values, reasons, amounts — anything an auditor needs. */
  metadata?: Record<string, unknown>;
}

/**
 * Append a row to the immutable admin_audit_log. Best-effort: a failed audit
 * write is logged but never fails the admin action itself (the table is
 * append-only and admin-insert-only via RLS, so the common failure mode is
 * Supabase being unconfigured in local dev).
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<boolean> {
  return withDb(async (db) => {
    const { error } = await db.from("admin_audit_log").insert({
      admin_id: entry.adminId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) throw error;
    return true;
  }, () => {
    console.log(JSON.stringify({ level: "info", msg: "[audit:dev]", ...entry }));
    return false;
  });
}
