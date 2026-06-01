import { makeLogger } from "./utils/logger.js";

const log = makeLogger("env");

const IS_PROD = process.env.NODE_ENV === "production";

// Convenience secret used ONLY when NODE_ENV !== "production". It must never
// reach a real deployment — assertProductionEnv()/requireJwtSecret() below
// reject it (and anything else that looks like a placeholder) in production.
const DEV_JWT_SECRET = "dev-secret-replace-me";

// True for values that must never be accepted as a real secret in production:
// too short, the known dev defaults, or obvious "replace me"/"your-…" stubs.
function looksPlaceholder(value: string): boolean {
  return (
    value.length < 32 ||
    /^(dev-secret-replace-me|change-me-in-prod)$/i.test(value) ||
    /\b(replace|change)[-_ ]?me\b/i.test(value) ||
    /\byour[-_ ]?(secret|key|token)\b/i.test(value)
  );
}

const isLocalUrl = (v?: string): boolean => !!v && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(v);

/**
 * The JWT signing/verification secret shared by auth-service (signs tokens) and
 * api-gateway (verifies them). In production a missing, placeholder, or too-short
 * secret throws at startup — booting with the well-known dev fallback would let
 * anyone forge tokens for any user/role. In dev/test the convenient default is
 * returned so local work needs no setup.
 */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!IS_PROD) return secret || DEV_JWT_SECRET;
  if (!secret || looksPlaceholder(secret)) {
    throw new Error(
      "FATAL: JWT_SECRET is missing, a known placeholder, or shorter than 32 chars while " +
        "NODE_ENV=production. Generate a strong secret (e.g. `openssl rand -hex 32`) and set " +
        "JWT_SECRET in the server environment before starting.",
    );
  }
  return secret;
}

/**
 * Fail-fast environment validation, called once per service at startup
 * (via createService, and explicitly in api-gateway which builds its own app).
 *
 * In production, FATAL misconfigurations throw so the process exits instead of
 * serving traffic in an insecure or mock-data state:
 *   - JWT_SECRET missing/placeholder/short → forgeable auth tokens.
 *   - SUPABASE_URL / SUPABASE_SERVICE_KEY missing → the backend silently falls
 *     back to in-memory mock data, so anyone can "log in" as a seeded user.
 *
 * Non-fatal misconfigurations are logged as warnings (the service still boots):
 *   test Razorpay keys, localhost URLs, missing email/Sentry config, and email
 *   verification left disabled.
 *
 * Outside production this is a no-op.
 */
export function assertProductionEnv(): void {
  if (!IS_PROD) return;

  const fatal: string[] = [];
  const warn: string[] = [];

  const jwt = process.env.JWT_SECRET;
  if (!jwt || looksPlaceholder(jwt)) {
    fatal.push("JWT_SECRET is missing, a known placeholder, or < 32 chars (run `openssl rand -hex 32`).");
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    fatal.push(
      "SUPABASE_URL and/or SUPABASE_SERVICE_KEY are missing — the backend would fall back to " +
        "in-memory mock data, which is an auth bypass.",
    );
  }

  if (isLocalUrl(process.env.FRONTEND_URL))
    warn.push("FRONTEND_URL points at localhost — CORS will reject the real frontend origin.");
  if (isLocalUrl(process.env.NEXT_PUBLIC_SITE_URL))
    warn.push("NEXT_PUBLIC_SITE_URL points at localhost — links in emails will be wrong.");
  if (isLocalUrl(process.env.NEXT_PUBLIC_API_URL))
    warn.push('NEXT_PUBLIC_API_URL points at localhost — set it to "/api" (same-origin) or the public API URL.');

  const rzpId = process.env.RAZORPAY_KEY_ID || "";
  if (!rzpId || rzpId.startsWith("rzp_test"))
    warn.push("RAZORPAY_KEY_ID is missing or a test key — live payments will not work.");
  if (!process.env.RAZORPAY_KEY_SECRET)
    warn.push("RAZORPAY_KEY_SECRET is missing — payment verification will fail.");
  if (!process.env.RAZORPAY_WEBHOOK_SECRET)
    warn.push("RAZORPAY_WEBHOOK_SECRET is missing — webhook signatures cannot be verified.");
  if ((process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").startsWith("rzp_test"))
    warn.push("NEXT_PUBLIC_RAZORPAY_KEY_ID is a test key — checkout runs in test mode.");

  const resend = process.env.RESEND_API_KEY || "";
  if (!resend || /your|placeholder/i.test(resend))
    warn.push("RESEND_API_KEY is missing or a placeholder — transactional email is disabled.");
  if (!/^true$/i.test(process.env.EMAIL_VERIFICATION ?? ""))
    warn.push("EMAIL_VERIFICATION is not TRUE — new accounts are auto-verified without confirming their email.");
  if (!process.env.SENTRY_DSN)
    warn.push("SENTRY_DSN is empty — server errors will not be reported to Sentry.");

  for (const w of warn) log.warn("env check", { warning: w });

  if (fatal.length) {
    // One combined, actionable error; thrown before the service starts listening.
    throw new Error(
      "FATAL: production environment is not safe to start:\n  - " +
        fatal.join("\n  - ") +
        "\nFix these in the server .env (see .env.example) and restart.",
    );
  }
}
