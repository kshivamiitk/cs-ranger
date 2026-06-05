#!/usr/bin/env node
// loadtest-heavy.mjs — realistic, write-heavy ramp load test for LearnRift.
//
// Registers N tagged users, seeds tagged DRAFT/free courses, then ramps a mixed
// read+write workload (catalog/search, course detail, course building, free
// enrollment, progress, quizzes, reviews, comments, subscriptions, plus random
// garbage IDs) at increasing concurrency. Prints per-stage latency percentiles,
// throughput and error breakdown so you can see where one instance knees over.
//
// SAFE-BY-DESIGN:
//   * Every artifact is tagged: emails  lt_<runId>_<n>@loadtest.local
//                               courses "LOADTEST-<runId> ..."
//     so scripts/loadtest-cleanup.sql can purge everything afterward.
//   * Test courses are published only when PUBLISH=1 (needed to exercise the
//     enrollment/quiz/review paths); they are deleted by the cleanup script.
//   * A random X-Forwarded-For per request gives each hit a distinct req.ip, so
//     the gateway's per-IP rate limiter doesn't trip. This ONLY works when
//     hitting the gateway directly (BASE_URL=http://127.0.0.1:4000, i.e. run on
//     the VM); through nginx the header is overwritten.
//
// USAGE (on the VM, in ~/cs-ranger):
//   node scripts/loadtest-heavy.mjs                      # defaults: 500 users
//   USERS=500 STAGES=50,150,300,600 DURATION=30 PUBLISH=1 node scripts/loadtest-heavy.mjs
//   SMOKE=1 node scripts/loadtest-heavy.mjs              # tiny local validation
//
// ENV:
//   BASE_URL   default http://127.0.0.1:4000  (set to https://learnrift.site only for a tiny smoke)
//   USERS      number of accounts to create (default 500)
//   CREATORS   how many of them are creators (default = 20% of USERS)
//   STAGES     comma-separated concurrency tiers (default 50,150,300,600,1000)
//   DURATION   seconds per stage (default 30)
//   PUBLISH    1 = publish seeded free courses so enroll/quiz/review run (default 1)
//   SEED_COURSES  how many test courses to seed (default = CREATORS, capped 40)
//   RUN_ID     tag for this run (default: timestamp-based)
//   SMOKE      1 = tiny preset (3 users, 2 short stages, no publish) for validation

const BASE = (process.env.BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const SMOKE = process.env.SMOKE === "1";
const RUN_ID = process.env.RUN_ID || `${Date.now().toString(36)}`;
const USERS = SMOKE ? 3 : Number(process.env.USERS || 500);
const CREATORS = SMOKE ? 1 : Number(process.env.CREATORS || Math.max(1, Math.round(USERS * 0.2)));
const STAGES = (SMOKE ? "2,4" : process.env.STAGES || "50,150,300,600,1000").split(",").map((s) => Number(s.trim())).filter(Boolean);
const DURATION = (SMOKE ? 5 : Number(process.env.DURATION || 30)) * 1000;
const PUBLISH = SMOKE ? false : process.env.PUBLISH !== "0";
const SEED_COURSES = SMOKE ? 1 : Math.min(40, Number(process.env.SEED_COURSES || CREATORS));
const PASSWORD = "Loadtest123!"; // satisfies upper/lower/digit, >=8
const REQ_TIMEOUT_MS = 30000;
// Registration/login are bcrypt(cost 12) + several serial Supabase round-trips
// (~1s each), and bcrypt is CPU-bound, so high concurrency just makes each one
// slower and times them all out. Pace the setup phase deliberately low.
const SETUP_CONCURRENCY = SMOKE ? 3 : Number(process.env.SETUP_CONCURRENCY || 8);

const EMAIL = (n) => `lt_${RUN_ID}_${n}@loadtest.local`;
const COURSE_TITLE = (n) => `LOADTEST-${RUN_ID} Course ${n}`;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const randIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- HTTP + metrics ---------------------------------------------------------
let metrics = newMetrics();
function newMetrics() { return { byLabel: new Map(), latencies: [] }; }
function record(label, status, ms, networkErr) {
  let m = metrics.byLabel.get(label);
  if (!m) { m = { n: 0, err: 0, status: {} }; metrics.byLabel.set(label, m); }
  m.n++;
  const code = networkErr ? "ERR" : String(status);
  m.status[code] = (m.status[code] || 0) + 1;
  if (networkErr || status >= 500 || status === 429) m.err++;
  metrics.latencies.push(ms);
}

async function req(label, method, path, { token, body } = {}) {
  const headers = { "x-forwarded-for": randIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const t0 = performance.now();
  const ctrl = AbortSignal.timeout(REQ_TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl });
    const ms = performance.now() - t0;
    // Drain body so the socket frees promptly; ignore content for most calls.
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    record(label, res.status, ms, false);
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    record(label, 0, performance.now() - t0, true);
    return { status: 0, ok: false, json: null, error: String(e?.name || e) };
  }
}

