import IORedis from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";

let _redis: IORedis | null = null;
const queues = new Map<string, Queue>();

// Exported so the cache helper (and any other module that needs the same
// connection — events + cache should share one client, not open two) can use it.
export function redis(): IORedis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  _redis = new IORedis(url, { maxRetriesPerRequest: null });
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
  await q.add(topic, payload, { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: "exponential", delay: 1000 } });
}

export function consume<T = unknown>(topic: Topic, handler: (payload: T) => Promise<void>) {
  const r = redis();
  if (!r) return null;                          // no-op in dev without Redis
  const processor: Processor<T> = async (job) => handler(job.data);
  return new Worker<T>(topic, processor, { connection: r, concurrency: 10 });
}
