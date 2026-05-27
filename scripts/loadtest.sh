#!/usr/bin/env bash
#
# loadtest.sh — ramped load test against the production LearnRift box,
# with server-side metrics captured in parallel. Outputs a single timestamped
# log file you can attach to bug reports or compare across deploys.
#
# Defaults: ramp = 50 → 250 → 500 → 1000 concurrent, 30s per stage, target
# /api/search/courses?sort=popular&limit=8 (the home-page call). The loadgen
# runs ON the EC2 box (so we measure the actual server, not the home internet
# RTT) and rotates X-Forwarded-For per request so the gateway's per-IP rate
# limiter doesn't trip.
#
# Usage:
#   scripts/loadtest.sh
#   scripts/loadtest.sh --stages "10,50,200" --duration 20 --path "/api/search/creators?limit=8"
#   PEM=~/path/to/key.pem HOST=ubuntu@1.2.3.4 scripts/loadtest.sh
#
# Env / flags:
#   PEM        path to the EC2 SSH key (default: ~/Downloads/cs-ranger-prod-1.pem)
#   HOST       user@ip of the box (default: ubuntu@15.207.10.3)
#   --stages   comma-separated concurrency tiers (default: 50,250,500,1000)
#   --duration seconds per stage (default: 30)
#   --path     URL path to hit (default: /api/search/courses?sort=popular&limit=8)
#   --out      output log path (default: load_<UTC-timestamp>.log in cwd)
#
set -euo pipefail

PEM="${PEM:-$HOME/Downloads/cs-ranger-prod-1.pem}"
HOST="${HOST:-ubuntu@15.207.10.3}"
STAGES="50,250,500,1000"
DURATION=30
TARGET_PATH="/api/search/courses?sort=popular&limit=8"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stages) STAGES="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --path) TARGET_PATH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; /^set -euo/d'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OUT" ]]; then OUT="load_$(date -u +%Y%m%dT%H%M%SZ).log"; fi
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

# Both stdout AND the log file get every line.
exec > >(tee -a "$OUT") 2>&1

echo "================================================================"
echo " LearnRift ramp load test"
echo " started:  $(date -u +%FT%TZ)"
echo " host:     $HOST"
echo " path:     $TARGET_PATH"
echo " stages:   $STAGES"
echo " duration: ${DURATION}s per stage"
echo " out:      $OUT"
echo "================================================================"

[[ -f "$PEM" ]] || { echo "✗ PEM not found at $PEM"; exit 1; }

SSH="ssh -i $PEM -o BatchMode=yes -o ConnectTimeout=15"

# --- 1. Upload the loadgen.mjs (Node, rotates X-Forwarded-For, no deps) ----
echo
echo "[setup] uploading loadgen.mjs to /tmp/loadgen.mjs"
$SSH "$HOST" "cat > /tmp/loadgen.mjs" <<'NODE_SCRIPT'
import http from "node:http";
import { performance } from "node:perf_hooks";

const concurrency = parseInt(process.env.C || "50");
const durationSec = parseInt(process.env.D || "30");
const target = process.env.URL || "/api/search/courses?sort=popular&limit=8";
const stats = { sent: 0, status: {}, latencies: [], errors: 0 };
const stopAt = performance.now() + durationSec * 1000;
const fakeIp = (i) => `10.${(i*17)%200+1}.${(i*53)%200+1}.${Math.floor(Math.random()*254)+1}`;

function once(slot) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const req = http.request({
      host: "127.0.0.1", port: 4000, path: target, method: "GET",
      headers: { "x-forwarded-for": fakeIp(slot), "accept": "application/json" },
    }, (res) => {
      res.on("data", () => {});
      res.on("end", () => {
        stats.sent++;
        stats.status[res.statusCode] = (stats.status[res.statusCode] || 0) + 1;
        stats.latencies.push(performance.now() - t0);
        resolve();
      });
    });
    req.on("error", () => { stats.errors++; resolve(); });
    req.end();
  });
}
async function worker(slot) { while (performance.now() < stopAt) await once(slot); }

const t0 = performance.now();
await Promise.all(Array.from({length: concurrency}, (_, i) => worker(i)));
const totalSec = (performance.now() - t0) / 1000;
stats.latencies.sort((a, b) => a - b);
const pct = (p) => stats.latencies[Math.floor(stats.latencies.length * p)] || 0;
console.log(JSON.stringify({
  total_requests: stats.sent,
  errors: stats.errors,
  rps: Math.round(stats.sent / totalSec),
  status: stats.status,
  latency_ms: {
    p50: Math.round(pct(0.5)),
    p95: Math.round(pct(0.95)),
    p99: Math.round(pct(0.99)),
    max: Math.round(stats.latencies.at(-1) || 0),
  },
  duration_s: Math.round(totalSec),
}, null, 2));
NODE_SCRIPT

