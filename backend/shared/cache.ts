import { redis, withTimeout } from "./events";

// How long a single cache read/write may take before we give up and treat it
// as a miss. Tuned low: a healthy Redis answers in <5ms, so 1s only ever bites
// when the server is actually unreachable.
const CACHE_OP_TIMEOUT_MS = 1000;
// Once a cache op times out / errors we assume Redis is down and skip it
// entirely for this window, so we don't pay the timeout on every request.
const BREAKER_COOLDOWN_MS = 10_000;
let redisDownUntil = 0;

/** Redis client to use for caching, or null if unconfigured or the breaker is open. */
function cacheClient() {
  if (Date.now() < redisDownUntil) return null;
  return redis();
}

function tripBreaker() {
  redisDownUntil = Date.now() + BREAKER_COOLDOWN_MS;
}

/**
 * Tiny read-through cache wrapper for hot endpoints whose payloads are
 * acceptable to stale by N seconds (catalog feeds, ranked lists, etc).
 *
 * Falls back to direct compute() when Redis isn't configured, so callers
 * never have to branch for local dev / unconfigured deployments. Redis
 * errors are swallowed and treated as a miss — better to serve a slightly
 * slower request than to take an outage when the cache flakes.
 *
 * Usage:
 *   const result = await withCache(`catalog:${key}`, 30, async () => {
 *     // expensive DB work
 *     return queryResult;
 *   });
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const r = cacheClient();
  if (!r) return compute();
  try {
    const cached = await withTimeout(r.get(key), CACHE_OP_TIMEOUT_MS, "cache get");
    if (cached) return JSON.parse(cached) as T;
  } catch {
    /* Redis hiccup or down — trip the breaker and serve from compute(). */
    tripBreaker();
    return compute();
  }
  const fresh = await compute();
  try {
    await withTimeout(r.set(key, JSON.stringify(fresh), "EX", ttlSeconds), CACHE_OP_TIMEOUT_MS, "cache set");
  } catch {
    /* Best-effort set. If it fails, the next request just recomputes. */
    tripBreaker();
  }
  return fresh;
}

/**
 * Invalidate one or more cache keys by exact match. Use sparingly — the
 * preferred pattern is short TTLs (30–60s) + tolerant staleness, not active
 * invalidation. But e.g. course publish flips need to refresh the catalog
 * snapshot faster than the TTL would allow.
 */
export async function bustCache(...keys: string[]): Promise<void> {
  const r = cacheClient();
  if (!r || keys.length === 0) return;
  try {
    await withTimeout(r.del(...keys), CACHE_OP_TIMEOUT_MS, "cache del");
  } catch {
    tripBreaker();
  }
}

/**
 * Invalidate every key matching a prefix. Uses SCAN (non-blocking) +
 * UNLINK (lazy-deletes from a background thread) so even a large keyspace
 * doesn't pin the Redis main thread. Common case: bust an entire catalog
 * snapshot after a course publish.
 */
export async function bustPrefix(prefix: string): Promise<void> {
  const r = cacheClient();
  if (!r) return;
  try {
    await withTimeout((async () => {
      const stream = r.scanStream({ match: `${prefix}*`, count: 200 });
      for await (const keys of stream) {
        if (keys && keys.length) await r.unlink(...keys);
      }
    })(), CACHE_OP_TIMEOUT_MS, "cache scan/unlink");
  } catch {
    tripBreaker();
  }
}
