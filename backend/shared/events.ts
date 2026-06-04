import IORedis from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";

let _redis: IORedis | null = null;
const queues = new Map<string, Queue>();
let lastRedisErrorLog = 0;

/**
 * Race a promise against a timer so a hung Redis command (e.g. when the server
 * is down and the command sits in ioredis's offline queue, which never rejects
 * with maxRetriesPerRequest: null) can't stall the HTTP request. The underlying
 * promise is left to settle on its own; we just stop waiting on it.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "redis op"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// Exported so the cache helper (and any other module that needs the same
// connection — events + cache should share one client, not open two) can use it.
export function redis(): IORedis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // maxRetriesPerRequest stays null because BullMQ requires it (it issues
  // blocking commands that legitimately wait). retryStrategy caps reconnection
  // backoff so a down Redis doesn't storm, and the bounded connectTimeout means
  // a single connect attempt fails fast. The error listener is essential: ioredis
  // emits 'error' on every connection failure, and an unhandled 'error' event
  // would crash the whole service when Redis goes down.
  _redis = new IORedis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  _redis.on("error", (err) => {
    const now = Date.now();
    if (now - lastRedisErrorLog > 30_000) {
      lastRedisErrorLog = now;
      console.error(JSON.stringify({ level: "warn", msg: "redis error", err: err?.message }));
    }
  });
  return _redis;
}

/** Topic names — one queue per event type. */
export const Topics = {
  USER_REGISTERED: "user.registered",
  USER_PASSWORD_RESET: "user.password_reset_requested",
  ENROLLMENT_CREATED: "enrollment.created",
  ENROLLMENT_COMPLETED: "enrollment.completed",
  PAYMENT_VERIFIED: "payment.verified",
  PAYMENT_REFUNDED: "payment.refunded",
  COURSE_PUBLISHED: "course.published",
  COURSE_NODE_ADDED: "course.node_added",
  COMMENT_CREATED: "comment.created",
  COMMENT_REPLIED: "comment.replied",
  KYC_STATUS_CHANGED: "kyc.status_changed",
  PAYOUT_COMPLETED: "payout.completed",
  PAYOUT_FAILED: "payout.failed",
  SUPPORT_TICKET_UPDATED: "support_ticket.updated",
  ACHIEVEMENT_BADGE_EARNED: "achievement.badge_earned",
  ACHIEVEMENT_CERTIFICATE_ISSUED: "achievement.certificate_issued",
  NODE_COMPLETED: "node_progress.completed",
} as const;
export type Topic = (typeof Topics)[keyof typeof Topics];

export async function publish<T = unknown>(topic: Topic, payload: T): Promise<void> {
  const r = redis();
  if (!r) {
    // No Redis configured — log to stderr so events are still visible in dev.
    console.log(JSON.stringify({ level: "info", topic, payload, noQueue: true }));
    return;
  }
  let q = queues.get(topic);
  if (!q) {
    q = new Queue(topic, { connection: r });
    queues.set(topic, q);
  }
  // Don't let enqueuing an event hang the request when Redis is down — the add
  // would otherwise sit in the offline queue indefinitely. If it times out we
  // drop the event (best-effort) and let the originating request succeed.
  try {
    await withTimeout(
      q.add(topic, payload, { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: "exponential", delay: 1000 } }),
      2000,
      `publish ${topic}`,
    );
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", msg: "event publish failed", topic, err: err instanceof Error ? err.message : String(err) }));
  }
}

export function consume<T = unknown>(topic: Topic, handler: (payload: T) => Promise<void>) {
  const r = redis();
  if (!r) return null;                          // no-op in dev without Redis
  const processor: Processor<T> = async (job) => handler(job.data);
  return new Worker<T>(topic, processor, { connection: r, concurrency: 10 });
}
