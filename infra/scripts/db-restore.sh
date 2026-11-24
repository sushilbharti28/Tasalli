#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into TARGET_DATABASE_URL.
#   TARGET_DATABASE_URL=... infra/scripts/db-restore.sh path/to/file.dump
# Refuses to restore into a database that already has a `calls` table unless
# FORCE=1, so a production database is never overwritten by accident.
set -euo pipefail
# Client tools must match the server major version (a newer pg_restore emits settings
# an older server rejects). Point PG_BIN at e.g. /usr/lib/postgresql/16/bin if needed.
PG_BIN="${PG_BIN:+${PG_BIN%/}/}"
[[ -n "${TARGET_DATABASE_URL:-}" ]] || { echo "TARGET_DATABASE_URL is required" >&2; exit 2; }
file="${1:-}"
[[ -f "$file" ]] || { echo "usage: db-restore.sh <file.dump>" >&2; exit 2; }
has_calls=$("${PG_BIN}psql" "$TARGET_DATABASE_URL" -XtAc "select to_regclass('public.calls') is not null")
if [[ "$has_calls" == "t" && "${FORCE:-}" != "1" ]]; then
  echo "target already has a calls table; set FORCE=1 to restore over it" >&2
  exit 3
fi
"${PG_BIN}pg_restore" --dbname="$TARGET_DATABASE_URL" --no-owner --no-privileges --clean --if-exists --exit-on-error "$file"
echo "restored $file"
