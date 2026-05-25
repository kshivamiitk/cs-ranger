import { redis } from "./events";

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
  const r = redis();
  if (!r) return compute();
  try {
    const cached = await r.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    /* Redis hiccup — fall through to compute, don't fail the request. */
  }
  const fresh = await compute();
  try {
    await r.set(key, JSON.stringify(fresh), "EX", ttlSeconds);
  } catch {
    /* Best-effort set. If it fails, the next request just recomputes. */
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
  const r = redis();
  if (!r || keys.length === 0) return;
  try {
    await r.del(...keys);
  } catch {
    /* ignore */
  }
}

/**
 * Invalidate every key matching a prefix. Uses SCAN (non-blocking) +
 * UNLINK (lazy-deletes from a background thread) so even a large keyspace
 * doesn't pin the Redis main thread. Common case: bust an entire catalog
 * snapshot after a course publish.
 */
export async function bustPrefix(prefix: string): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    const stream = r.scanStream({ match: `${prefix}*`, count: 200 });
    for await (const keys of stream) {
      if (keys && keys.length) await r.unlink(...keys);
    }
  } catch {
    /* ignore */
  }
}