function pct(sorted, p) { if (!sorted.length) return 0; return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }
function summarize(tag, wallMs) {
  const lat = metrics.latencies.slice().sort((a, b) => a - b);
  let total = 0, err = 0;
  for (const m of metrics.byLabel.values()) { total += m.n; err += m.err; }
  const rps = total / (wallMs / 1000);
  console.log(`\n── ${tag} ─────────────────────────────────────────────`);
  console.log(`  requests: ${total}   errors(5xx/429/net): ${err} (${((err / Math.max(1, total)) * 100).toFixed(1)}%)   throughput: ${rps.toFixed(0)} req/s`);
  console.log(`  latency ms  p50=${pct(lat, 50).toFixed(0)}  p90=${pct(lat, 90).toFixed(0)}  p99=${pct(lat, 99).toFixed(0)}  max=${(lat[lat.length - 1] || 0).toFixed(0)}`);
  const rows = [...metrics.byLabel.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [label, m] of rows) {
    const codes = Object.entries(m.status).map(([c, n]) => `${c}:${n}`).join(" ");
    console.log(`    ${label.padEnd(26)} n=${String(m.n).padStart(7)}  ${codes}`);
  }
}

// ---- bounded-concurrency pool ----------------------------------------------
async function pool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

// ---- setup: users -----------------------------------------------------------
const users = []; // { email, token, userId, roles, isCreator }
async function setupUsers() {
  console.log(`\n[setup] registering ${USERS} users (${CREATORS} creators) @ ${BASE}, concurrency=${SETUP_CONCURRENCY} …`);
  console.log(`[setup] each register+login is ~1-2s (bcrypt + Supabase), so this paces low and may take a couple of minutes.`);
  const idxs = Array.from({ length: USERS }, (_, n) => n);
  let ok = 0, fail = 0, sample = "";
  await pool(idxs, SETUP_CONCURRENCY, async (n) => {
    const isCreator = n < CREATORS;
    const intent = isCreator ? rnd(["creator", "both"]) : "learner";
    const email = EMAIL(n);
    const reg = await req("auth/register", "POST", "/api/auth/register", {
      body: { email, password: PASSWORD, displayName: `LoadTest User ${n}`, intent },
    });
    if (reg.status !== 201 && reg.status !== 200 && reg.status !== 409) {
      fail++;
      if (!sample) sample = `register http=${reg.status} ${reg.error || (reg.json && JSON.stringify(reg.json).slice(0, 140)) || ""}`;
      if ((ok + fail) % 50 === 0) console.log(`[setup]  progress: ${ok} ok / ${fail} fail`);
      return;
    }
    const login = await req("auth/login", "POST", "/api/auth/login", { body: { email, password: PASSWORD } });
    const token = login.json?.data?.accessToken;
    const userId = login.json?.data?.user?.id;
    const roles = login.json?.data?.user?.roles || [intent];
    if (token && userId) { users.push({ email, token, userId, roles, isCreator }); ok++; }
    else { fail++; if (!sample) sample = `login http=${login.status} ${login.error || (login.json && JSON.stringify(login.json).slice(0, 140)) || ""}`; }
    if ((ok + fail) % 50 === 0) console.log(`[setup]  progress: ${ok} ok / ${fail} fail`);
  });
  console.log(`[setup] users ready: ${ok}  failed: ${fail}${sample ? `  (first failure: ${sample})` : ""}`);
}

