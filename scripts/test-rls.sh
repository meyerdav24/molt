#!/usr/bin/env sh
# Run the RLS policy tests against the database in DATABASE_URL
# (falls back to reading it from .env). Everything runs in one
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

exec "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/rls_policies.sql
