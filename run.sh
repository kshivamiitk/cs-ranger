#!/usr/bin/env bash
#
# run.sh — start LearnRift locally.
#
#   1. Frees the ports the app uses (kills whatever is currently listening).
#   2. Starts the backend (api-gateway + 12 services) and the frontend (Next.js).
#
# Ctrl-C stops everything. Safe to re-run — it clears stale listeners first.
#
# Usage:  ./run.sh        (or:  bash run.sh)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Frontend (3000) + api-gateway (4000) + 12 backend services (4001-4012).
# Matches the SERVICES map in backend/api-gateway/src/index.ts and the PORT_* in .env.
PORTS=(3000 $(seq 4000 4012))

free_ports() {
  echo "▶ Freeing ports: ${PORTS[*]}"
  for p in "${PORTS[@]}"; do
    local pids
    pids="$(lsof -ti "tcp:${p}" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -z "$pids" ]] && continue
    echo "  · :$p busy → kill $pids"
    kill $pids 2>/dev/null || true
  done
  # Give them a moment to release the socket, then force-kill any survivors.
  sleep 1
  for p in "${PORTS[@]}"; do
    local pids
    pids="$(lsof -ti "tcp:${p}" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$pids" ]] && { echo "  · :$p still up → kill -9 $pids"; kill -9 $pids 2>/dev/null || true; }
  done
}

ensure_deps() {
  for d in backend frontend; do
    if [[ ! -d "$ROOT/$d/node_modules" ]]; then
      echo "▶ Installing $d dependencies (first run)…"
      ( cd "$ROOT/$d" && npm install )
    fi
  done
}

# Tear the whole process group down on Ctrl-C / TERM (backend's tsx workers,
# concurrently, and the Next.js dev server are all in this group).
cleanup() {
  trap - INT TERM        # disarm so we don't re-enter
  echo
  echo "▶ Stopping LearnRift…"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM

free_ports
ensure_deps

echo "▶ Starting backend (api-gateway :4000 + services :4001-:4012)…"
# Backend services run via tsx, which does NOT auto-load .env. Source it here (scoped
# to this subshell) so they connect to Supabase / Redis with the right config. The
# service key stays out of the frontend process this way.
(
  cd "$ROOT/backend" || exit 1
  set -a; source "$ROOT/.env" 2>/dev/null || true; set +a
  exec npm run dev
) &

echo "▶ Starting frontend (Next.js :3000)…"
# Next.js auto-loads frontend/.env.local — no sourcing needed.
(
  cd "$ROOT/frontend" || exit 1
  exec npm run dev
) &

echo
echo "▶ LearnRift is starting:"
echo "    Frontend  → http://localhost:3000"
echo "    Gateway   → http://localhost:4000   (health: /health)"
echo "    Ctrl-C to stop everything."
echo

# Wait for both background jobs; Ctrl-C triggers cleanup() above.
wait
