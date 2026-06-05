#!/usr/bin/env node
// readiness-probe.mjs — EXTERNAL (over-the-internet) deployment-readiness probe.
//
// Run from a laptop against the public URL. Unlike loadtest-heavy.mjs (which runs
// ON the VM to bypass the per-IP limiter and measure raw capacity), this measures
// what a REAL USER experiences — TLS + internet RTT to your GCP region — and
// confirms the critical signup→login→use journey works end-to-end from outside.
//
// NOTE: from one IP the gateway rate-limits (300/min general, 5 logins/15min), so
// this can't overload the server — 429s here mean the limiter is doing its job.
// All accounts are tagged lt_<runId>_<n>@loadtest.local; purge with:
//   psql "$DATABASE_URL_DIRECT" -v run_id=<RUN_ID> -f scripts/loadtest-cleanup.sql
//
// Usage:
//   node scripts/readiness-probe.mjs
//   BASE_URL=https://learnrift.site SIGNUPS=60 CONC=10 node scripts/readiness-probe.mjs

const BASE = (process.env.BASE_URL || "https://learnrift.site").replace(/\/$/, "");
const RUN_ID = process.env.RUN_ID || Date.now().toString(36);
const SIGNUPS = Number(process.env.SIGNUPS || 60);
const CONC = Number(process.env.CONC || 10);
const SAMPLES = Number(process.env.SAMPLES || 20); // per public endpoint
const PASSWORD = "Loadtest123!";
const EMAIL = (n) => `lt_${RUN_ID}_${n}@loadtest.local`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0);

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* */ }
    return { status: res.status, ms: performance.now() - t0, json };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, json: null, error: String(e?.name || e) };
  }
}