// ---- setup: seed courses ----------------------------------------------------
const courses = []; // { id, nodeIds:[], quizNodeId, free:true, published }
async function seedCourses() {
  const creators = users.filter((u) => u.isCreator);
  if (!creators.length) { console.log("[setup] no creators — skipping course seed"); return; }
  console.log(`[setup] seeding ${SEED_COURSES} tagged free courses (publish=${PUBLISH}) …`);
  const idxs = Array.from({ length: SEED_COURSES }, (_, n) => n);
  await pool(idxs, SETUP_CONCURRENCY, async (n) => {
    const u = creators[n % creators.length];
    if (PUBLISH) await req("users/accept-terms", "POST", "/api/users/me/accept-creator-terms", { token: u.token, body: { termsVersion: "2026-05-01", commissionRate: 0.15 } });
    const c = await req("courses/create", "POST", "/api/courses", {
      token: u.token,
      body: { title: COURSE_TITLE(n), subtitle: "load test", price: 0, level: "All Levels", language: "English", certificate_enabled: true },
    });
    const courseId = c.json?.data?.id;
    if (!courseId) return;
    const mod = await req("courses/module", "POST", `/api/courses/${courseId}/modules`, { token: u.token, body: { title: "Module 1" } });
    const moduleId = mod.json?.data?.id;
    if (!moduleId) { courses.push({ id: courseId, ownerToken: u.token, nodeIds: [], published: false }); return; }
    const nodeIds = [];
    // a markdown lesson
    const md = await req("courses/node", "POST", "/api/courses/nodes", { token: u.token, body: { moduleId, type: "markdown", title: "Lesson 1", markdown: "# hello\nload test content", is_free_preview: true } });
    if (md.json?.data?.id) nodeIds.push(md.json.data.id);
    // a quiz lesson
    const quiz = await req("courses/node", "POST", "/api/courses/nodes", {
      token: u.token,
      body: {
        moduleId, type: "quiz", title: "Quiz 1",
        quiz_payload: { passingPercent: 50, questions: [
          { id: "q1", prompt: "2+2?", options: ["3", "4", "5", "6"], correctIndex: 1, explanation: "math" },
          { id: "q2", prompt: "Sky color?", options: ["green", "blue", "red", "black"], correctIndex: 1 },
        ] },
      },
    });
    const quizNodeId = quiz.json?.data?.id;
    if (quizNodeId) nodeIds.push(quizNodeId);
    let published = false;
    if (PUBLISH) {
      const pub = await req("courses/publish", "POST", `/api/courses/${courseId}/publish`, { token: u.token });
      published = pub.ok;
    }
    courses.push({ id: courseId, ownerToken: u.token, nodeIds, quizNodeId, published });
  });
  const pubCount = courses.filter((c) => c.published).length;
  console.log(`[setup] courses created: ${courses.length}  published: ${pubCount}`);
}

