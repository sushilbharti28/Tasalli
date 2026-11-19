#!/usr/bin/env bash
# Logical backup of the Tasalli database with pg_dump (custom format, compressed).
# Free: works against local compose Postgres or any hosted Postgres.
#   DATABASE_URL=... infra/scripts/db-backup.sh [output-dir]
# Writes <output-dir>/tasalli-<UTC timestamp>.dump and prints its path.
# Backups contain health data: keep them in India and delete them with the account (rule 9).
set -euo pipefail
[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is required" >&2; exit 2; }
out_dir="${1:-./backups}"
mkdir -p "$out_dir"
chmod 700 "$out_dir"
file="$out_dir/tasalli-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$file"
chmod 600 "$file"
echo "$file"
