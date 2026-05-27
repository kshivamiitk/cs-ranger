import { withDb } from "./supabase.js";

/**
 * DB-backed platform settings (platform_settings table, one jsonb value per key)
 * with env-var fallback so every flow keeps working before the migration/seed
 * has run or when Supabase isn't configured.
 *
 * Reads are cached in-process for a short TTL — settings change rarely, and a
 * 30s lag across services is acceptable. The service that writes settings
 * (user-service) calls invalidatePlatformSettingsCache() after a PATCH so its
 * own subsequent reads are immediately fresh.
 */

export type PlatformSettingKey =
  | "site_name"
  | "commission_rate"
  | "min_payout_inr"
  | "refund_window_days"
  | "tds_threshold_inr"
  | "tds_rate"
  | "creator_terms_version"
  | "payout_schedule"
  | "refund_auto_approval"
  | "feature_flags";

export type PlatformSettings = Record<PlatformSettingKey, unknown> & Record<string, unknown>;

const CACHE_TTL_MS = 30_000;
let _cache: { value: PlatformSettings; expiresAt: number } | null = null;

/** Env-driven defaults — read at call time so dotenv load order doesn't matter. */
export function platformSettingDefaults(): PlatformSettings {
  return {
    site_name: process.env.NEXT_PUBLIC_SITE_NAME || "LearnRift",
    commission_rate: Number(process.env.PLATFORM_COMMISSION_RATE || 0.15),
    min_payout_inr: Number(process.env.PLATFORM_MIN_PAYOUT_INR || 500),
    refund_window_days: Number(process.env.PLATFORM_REFUND_WINDOW_DAYS || 7),
    tds_threshold_inr: Number(process.env.PLATFORM_TDS_THRESHOLD_INR || 50000),
    tds_rate: Number(process.env.PLATFORM_TDS_RATE || 0.10),
    creator_terms_version: "2026-05-01",
    payout_schedule: "manual",
    refund_auto_approval: false,
    feature_flags: {},
  };
}

/** Full settings map: DB rows merged over env defaults. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.value;
  const defaults = platformSettingDefaults();
  const merged = await withDb(async (db) => {
    const { data, error } = await db.from("platform_settings").select("key, value");
    if (error) throw error;
    const out: PlatformSettings = { ...defaults };
    for (const row of data || []) out[row.key as PlatformSettingKey] = row.value;
    return out;
  }, defaults);
  _cache = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS };
  return merged;
}

/** Single setting with a typed fallback when the key is missing or malformed. */
export async function getPlatformSetting<T>(key: PlatformSettingKey, fallback: T): Promise<T> {
  const all = await getPlatformSettings();
  const value = all[key];
  if (value === undefined || value === null) return fallback;
  if (typeof fallback === "number") {
    const n = Number(value);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  return value as T;
}

export function invalidatePlatformSettingsCache(): void {
  _cache = null;
}
