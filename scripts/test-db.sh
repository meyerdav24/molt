#!/usr/bin/env sh
# Run all SQL test suites in supabase/tests/ against DATABASE_URL
# (falls back to reading it from .env). Every suite runs in one
# transaction and rolls back; safe against any environment.
set -e

if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
  DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
fi
if [ -z "$DATABASE_URL" ]; then
  echo "error: DATABASE_URL is not set (env or .env)" >&2
  exit 1
fi

PSQL=$(command -v psql || true)
if [ -z "$PSQL" ] && [ -x /opt/homebrew/opt/libpq/bin/psql ]; then
  PSQL=/opt/homebrew/opt/libpq/bin/psql
fi
if [ -z "$PSQL" ]; then
  echo "error: psql not found (install postgresql client / libpq)" >&2
  exit 1
fi

for f in supabase/tests/*.sql; do
  echo "==> $f"
  "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA -f "$f" | grep -E 'PASSED|FAILED' || {
    echo "error: $f produced no PASSED marker" >&2
    exit 1
  }
done
