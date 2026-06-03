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

# This is a one-VM deployment. Stop the app before install/build so a small
# e2-small/e2-medium instance does not build Next.js while all services are
# already consuming RAM. This intentionally causes short deploy downtime.
log "stop existing pm2 entries for this app"
for app in "${APP_NAMES[@]}"; do
  pm2 delete "$app" >/dev/null 2>&1 || true
done

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

log "build frontend"
rm -rf frontend/.next
npm --prefix frontend run build

log "start pm2 ecosystem"
pm2 start ecosystem.config.cjs --update-env

log "wait for frontend"
FRONTEND_OK=0
for _ in $(seq 1 30); do
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
