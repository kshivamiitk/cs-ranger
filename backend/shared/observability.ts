import { isSupabaseConfigured, supabaseAdmin } from "./supabase.js";
import { redis } from "./events.js";

// ─── Per-service in-memory metrics ─────────────────────────────────
// Counters since process start. Cheap (a handful of integers), reset on
// restart, and exposed via GET /metrics — enough to spot an error spike or a
// latency regression per service without standing up a metrics stack.

export type LatencyBucket = "lt50ms" | "lt200ms" | "lt1000ms" | "gte1000ms";

export function bucketForDuration(durationMs: number): LatencyBucket {
  if (durationMs < 50) return "lt50ms";
  if (durationMs < 200) return "lt200ms";
  if (durationMs < 1000) return "lt1000ms";
  return "gte1000ms";
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  requestsTotal: number;
  errors5xx: number;
  errors4xx: number;
  avgLatencyMs: number;
  latencyBuckets: Record<LatencyBucket, number>;
}

export interface MetricsStore {
  record(statusCode: number, durationMs: number): void;
  snapshot(): MetricsSnapshot;
}

export function createMetricsStore(now: () => number = Date.now): MetricsStore {
  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  let requestsTotal = 0;
  let errors5xx = 0;
  let errors4xx = 0;
  let totalDurationMs = 0;
  const latencyBuckets: Record<LatencyBucket, number> = { lt50ms: 0, lt200ms: 0, lt1000ms: 0, gte1000ms: 0 };

  return {
    record(statusCode, durationMs) {
      requestsTotal += 1;
      totalDurationMs += durationMs;
      latencyBuckets[bucketForDuration(durationMs)] += 1;
      if (statusCode >= 500) errors5xx += 1;
      else if (statusCode >= 400) errors4xx += 1;
    },
    snapshot() {
      return {
        startedAt,
        uptimeSeconds: Math.floor((now() - startedAtMs) / 1000),
        requestsTotal,
        errors5xx,
        errors4xx,
        avgLatencyMs: requestsTotal ? Math.round((totalDurationMs / requestsTotal) * 10) / 10 : 0,
        latencyBuckets: { ...latencyBuckets },
      };
    },
  };
}

// ─── Dependency connectivity ───────────────────────────────────────

export interface DependencyHealth {
  configured: boolean;
  ok?: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Probe the service's external dependencies. Returns booleans + latency only —
 * never URLs, hostnames or keys, so the payload is safe to surface in /admin/ops.
 */
export async function checkConnectivity(): Promise<{ supabase: DependencyHealth; redis: DependencyHealth }> {
  const supabase: DependencyHealth = { configured: isSupabaseConfigured() };
  if (supabase.configured) {
    const start = Date.now();
    try {
      const { error } = await supabaseAdmin().from("platform_settings").select("key").limit(1);
      if (error) throw error;
      supabase.ok = true;
    } catch (err) {
      supabase.ok = false;
      supabase.error = (err as { message?: string })?.message || (err instanceof Error ? err.message : "query failed");
    }
    supabase.latencyMs = Date.now() - start;
  }

  const client = redis();
  const redisHealth: DependencyHealth = { configured: !!client };
  if (client) {
    const start = Date.now();
    try {
      await client.ping();
      redisHealth.ok = true;
    } catch (err) {
      redisHealth.ok = false;
      redisHealth.error = err instanceof Error ? err.message : "ping failed";
    }
    redisHealth.latencyMs = Date.now() - start;
  }

  return { supabase, redis: redisHealth };
}
