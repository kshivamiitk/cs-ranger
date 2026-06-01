#!/usr/bin/env bash
#
# generate-secret.sh — mint a strong JWT_SECRET for production.
#
# The backend refuses to start in production with a missing, placeholder, or
# too-short JWT_SECRET (see backend/shared/config.ts). Run this to generate a
# real one, then paste it into the server's .env:
#
#   ./scripts/generate-secret.sh                 # prints a ready-to-paste line
#   ./scripts/generate-secret.sh >> .env         # append it to .env
#
set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found — install it or use: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" >&2
  exit 1
fi

echo "JWT_SECRET=$(openssl rand -hex 32)"
