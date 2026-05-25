import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
let _warned = false;

/**
 * Service-role Supabase client for backend services.
 * Bypasses RLS — the API layer is responsible for authorization.
 *
 * Lazily constructed so importing this module doesn't crash when env vars
 * are missing during local dev (the mock fallback kicks in instead).
 */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    if (!_warned) {
      console.warn(JSON.stringify({
        level: "warn",
        msg: "Supabase env not configured — using mock fallback. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.",
      }));
      _warned = true;
    }
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "cs-ranger-backend" } },
  });
  return _admin;
}

export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY;
}

/**
 * Run an async function with Supabase, or fall back to the provided mock
 * value if Supabase isn't configured. Use this everywhere a service needs
 * data so dev/demo continues to work without credentials.
 */
export async function withDb<T>(
  fn: (db: SupabaseClient) => Promise<T>,
  fallback: T | (() => T | Promise<T>),
): Promise<T> {
  if (!isSupabaseConfigured()) {
    return typeof fallback === "function" ? await (fallback as () => T | Promise<T>)() : fallback;
  }
  try {
    return await fn(supabaseAdmin());
  } catch (err) {
    // Supabase/PostgREST errors are plain objects (PostgrestError), not Error
    // instances — String(err) would log "[object Object]". Pull out the useful
    // fields (message, Postgres code, details, hint) so failures are diagnosable.
    const e = err as { message?: string; code?: string; details?: string; hint?: string } | null;
    console.error(JSON.stringify({
      level: "error",
      msg: "supabase query failed",
      err: e?.message || (err instanceof Error ? err.message : String(err)),
      code: e?.code,
      details: e?.details,
      hint: e?.hint,
    }));
    return typeof fallback === "function" ? await (fallback as () => T | Promise<T>)() : fallback;
  }
}
