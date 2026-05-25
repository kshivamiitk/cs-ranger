#!/usr/bin/env bash
# Apply all migrations + seed to a Postgres database.
# Usage:
#   ./apply.sh "postgres://user:pass@host:5432/dbname"
# or set DATABASE_URL.

set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
if [[ -z "${DB_URL}" ]]; then
  echo "Provide a connection string as the first arg, or set DATABASE_URL." >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ Applying migrations…"
for f in "$DIR"/migrations/*.sql; do
  echo "  · $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

if [[ "${WITH_SEED:-1}" == "1" ]]; then
  echo "▶ Loading seed data…"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/seed.sql"
fi

echo "✓ Done."
