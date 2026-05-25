/**
 * Push a realtime "wake-up" signal to a user's browser via Supabase Realtime
 * broadcast (HTTP API — no channel join needed server-side). The client treats
 * it purely as an invalidation hint and refetches notifications through the
 * normal API, so a lost broadcast only means falling back to the next poll.
 *
 * No-op when Supabase isn't configured; errors are swallowed (best-effort).
 */
export async function sendRealtimeNotification(userId: string, payload: Record<string, unknown> = {}): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return;
  try {
    await fetch(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [{ topic: `user:${userId}:notifications`, event: "notification", payload, private: false }],
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* Best-effort: polling remains the source of truth. */
  }
}
