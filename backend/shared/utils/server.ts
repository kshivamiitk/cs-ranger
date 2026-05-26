import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { attachUser } from "../middleware/auth.js";
import { makeLogger } from "./logger.js";
import { AppError } from "./errors.js";
import { createMetricsStore, checkConnectivity } from "../observability.js";

export function createService(name: string): { app: Express; log: ReturnType<typeof makeLogger>; listen: (port: number) => void } {
  const app = express();
  const log = makeLogger(name);
  const metrics = createMetricsStore();
  // `verify` runs during JSON parse and gives us the original bytes — needed
  // for HMAC-signed webhooks (Razorpay) whose signatures are computed over the
  // raw request body. Otherwise express.json consumes the buffer and the
  // webhook handler only sees the parsed object, breaking signature checks.
  app.use(express.json({
    limit: "2mb",
    verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; },
  }));
  app.use(attachUser);
  // Per-service request timing. Logs the in-service handler duration so a slow
  // endpoint can be isolated from gateway/proxy overhead. No bodies/PII are logged
  // (path excludes the query string; bodies/headers/tokens are never logged).
  // The same finish hook feeds the in-memory metrics counters served by /metrics.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const method = req.method;
    const path = req.path;
    const requestId = req.header("x-request-id");
    (req as Request & { startTime: number }).startTime = Date.now();
    if (path === "/health" || path === "/metrics" || path === "/health/details") return next(); // skip probe/scrape spam
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      metrics.record(res.statusCode, durationMs);
      log.info("request", {
        method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        requestId,
        slow: durationMs > 200 || undefined,
      });
    });
    next();
  });

  app.get("/health", (_req, res) => res.json({ success: true, data: { service: name, status: "ok", uptimeSeconds: Math.floor(process.uptime()) } }));

  // Counters since process start — request totals, 4xx/5xx, latency buckets.
  app.get("/metrics", (_req, res) => res.json({ success: true, data: { service: name, ...metrics.snapshot() } }));

  // Health + dependency connectivity (Supabase/Redis booleans and latency only —
  // never URLs or keys) + the metrics snapshot. Aggregated by the gateway's /api/ops.
  app.get("/health/details", async (_req, res) => {
    const connectivity = await checkConnectivity();
    const degraded =
      (connectivity.supabase.configured && connectivity.supabase.ok === false) ||
      (connectivity.redis.configured && connectivity.redis.ok === false);
    res.json({
      success: true,
      data: {
        service: name,
        status: degraded ? "degraded" : "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        connectivity,
        metrics: metrics.snapshot(),
      },
    });
  });

  function listen(port: number) {
    // 404
    app.use((req, res) => res.status(404).json({ success: false, error: { message: `Not found: ${req.method} ${req.path}`, code: "NOT_FOUND" } }));
    // Error handler
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AppError) {
        res.status(err.status).json({ success: false, error: { message: err.message, code: err.code } });
      } else {
        const msg = err instanceof Error ? err.message : "Internal server error";
        log.error("unhandled error", { err: msg });
        res.status(500).json({ success: false, error: { message: msg, code: "INTERNAL" } });
      }
    });
    app.listen(port, () => log.info(`${name} listening on :${port}`));
  }

  return { app, log, listen };
}