// bounded-concurrency map
async function pool(items, concurrency, fn) {
  let i = 0; const out = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

function report(label, results) {
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const status = {};
  for (const r of results) { const c = r.status === 0 ? "ERR" : String(r.status); status[c] = (status[c] || 0) + 1; }
  const codes = Object.entries(status).map(([c, n]) => `${c}:${n}`).join(" ");
  console.log(`  ${label.padEnd(34)} n=${String(results.length).padStart(4)}  p50=${pct(lat,50).toFixed(0)}ms p90=${pct(lat,90).toFixed(0)}ms p99=${pct(lat,99).toFixed(0)}ms  ${codes}`);
  return { lat, status };
}

async function main() {
  console.log("================================================================");
  console.log(` LearnRift EXTERNAL readiness probe   run=${RUN_ID}`);
  console.log(` base=${BASE}  signups=${SIGNUPS}  concurrency=${CONC}  samples/endpoint=${SAMPLES}`);
  console.log(` cleanup:  psql "$DATABASE_URL_DIRECT" -v run_id=${RUN_ID} -f scripts/loadtest-cleanup.sql`);
  console.log("================================================================");

  // Grab a real course id for detail/review probes.
  const cat = await req("GET", "/api/search/courses?limit=20");
  const courseId = cat.json?.data?.[0]?.id || null;
  console.log(`\n[A] Public endpoint latency (real-user perspective, ${SAMPLES} samples each, conc 5)`);
  const publicEndpoints = [
    ["search/courses popular", "/api/search/courses?sort=popular&limit=12"],
    ["search/courses q=python", "/api/search/courses?q=python&limit=12"],
    ["search/creators", "/api/search/creators?limit=12"],
    ["search/autocomplete", "/api/search/autocomplete?q=web"],
    ["courses catalog", "/api/courses?page=1&pageSize=20"],
    ["users/settings/public", "/api/users/settings/public"],
    ...(courseId ? [["courses/:id/detail", `/api/courses/${courseId}/detail`], ["courses/:id/reviews", `/api/courses/${courseId}/reviews`]] : []),
  ];
  const publicStats = [];
  for (const [label, path] of publicEndpoints) {
    const results = await pool(Array(SAMPLES).fill(0), 5, () => req("GET", path));
    publicStats.push([label, report(label, results)]);
    await sleep(300); // pace under the 300/min general limit
  }

  // ── Signup storm ──
  console.log(`\n[B] Signup storm — ${SIGNUPS} registrations @ concurrency ${CONC}`);
  const t0 = performance.now();
  const regs = await pool(Array.from({ length: SIGNUPS }, (_, n) => n), CONC, async (n) =>
    req("POST", "/api/auth/register", { body: { email: EMAIL(n), password: PASSWORD, displayName: `Probe ${n}`, intent: "learner" } }));
  const regSecs = (performance.now() - t0) / 1000;
  const regStat = report("auth/register", regs);
  const ok201 = regStat.status["201"] || 0;
  console.log(`  → ${ok201} created in ${regSecs.toFixed(1)}s (${(ok201 / regSecs).toFixed(1)} signups/s before the per-IP limiter)`);

  // ── Critical journey (login is capped at 5/15min per IP, so only a few) ──
  console.log(`\n[C] Critical journey: register→login→/me→/enrollments (up to 4 accounts)`);
  let journeyOk = 0, journeyTotal = 0;
  for (let n = 0; n < Math.min(4, SIGNUPS); n++) {
    journeyTotal++;
    const login = await req("POST", "/api/auth/login", { body: { email: EMAIL(n), password: PASSWORD } });
    const token = login.json?.data?.accessToken;
    if (!token) { console.log(`  acct ${n}: login http=${login.status} ${login.error || ""} — (5/15min login cap?)`); continue; }
    const me = await req("GET", "/api/users/me", { token });
    const enr = await req("GET", "/api/enrollments/", { token });
    const okAll = me.status === 200 && enr.status === 200;
    if (okAll) journeyOk++;
    console.log(`  acct ${n}: login=${login.status}(${login.ms.toFixed(0)}ms) me=${me.status} enrollments=${enr.status} ${okAll ? "✓" : "✗"}`);
  }

  // ── Verdict ──
  console.log("\n================================================================");
  console.log(" READINESS SUMMARY");
  console.log("================================================================");
  const allPublicLat = publicStats.flatMap(([, s]) => s.lat).sort((a, b) => a - b);
  const public5xx = publicStats.reduce((acc, [, s]) => acc + Object.entries(s.status).filter(([c]) => Number(c) >= 500).reduce((a, [, n]) => a + n, 0), 0);
  const reg5xx = Object.entries(regStat.status).filter(([c]) => Number(c) >= 500).reduce((a, [, n]) => a + n, 0);
  const reg429 = regStat.status["429"] || 0;
  console.log(` Public reads:   p50=${pct(allPublicLat,50).toFixed(0)}ms p90=${pct(allPublicLat,90).toFixed(0)}ms p99=${pct(allPublicLat,99).toFixed(0)}ms  5xx=${public5xx}`);
  console.log(` Signups:        ${ok201}/${SIGNUPS} created, ${reg429} rate-limited(429), ${reg5xx} server-error(5xx)`);
  console.log(` Critical path:  ${journeyOk}/${journeyTotal} full journeys OK`);
  console.log("");
  const readsOK = public5xx === 0 && pct(allPublicLat, 99) < 2000;
  const signupsOK = reg5xx === 0 && ok201 > 0;
  const journeyPass = journeyOk > 0;
  const verdict = readsOK && signupsOK && journeyPass;
  console.log(` Reads healthy (no 5xx, p99<2s):        ${readsOK ? "✅" : "❌"}`);
  console.log(` Signups work (no 5xx, some created):   ${signupsOK ? "✅" : "❌"}`);
  console.log(` Critical journey works end-to-end:     ${journeyPass ? "✅" : "❌"}`);
  console.log(` 429s above are the per-IP limiter — expected from one source, and good for prod.`);
  console.log(`\n VERDICT: ${verdict ? "✅ READY (external user experience is healthy)" : "❌ NOT READY — see ❌ above"}`);
  console.log(`\n Remember to purge the ${ok201} test accounts:`);
  console.log(`   psql "$DATABASE_URL_DIRECT" -v run_id=${RUN_ID} -f scripts/loadtest-cleanup.sql`);
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
