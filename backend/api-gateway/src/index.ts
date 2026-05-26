import express from "express";
import http from "node:http";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import jwt from "jsonwebtoken";
import { makeLogger } from "@cs-ranger/shared";

const log = makeLogger("api-gateway");
const app = express();
app.set("trust proxy", 1);

// Shared HTTP keep-alive Agent for ALL proxy hops. Default http.Agent is
// keepAlive:false → every proxied request opens a fresh TCP socket to the
// downstream service. That dominated p50 latency at 250+ concurrent in
// load tests (818ms p50 with default, ~150ms with keep-alive). maxSockets
// caps fan-out so one busy service can't starve the others.
const upstreamAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

// Raise EventEmitter limit so http-proxy-middleware's per-request close
// listeners stop spamming "MaxListenersExceededWarning" under sustained load.
process.setMaxListeners(50);
const PORT = Number(process.env.PORT_GATEWAY || 4000);
const FRONTEND = process.env.FRONTEND_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-replace-me";

const SERVICES: Record<string, number> = {
  auth: 4001, users: 4002, courses: 4003, enrollments: 4004,
  search: 4005, payments: 4006, wallet: 4007, payouts: 4008,
  notifications: 4009, support: 4010, achievements: 4011, analytics: 4012,
};

app.use(cors({ origin: FRONTEND, credentials: true, exposedHeaders: ["x-request-id"] }));

// Per-IP rate limit (300 req/min/IP for general, 5/15min for login)
const buckets = new Map<string, { count: number; resetAt: number }>();
const loginBuckets = new Map<string, { count: number; resetAt: number }>();
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const isLogin = req.path.startsWith("/api/auth/login");
  const bucket = isLogin ? loginBuckets : buckets;
  const limit = isLogin ? 5 : 300;
  const window = isLogin ? 15 * 60_000 : 60_000;
  const b = bucket.get(key);
  if (!b || b.resetAt < now) { bucket.set(key, { count: 1, resetAt: now + window }); return next(); }
  if (b.count >= limit) return res.status(429).json({ success: false, error: { message: "Too many requests", code: "RATE_LIMIT" } });
  b.count++;
  next();
});

// Correlation ID
app.use((req, res, next) => {
  const id = req.header("x-request-id") || crypto.randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("x-request-id", id);
  next();
});

// Request timing — logs method, path (no query string), status, durationMs, requestId.
// Deliberately omits bodies, tokens, headers and query params to avoid leaking PII/secrets.
// Path is captured up-front because http-proxy-middleware rewrites req.url before
// `finish` fires; req.path already excludes the query string.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const method = req.method;
  const path = req.path;
  if (path === "/health") return next(); // skip load-balancer/liveness probe spam
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    log.info("request", {
      method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      requestId: req.headers["x-request-id"],
      userId: req.headers["x-user-id"],
      slow: durationMs > 500 || undefined,
    });
  });
  next();
});

// JWT decode → set x-user-* headers for downstream services
app.use("/api", (req, _res, next) => {
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return next();
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; role?: string; roles?: string[] };
    if (decoded.sub) req.headers["x-user-id"] = decoded.sub;
    if (decoded.role) req.headers["x-user-role"] = decoded.role;
    if (Array.isArray(decoded.roles) && decoded.roles.length) req.headers["x-user-roles"] = decoded.roles.join(",");
  } catch {
    // Invalid token — let downstream return 401 if needed
  }
  next();
});

app.get("/health", async (_req, res) => {
  const results = await Promise.all(
    Object.entries(SERVICES).map(async ([name, port]) => {
      try {
        const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
        const j = await r.json() as { data?: { status?: string } };
        return { name, port, status: j.data?.status || "unknown" };
      } catch {
        return { name, port, status: "down" };
      }
    })
  );
  res.json({ success: true, data: { gateway: "ok", services: results } });
});

// Admin-only ops aggregate: every service's /health/details (status, dependency
// connectivity booleans, request/error/latency counters) in one payload for the
// /admin/ops dashboard. The JWT was already decoded into x-user-* headers above;
// the payload contains no URLs, hostnames or keys.
app.get("/api/ops", async (req, res) => {
  const roles = String(req.headers["x-user-roles"] || req.headers["x-user-role"] || "").split(",").map((r) => r.trim());
  if (!roles.includes("admin")) {
    return res.status(403).json({ success: false, error: { message: "Forbidden", code: "FORBIDDEN" } });
  }
  const services = await Promise.all(
    Object.entries(SERVICES).map(async ([name, port]) => {
      try {
        const r = await fetch(`http://localhost:${port}/health/details`, { signal: AbortSignal.timeout(2500) });
        const j = await r.json() as { data?: Record<string, unknown> };
        return { name, port, reachable: true, ...(j.data || {}) };
      } catch {
        return { name, port, reachable: false, status: "down" as const };
      }
    })
  );
  res.json({
    success: true,
    data: {
      gateway: { status: "ok", uptimeSeconds: Math.floor(process.uptime()) },
      services,
      generatedAt: new Date().toISOString(),
    },
  });
});

// Proxy routing
for (const [prefix, port] of Object.entries(SERVICES)) {
  app.use(`/api/${prefix}`, createProxyMiddleware({
    target: `http://localhost:${port}`,
    changeOrigin: true,
    pathRewrite: { [`^/api/${prefix}`]: "" },
    // Reuse one keep-alive Agent across all backend hops. Without this the
    // gateway opens a brand-new TCP socket per request — fine in dev, but
    // load-tests showed it dominates p50 latency at 250c+. See the Agent
    // declaration at the top of this file for the cap values.
    agent: upstreamAgent,
    // Critical: don't parse the body — let downstream handle raw for webhooks
  }));
}

app.listen(PORT, () => log.info(`api-gateway listening on :${PORT}`));
