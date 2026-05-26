#!/usr/bin/env bash
  # Idempotent deploy: git pull -> install -> build frontend -> reload pm2 -> health check.
  # Designed to be called from GitHub Actions over SSH; also safe to run manually.
  set -euo pipefail

  cd /home/ubuntu/cs-ranger

  echo "▶ git pull"
  git fetch --quiet origin main
  git reset --hard origin/main          # discard any drift on the server

  echo "▶ npm install (root cascades to frontend + backend via postinstall)"
  npm install --no-audit --no-fund

  echo "▶ build frontend"
  npm --prefix frontend run build

  echo "▶ reload backend services (zero-downtime where possible)"
  # Stagger in two waves so Redis client limit isn't hit all at once.
  pm2 reload cs-api-gateway cs-auth-service cs-user-service
  sleep 3
  pm2 reload cs-course-service cs-enrollment-service cs-search-service \
             cs-payment-service cs-wallet-service cs-payout-service \
             cs-notification-service cs-support-service \
             cs-achievement-service cs-analytics-service

  echo "▶ reload frontend"
  pm2 reload cs-frontend

  echo "▶ wait for services to settle"
  sleep 6

  echo "▶ health check"
  HEALTH=$(curl -fsS http://127.0.0.1:4000/health || echo "FAIL")
  echo "$HEALTH" | head -c 500
  echo
  if [[ "$HEALTH" == "FAIL" ]] || ! echo "$HEALTH" | grep -q '"gateway":"ok"'; then
    echo "✗ deploy failed health check"
    exit 1
  fi
  echo "✓ deploy OK"