// ---- workload actions -------------------------------------------------------
const randomTerms = ["js", "python", "design", "data", "web", "ai", "react", "sql", "math", "x9z"];
const learnerActions = [
  // reads (weighted by repetition)
  async (u) => req("search/courses", "GET", `/api/search/courses?sort=${rnd(["popular", "newest", "rating"])}&limit=12`),
  async (u) => req("search/courses", "GET", `/api/search/courses?q=${rnd(randomTerms)}&limit=12`),
  async (u) => req("search/creators", "GET", `/api/search/creators?limit=12`),
  async (u) => req("search/autocomplete", "GET", `/api/search/autocomplete?q=${rnd(randomTerms)}`),
  async (u) => req("courses/catalog", "GET", `/api/courses?page=1&pageSize=20`),
  async (u) => req("courses/detail", "GET", `/api/courses/${rnd(courses)?.id || crypto.randomUUID()}/detail`),
  async (u) => req("courses/full", "GET", `/api/courses/${rnd(courses)?.id || crypto.randomUUID()}`, { token: u.token }),
  async (u) => req("users/me", "GET", "/api/users/me", { token: u.token }),
  async (u) => req("users/public-settings", "GET", "/api/users/settings/public"),
  async (u) => req("enrollments/list", "GET", "/api/enrollments/", { token: u.token }),
  async (u) => req("notifications/list", "GET", "/api/notifications/?page=1", { token: u.token }),
  async (u) => req("achievements/summary", "GET", `/api/achievements/${u.userId}/summary`, { token: u.token }),
  // "random api" garbage — exercises 404/validation paths
  async (u) => req("garbage/course", "GET", `/api/courses/${crypto.randomUUID()}/detail`),
  async (u) => req("garbage/payment", "GET", `/api/payments/${crypto.randomUUID()}`, { token: u.token }),
  // writes
  async (u) => { const c = rnd(courses.filter((x) => x.published)); if (c) return req("enroll/free", "POST", "/api/enrollments/", { token: u.token, body: { courseId: c.id } }); },
  async (u) => { const c = rnd(courses.filter((x) => x.published)); const nid = c && rnd(c.nodeIds); if (nid) return req("progress", "POST", `/api/enrollments/progress/${nid}`, { token: u.token, body: { scrollPercent: 100, markDone: true } }); },
  async (u) => { const c = rnd(courses.filter((x) => x.published && x.quizNodeId)); if (c) return req("quiz/attempt", "POST", `/api/enrollments/quiz/${c.quizNodeId}/attempt`, { token: u.token, body: { answers: [{ questionId: "q1", pickedIndex: 1 }, { questionId: "q2", pickedIndex: 1 }] } }); },
  async (u) => { const c = rnd(courses.filter((x) => x.published)); if (c) return req("review", "POST", `/api/courses/${c.id}/reviews`, { token: u.token, body: { rating: 1 + ((Math.random() * 5) | 0), body: "load test review" } }); },
  async (u) => { const c = rnd(courses); const nid = c && rnd(c.nodeIds); if (nid) return req("comment", "POST", `/api/courses/nodes/${nid}/comments`, { token: u.token, body: { body: "load test comment", kind: rnd(["comment", "doubt"]) } }); },
  async (u) => { const c = rnd(courses); if (c) return req("bookmark", "POST", "/api/courses/bookmarks", { token: u.token, body: { courseId: c.id } }); },
  async (u) => { const cr = rnd(users.filter((x) => x.isCreator)); if (cr && cr.userId !== u.userId) return req("subscribe", "POST", `/api/users/${cr.userId}/subscribe`, { token: u.token }); },
];
const creatorActions = [
  async (u) => req("courses/mine", "GET", "/api/courses/mine", { token: u.token }),
  async (u) => req("doubts/inbox", "GET", "/api/courses/doubts/inbox?page=1", { token: u.token }),
  async (u) => { // build a fresh draft course (no publish) — heavy write path
    const c = await req("courses/create", "POST", "/api/courses", { token: u.token, body: { title: COURSE_TITLE("d" + ((Math.random() * 1e6) | 0)), price: 0, level: "Beginner", language: "English" } });
    const id = c.json?.data?.id; if (!id) return;
    const m = await req("courses/module", "POST", `/api/courses/${id}/modules`, { token: u.token, body: { title: "M" } });
    const mid = m.json?.data?.id; if (mid) await req("courses/node", "POST", "/api/courses/nodes", { token: u.token, body: { moduleId: mid, type: "markdown", title: "L", markdown: "x" } });
  },
];

async function pickAction(u) {
  // 1-in-6 creator-specific action for creators; otherwise the learner mix.
  if (u.isCreator && Math.random() < 0.35) return rnd(creatorActions)(u);
  return rnd(learnerActions)(u);
}

// ---- ramp -------------------------------------------------------------------
async function runStage(concurrency) {
  metrics = newMetrics();
  const stop = Date.now() + DURATION;
  let active = true;
  const worker = async () => {
    while (active && Date.now() < stop) {
      const u = rnd(users);
      try { await pickAction(u); } catch { /* counted as network err inside req */ }
    }
  };
  const t0 = performance.now();
  // Health snapshot at stage start
  const h = await req("_health", "GET", "/health");
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.race([Promise.all(workers), sleep(DURATION + 5000).then(() => { active = false; })]);
  active = false;
  await Promise.allSettled(workers);
  summarize(`STAGE ${concurrency} concurrent · ${DURATION / 1000}s`, performance.now() - t0);
  const gw = h.json?.data;
  if (gw) {
    const down = (gw.services || []).filter((s) => s.status !== "ok").map((s) => s.name);
    console.log(`  gateway@start: ${gw.gateway}  services_down: ${down.length ? down.join(",") : "none"}`);
  }
}

async function main() {
  console.log("================================================================");
  console.log(` LearnRift HEAVY load test   run=${RUN_ID}`);
  console.log(` base=${BASE}  users=${USERS}  creators=${CREATORS}  stages=[${STAGES}]  ${DURATION / 1000}s/stage  publish=${PUBLISH}`);
  console.log(` cleanup afterwards:  psql "$DATABASE_URL" -v run_id=${RUN_ID} -f scripts/loadtest-cleanup.sql`);
  console.log("================================================================");
  await setupUsers();
  if (!users.length) { console.error("No users could be created — aborting (is the gateway up / rate-limited?)."); process.exit(1); }
  await seedCourses();
  for (const c of STAGES) { await runStage(c); await sleep(1000); }
  console.log("\n[done] Remember to run the cleanup so the test data doesn't linger in prod:");
  console.log(`  psql "$DATABASE_URL" -v run_id=${RUN_ID} -f scripts/loadtest-cleanup.sql`);
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
