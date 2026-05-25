#!/usr/bin/env bash
# Apply every operational SQL file in this directory, in order, against the
# database. Files are idempotent, so re-running is safe.
#   ./apply.sh                  # uses DATABASE_URL_DIRECT (or DATABASE_URL) from ../../.env
#   DATABASE_URL=... ./apply.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

DB_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL_DIRECT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')}"
if [[ -z "$DB_URL" ]]; then
  echo "No DB URL — set DATABASE_URL, or DATABASE_URL_DIRECT in $ROOT/.env" >&2
  exit 1
fi

shopt -s nullglob
files=("$DIR"/*.sql)
if (( ${#files[@]} == 0 )); then echo "No .sql files in ops/"; exit 0; fi

for f in "${files[@]}"; do
  echo "▶ $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "✓ ops applied"
