#!/usr/bin/env bash
# Backup and restore round trip on real Postgres (issue #23: backups tested).
# Uses two throwaway databases created next to TEST_DATABASE_URL.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  [[ -n "${CI:-}" ]] && { echo "TEST_DATABASE_URL is required in CI" >&2; exit 1; }
  echo "skip: TEST_DATABASE_URL not set"; exit 0
fi

base="${TEST_DATABASE_URL%/*}"
src_db="bk_src_$$"; dst_db="bk_dst_$$"
tmp="$(mktemp -d)"
export PGOPTIONS="-c client_min_messages=warning"
admin() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -XqtA -c "$1"; }
cleanup() {
  admin "drop database if exists $src_db" || true
  admin "drop database if exists $dst_db" || true
  rm -rf "$tmp"
}
trap cleanup EXIT
admin "create database $src_db"; admin "create database $dst_db"

psql "$base/$src_db" -v ON_ERROR_STOP=1 -Xq -f "$ROOT/packages/contracts/schema.sql"
psql "$base/$src_db" -v ON_ERROR_STOP=1 -Xq -c "
  insert into calls (purpose, provider, status) select 'reminder', 'fake', 'completed' from generate_series(1, 42);"

file=$(DATABASE_URL="$base/$src_db" "$ROOT/infra/scripts/db-backup.sh" "$tmp")
[[ -s "$file" ]] || { echo "FAIL: backup file empty"; exit 1; }
echo "ok - backup written"

TARGET_DATABASE_URL="$base/$dst_db" "$ROOT/infra/scripts/db-restore.sh" "$file" >/dev/null
n=$(psql "$base/$dst_db" -XtAc "select count(*) from calls")
[[ "$n" == "42" ]] || { echo "FAIL: restored $n calls, want 42"; exit 1; }
echo "ok - restore round trip keeps all rows"

set +e; TARGET_DATABASE_URL="$base/$dst_db" "$ROOT/infra/scripts/db-restore.sh" "$file" 2>/dev/null; rc=$?; set -e
[[ "$rc" == "3" ]] || { echo "FAIL: restore over existing data should refuse (got $rc)"; exit 1; }
echo "ok - refuses to overwrite a populated database without FORCE=1"

FORCE=1 TARGET_DATABASE_URL="$base/$dst_db" "$ROOT/infra/scripts/db-restore.sh" "$file" >/dev/null
n=$(psql "$base/$dst_db" -XtAc "select count(*) from calls")
[[ "$n" == "42" ]] || { echo "FAIL: forced restore has $n calls"; exit 1; }
echo "ok - FORCE=1 restore replaces data cleanly"
echo "backup-restore: 4 passed"
