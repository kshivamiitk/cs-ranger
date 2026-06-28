import { createHash } from "node:crypto";

const RAZORPAY_REFERENCE_ID_MAX = 40;
const RAZORPAY_IDEMPOTENCY_KEY_MAX = 36;

type IdPart = string | number | null | undefined;

function token(value: IdPart): string {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
}

function digest(prefix: string, parts: IdPart[], length: number): string {
  return createHash("sha256")
    .update([prefix, ...parts.map((part) => String(part ?? ""))].join("|"))
    .digest("base64url")
    .slice(0, length);
}

/**
 * Razorpay caps reference_id at 40 chars. UUID concatenation breaks that limit,
 * so keep a readable suffix plus a deterministic hash for uniqueness.
 */
export function razorpayReferenceId(prefix: string, ...parts: IdPart[]): string {
  const safePrefix = token(prefix).slice(0, 12) || "lr";
  const hash = digest(safePrefix, parts, 12);
  const readable = parts.map((part) => token(part).slice(-8)).filter(Boolean).join("_");
  if (!readable) return `${safePrefix}_${hash}`.slice(0, RAZORPAY_REFERENCE_ID_MAX);

  const readableBudget = RAZORPAY_REFERENCE_ID_MAX - safePrefix.length - hash.length - 2;
  const boundedReadable = readable.slice(Math.max(0, readable.length - Math.max(0, readableBudget)));
  return `${safePrefix}_${boundedReadable}_${hash}`.slice(0, RAZORPAY_REFERENCE_ID_MAX);
}

/**
 * Payout idempotency keys go to Razorpay in a header. Bound them as well so
 * manual, bulk and retry payout paths cannot fail on long UUID combinations.
 */
export function razorpayIdempotencyKey(prefix: string, ...parts: IdPart[]): string {
  const safePrefix = token(prefix).slice(0, 10) || "lr";
  const hash = digest(safePrefix, parts, 24);
  return `${safePrefix}_${hash}`.slice(0, RAZORPAY_IDEMPOTENCY_KEY_MAX);
}