# --- 2. Capture BASELINE ---------------------------------------------------
echo
echo "[baseline] server state before any load"
$SSH "$HOST" 'echo "--- load avg + uptime ---"; uptime
echo "--- memory ---"; free -h | head -3
echo "--- gateway /health ---"; curl -sS -m 3 http://127.0.0.1:4000/health | head -c 700; echo
echo "--- pm2 restart counts ---"; pm2 list 2>&1 | awk -F"│" "NR>2 && \$3 ~ /cs-/ { gsub(/ /,\"\",\$3); gsub(/ /,\"\",\$9); printf \"%-26s restarts=%s\\n\", \$3, \$9 }"'

# --- 3. Ramp stages --------------------------------------------------------
IFS=',' read -ra STAGE_ARR <<< "$STAGES"
for C in "${STAGE_ARR[@]}"; do
  C="${C// /}"
  echo
  echo "================================================================"
  echo " STAGE: $C concurrent users / ${DURATION}s"
  echo "================================================================"

  # parallel monitor that samples every 3s
  $SSH "$HOST" "for i in \$(seq 1 $((DURATION/3))); do printf '[t+%2ds]  ' \"\$((i*3))\"; uptime | sed 's/.*load average:/load=/'; sleep 3; done" &
  MON_PID=$!

  $SSH "$HOST" "C=$C D=$DURATION URL='$TARGET_PATH' node /tmp/loadgen.mjs"
  RC=$?

  wait $MON_PID 2>/dev/null || true

  echo
  echo "[post-$C] system state"
  $SSH "$HOST" 'free -h | head -2
pm2 list 2>&1 | awk -F"│" "NR>2 && \$3 ~ /cs-(api-gateway|search|frontend|course)/ { gsub(/ /,\"\",\$3); gsub(/ /,\"\",\$8); gsub(/ /,\"\",\$9); gsub(/ /,\"\",\$11); printf \"%-26s up=%-6s restarts=%-3s mem=%s\\n\", \$3, \$8, \$9, \$11 }"'

  echo
  echo "[post-$C] recent slow requests at gateway (durationMs > 1000)"
  $SSH "$HOST" 'pm2 logs cs-api-gateway --out --lines 200 --nostream 2>&1 | grep "slow.:true" | tail -5 || echo "(none)"'

  # If the system is melting, bail early so we don't keep hammering it.
  if [[ $RC -ne 0 ]]; then echo "✗ loadgen exited non-zero — aborting ramp"; break; fi
done

# --- 4. Optional control: direct-to-service comparison ---------------------
echo
echo "================================================================"
echo " CONTROL: same final concurrency hitting search-service directly"
echo " (bypasses gateway — tells us how much of the cost is the proxy)"
echo "================================================================"
FINAL_C="${STAGE_ARR[-1]// /}"
$SSH "$HOST" "cat > /tmp/loadgen_direct.mjs" <<'NODE_DIRECT'
import http from 'node:http'; import { performance } from 'node:perf_hooks';
const C = parseInt(process.env.C||'1000'), D = parseInt(process.env.D||'30');
const stopAt = performance.now() + D*1000;
const stats = { sent: 0, status:{}, latencies:[], errors:0 };
function once(){return new Promise(r=>{const t0=performance.now();const req=http.request({host:'127.0.0.1',port:4005,path:'/courses?sort=popular&limit=8',method:'GET'},(res)=>{res.on('data',()=>{});res.on('end',()=>{stats.sent++;stats.status[res.statusCode]=(stats.status[res.statusCode]||0)+1;stats.latencies.push(performance.now()-t0);r()})});req.on('error',()=>{stats.errors++;r()});req.end()})}
async function w(){while(performance.now()<stopAt) await once()}
const t0=performance.now(); await Promise.all(Array.from({length:C},w)); const dur=(performance.now()-t0)/1000;
stats.latencies.sort((a,b)=>a-b); const pct=p=>stats.latencies[Math.floor(stats.latencies.length*p)]||0;
console.log(JSON.stringify({reqs:stats.sent, errors:stats.errors, rps:Math.round(stats.sent/dur), status:stats.status, p50:Math.round(pct(0.5)), p95:Math.round(pct(0.95)), p99:Math.round(pct(0.99)), max:Math.round(stats.latencies.at(-1)||0), dur_s:Math.round(dur)},null,2));
NODE_DIRECT
$SSH "$HOST" "C=$FINAL_C D=$DURATION node /tmp/loadgen_direct.mjs"

# --- 5. Final summary ------------------------------------------------------
echo
echo "================================================================"
echo " DONE — full log: $OUT"
echo "================================================================"
$SSH "$HOST" 'echo "final memory:"; free -h | head -2
echo "final gateway /health:"; curl -sS -m 3 http://127.0.0.1:4000/health | head -c 700; echo'
