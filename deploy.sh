#!/usr/bin/env bash
# Idempotent production deploy for the single-VM Google Cloud setup.
#
# Expected server layout:
#   repo:  $HOME/cs-ranger
#   env:   $HOME/cs-ranger/.env
#   pm2:   installed globally, with startup service configured once
#
# GitHub Actions calls this over SSH after checking out the target commit on the
# VM. It is also safe to run manually on the VM.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/cs-ranger}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_REF="${DEPLOY_REF:-origin/$DEPLOY_BRANCH}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"

APP_NAMES=(
  cs-frontend
  cs-api-gateway
  cs-auth-service
  cs-user-service
  cs-course-service
  cs-enrollment-service
  cs-search-service
  cs-payment-service
  cs-wallet-service
  cs-payout-service
  cs-notification-service
  cs-support-service
  cs-achievement-service
  cs-analytics-service
)

log() {
  printf '\n==> %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

log "preflight"
require_cmd git
require_cmd node
require_cmd npm
require_cmd pm2
require_cmd curl

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $APP_DIR/.env. Create it from .env.example before deploying." >&2
  exit 1
fi

log "fetch target ref"
git fetch --quiet origin "$DEPLOY_BRANCH"
git reset --hard "$DEPLOY_REF"

log "runtime versions"
node -v
npm -v
pm2 -v

# Low-downtime deploy: keep the running services UP during install + build (the
# 16 GB VM has ample headroom), then gracefully reload them at the end. Two wins:
#   * No full-stop outage for the whole npm ci + Next build window (the old
#     behaviour, which read as "the site keeps crashing" on every deploy).
#   * A failed build leaves the CURRENT site running untouched — a bad deploy no
#     longer takes production down; it just aborts before the reload.
if command -v free >/dev/null 2>&1; then
  log "memory before install/build"
  free -h
fi

log "install dependencies from lockfiles"
npm ci --ignore-scripts --no-audit --no-fund --registry="$NPM_REGISTRY"
npm --prefix frontend ci --no-audit --no-fund --registry="$NPM_REGISTRY"
npm --prefix backend ci --no-audit --no-fund --registry="$NPM_REGISTRY"

# Source .env BEFORE building the frontend. Next.js inlines NEXT_PUBLIC_* at
# build time. Backend services also read env from the PM2 process environment.
log "load production env"
set -a
source .env
set +a

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo "Refusing to deploy: NODE_ENV must be production in $APP_DIR/.env" >&2
  exit 1
fi

if [[ "${NEXT_PUBLIC_API_URL:-}" =~ localhost|127\.0\.0\.1|0\.0\.0\.0 ]]; then
  echo "Refusing to deploy: NEXT_PUBLIC_API_URL points at localhost." >&2
  echo "Set NEXT_PUBLIC_API_URL=/api or your public API URL." >&2
  exit 1
fi

# Preflight the secrets every backend service requires at startup. createService
# calls assertProductionEnv(), which THROWS when any of these is missing — so
# without this guard `pm2 startOrReload` below would swap in processes that
# instantly crash-loop and take the whole API down (a 502 for everyone) while
# the deploy "succeeds" up to the health gate. Failing here instead aborts the
# deploy with the CURRENT, working processes left untouched.
for var in JWT_SECRET INTERNAL_API_SECRET SUPABASE_URL SUPABASE_SERVICE_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Refusing to deploy: $var is not set in $APP_DIR/.env." >&2
    echo "All backend services would crash-loop on boot. Set it (e.g. \`openssl rand -hex 32\` for secrets) and re-run." >&2
    exit 1
  fi
done

log "build frontend"
# Keep the previous .next in place during the build so the still-running
# `next start` isn't disrupted; next build overwrites it. (No rm -rf.)
npm --prefix frontend run build

log "reload pm2 ecosystem (graceful: starts new apps, reloads running ones)"
# startOrReload reloads in place instead of delete+start — services that are
# already up restart one at a time rather than all going down together.
pm2 startOrReload ecosystem.config.cjs --update-env

log "wait for frontend"
FRONTEND_OK=0
# Next.js can take 90-120s to start on the 2 GB VM after a fresh production
# build. Give it enough time before declaring the deploy failed.
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000; then
    FRONTEND_OK=1
    break
  fi
  sleep 2
done
if [[ "$FRONTEND_OK" != "1" ]]; then
  echo "Frontend did not become healthy on http://127.0.0.1:3000" >&2
  pm2 status || true
  pm2 logs cs-frontend --lines 80 --nostream || true
  exit 1
fi

log "wait for api gateway and services"
HEALTH_OK=0
HEALTH=""
for _ in $(seq 1 30); do
  if HEALTH="$(curl -fsS http://127.0.0.1:4000/health 2>/dev/null)"; then
    if node -e '
      const payload = JSON.parse(process.argv[1]);
      const data = payload.data || {};
      const bad = (data.services || []).filter((service) => service.status !== "ok");
      if (data.gateway !== "ok" || bad.length) {
        if (bad.length) console.error("Unhealthy services:", bad.map((s) => `${s.name}:${s.status}`).join(", "));
        process.exit(1);
      }
    ' "$HEALTH"; then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 2
done

if [[ "$HEALTH_OK" != "1" ]]; then
  echo "API gateway health check failed." >&2
  [[ -n "$HEALTH" ]] && echo "$HEALTH" >&2
  pm2 status || true
  pm2 logs cs-api-gateway --lines 80 --nostream || true
  exit 1
fi

echo "$HEALTH" | head -c 1000
echo

log "save clean pm2 process list"
pm2 save

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-enabled --quiet "pm2-$USER" 2>/dev/null; then
    echo "Warning: pm2-$USER startup service is not enabled." >&2
    echo "Run once on the VM:" >&2
    echo "  sudo env PATH=\$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME" >&2
    echo "  pm2 save" >&2
  fi
fi

log "deploy complete"
