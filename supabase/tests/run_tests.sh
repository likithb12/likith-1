#!/usr/bin/env bash
#
# Apply every migration to a throwaway Postgres cluster and run the RLS tests.
#
# This does NOT need a Supabase project: supabase/tests/00_supabase_stubs.sql
# recreates the few objects the migrations depend on (auth.users, auth.uid(),
# and the anon/authenticated/service_role roles).
#
# Requires a local PostgreSQL server binary (Debian/Ubuntu: postgresql-16).
#
#   ./supabase/tests/run_tests.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
TESTS_DIR="$REPO_ROOT/supabase/tests"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ -d "$PGBIN" ]; then
  export PATH="$PGBIN:$PATH"
fi

command -v initdb >/dev/null 2>&1 || {
  echo "initdb not found. Install PostgreSQL server binaries, or set PGBIN." >&2
  exit 127
}

WORKDIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
export PGDATA="$WORKDIR/data"

# Postgres refuses to run as root, so drop to a non-root account when needed.
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  if id -u postgres >/dev/null 2>&1; then
    RUN_AS="postgres"
    chmod 711 "$WORKDIR"
    chown "$RUN_AS" "$WORKDIR"
  else
    echo "Running as root and no 'postgres' user exists to drop to." >&2
    exit 1
  fi
fi

run() {
  if [ -n "$RUN_AS" ]; then
    su "$RUN_AS" -c "PATH=$PATH PGDATA=$PGDATA $*"
  else
    env PATH="$PATH" PGDATA="$PGDATA" bash -c "$*"
  fi
}

cleanup() {
  run "pg_ctl -D '$PGDATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "Starting a temporary PostgreSQL cluster..."
run "initdb -D '$PGDATA' -A trust -U postgres" >/dev/null
run "pg_ctl -D '$PGDATA' -l '$WORKDIR/pg.log' -o \"-k '$WORKDIR' -p $PORT -c listen_addresses=''\" -w start" >/dev/null

PSQL=(psql -h "$WORKDIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 --no-psqlrc)

echo "Applying Supabase stubs..."
"${PSQL[@]}" -q -f "$TESTS_DIR/00_supabase_stubs.sql"

echo "Applying migrations..."
shopt -s nullglob
for migration in "$MIGRATIONS_DIR"/*.sql; do
  echo "  -> $(basename "$migration")"
  "${PSQL[@]}" -q -f "$migration"
done

echo "Running tests..."
status=0
for test_file in "$TESTS_DIR"/*.test.sql; do
  echo "  -> $(basename "$test_file")"
  if ! "${PSQL[@]}" -f "$test_file"; then
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "Database tests passed."
else
  echo "Database tests FAILED." >&2
fi
exit "$status"
