#!/usr/bin/env node
// readstorm.mjs — "N people jump onto the platform and call random APIs."
//
// Models a browse/discovery traffic spike: anonymous users hammering the public
// read + random endpoints (catalog, search, course detail, reviews, comments,
// creators, autocomplete, plus random/garbage IDs). NO account setup — so it
// spins up instantly and isolates READ capacity (the real-world hot path), as
// opposed to loadtest-heavy.mjs which is write-heavy.
//
// MUST run ON THE VM against the gateway directly (rotated X-Forwarded-For per
// request gives each hit a distinct req.ip so the per-IP rate limiter doesn't
// trip — that only works hitting 127.0.0.1:4000, not through nginx).
//
//   ulimit -n 65535                                   # avoid loopback FD exhaustion
//   CONC=500 DURATION=30 node scripts/readstorm.mjs
//   STAGES=100,300,500,800 DURATION=20 node scripts/readstorm.mjs

const BASE = (process.env.BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const STAGES = (process.env.STAGES || `${process.env.CONC || 500}`).split(",").map((s) => Number(s.trim())).filter(Boolean);
const DURATION = Number(process.env.DURATION || 30) * 1000;

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const randIp = () => `10.${(Math.random()*255)|0}.${(Math.random()*255)|0}.${(Math.random()*255)|0}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pctl = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0);

let M;
const fresh = () => ({ byLabel: new Map(), lat: [] });
function rec(label, status, ms, netErr) {
  let m = M.byLabel.get(label); if (!m) { m = { n: 0, err: 0, st: {} }; M.byLabel.set(label, m); }
  m.n++; const c = netErr ? "ERR" : String(status); m.st[c] = (m.st[c] || 0) + 1;
  if (netErr || status >= 500 || status === 429) m.err++;
  M.lat.push(ms);
}
async function req(label, path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { headers: { "x-forwarded-for": randIp() }, signal: AbortSignal.timeout(20000) });
    await res.text();
    rec(label, res.status, performance.now() - t0, false);
  } catch { rec(label, 0, performance.now() - t0, true); }
}

const TERMS = ["js", "python", "web", "data", "ai", "react", "sql", "design", "math", "xyzzy"];
let COURSE_IDS = [], NODE_IDS = [], USERNAMES = [];

// Weighted browse mix — what a real visitor actually hits.
const actions = [
  () => req("search/courses", `/api/search/courses?sort=${rnd(["popular","newest","rating"])}&limit=12`),
  () => req("search/courses", `/api/search/courses?q=${rnd(TERMS)}&limit=12`),
  () => req("catalog", `/api/courses?page=${1 + ((Math.random()*3)|0)}&pageSize=20`),
  () => req("course/detail", `/api/courses/${rnd(COURSE_IDS) || crypto.randomUUID()}/detail`),
  () => req("course/reviews", `/api/courses/${rnd(COURSE_IDS) || crypto.randomUUID()}/reviews`),
  () => req("node/comments", `/api/courses/nodes/${rnd(NODE_IDS) || crypto.randomUUID()}/comments`),
  () => req("search/creators", `/api/search/creators?limit=12`),
  () => req("search/autocomplete", `/api/search/autocomplete?q=${rnd(TERMS)}`),
  () => req("by-username", `/api/users/by-username/${rnd(USERNAMES) || "nobody" + ((Math.random()*1e6)|0)}`),
  () => req("settings/public", `/api/users/settings/public`),
  () => req("garbage/detail", `/api/courses/${crypto.randomUUID()}/detail`),
  () => req("garbage/username", `/api/users/by-username/zzz${(Math.random()*1e6)|0}`),
];

async function warm() {
  // Pull real ids so detail/reviews/comments hit real rows, not just 404s.
  try {
    const c = await (await fetch(BASE + "/api/search/courses?limit=30", { headers: { "x-forwarded-for": randIp() } })).json();
    COURSE_IDS = (c?.data || []).map((x) => x.id).filter(Boolean);
  } catch { /* */ }
  try {
    const cr = await (await fetch(BASE + "/api/search/creators?limit=20", { headers: { "x-forwarded-for": randIp() } })).json();
    USERNAMES = (cr?.data || []).map((x) => x.username).filter(Boolean);
  } catch { /* */ }
  if (COURSE_IDS.length) {
    try {
      const d = await (await fetch(BASE + `/api/courses/${COURSE_IDS[0]}/detail`, { headers: { "x-forwarded-for": randIp() } })).json();
      for (const m of d?.data?.course?.modules || []) for (const n of m.nodes || []) if (n.id) NODE_IDS.push(n.id);
    } catch { /* */ }
  }
  console.log(`[warm] real ids — courses:${COURSE_IDS.length} usernames:${USERNAMES.length} nodes:${NODE_IDS.length}`);
}

async function stage(conc) {
  M = fresh();
  const h = await (await fetch(BASE + "/health", { headers: { "x-forwarded-for": randIp() } }).then((r) => r.json()).catch(() => null));
  const stop = Date.now() + DURATION; let active = true;
  const worker = async () => { while (active && Date.now() < stop) { try { await rnd(actions)(); } catch { /* */ } } };
  const t0 = performance.now();
  const ws = Array.from({ length: conc }, () => worker());
  await Promise.race([Promise.all(ws), sleep(DURATION + 5000).then(() => (active = false))]);
  active = false; await Promise.allSettled(ws);
  const wall = (performance.now() - t0) / 1000;
  const lat = M.lat.slice().sort((a, b) => a - b);
  let total = 0, err = 0; for (const m of M.byLabel.values()) { total += m.n; err += m.err; }
  console.log(`\n── ${conc} concurrent · ${DURATION/1000}s ───────────────────────────────`);
  console.log(`  requests=${total}  errors(5xx/429/net)=${err} (${(err/Math.max(1,total)*100).toFixed(1)}%)  throughput=${(total/wall).toFixed(0)} req/s`);
  console.log(`  latency  p50=${pctl(lat,50).toFixed(0)}ms  p90=${pctl(lat,90).toFixed(0)}ms  p99=${pctl(lat,99).toFixed(0)}ms  max=${(lat[lat.length-1]||0).toFixed(0)}ms`);
  for (const [label, m] of [...M.byLabel.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${label.padEnd(20)} n=${String(m.n).padStart(6)}  ${Object.entries(m.st).map(([c, n]) => `${c}:${n}`).join(" ")}`);
  }
  if (h?.data) { const down = (h.data.services||[]).filter((s)=>s.status!=="ok").map((s)=>s.name); console.log(`  gateway@start=${h.data.gateway} services_down=${down.length?down.join(","):"none"}`); }
}

async function main() {
  console.log("================================================================");
  console.log(` LearnRift READ-STORM (browse spike)   base=${BASE}`);
  console.log(` stages=[${STAGES}]  ${DURATION/1000}s/stage`);
  console.log("================================================================");
  await warm();
  for (const c of STAGES) { await stage(c); await sleep(1000); }
  console.log("\n[done] no accounts created — nothing to clean up.");
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
