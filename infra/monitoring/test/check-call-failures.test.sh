#!/usr/bin/env bash
# Tests for check-call-failures.sh against a real Postgres, using the contract schema.
# Needs TEST_DATABASE_URL (CI provides it). Works in a throwaway schema, dropped at the end.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
CHECK="$HERE/../check-call-failures.sh"
if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  # Required in CI; locally, skip with a note instead of failing `pnpm test`.
  [[ -n "${CI:-}" ]] && { echo "TEST_DATABASE_URL is required in CI" >&2; exit 1; }
  echo "skip: TEST_DATABASE_URL not set (start Postgres with pnpm db:up and export it)"; exit 0
fi

SCHEMA="infra_test_$$"
export PGOPTIONS="-c search_path=${SCHEMA},public -c client_min_messages=warning"
q() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -XqtA "$@"; }

cleanup() { PGOPTIONS="-c client_min_messages=warning" q -c "drop schema if exists ${SCHEMA} cascade" >/dev/null; }
trap cleanup EXIT
PGOPTIONS= q -c "create schema ${SCHEMA}"
q -f "$ROOT/packages/contracts/schema.sql" >/dev/null

pass=0
expect() { # description, expected exit code, extra env...
  local desc="$1" want="$2"; shift 2
  set +e; out=$(env DATABASE_URL="$TEST_DATABASE_URL" ALERT_WEBHOOK_URL= "$@" "$CHECK" 2>&1); got=$?; set -e
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $desc (want exit $want, got $got): $out"; exit 1
  fi
  echo "ok - $desc: $out"; pass=$((pass + 1))
}
add() { # status, count, minutes_ago
  q -c "insert into calls (purpose, provider, status, ended_at)
        select 'reminder', 'fake', '$1', now() - interval '$3 minutes' from generate_series(1, $2)"
}

expect "no calls never alerts" 0
add failed 5 5
expect "below MIN_CALLS never alerts" 0
add completed 60 5; add no_answer 20 5; add busy 15 5
expect "5/100 at threshold 5% is ok" 0
add failed 1 5
expect "6/101 above 5% alerts" 1
expect "custom threshold 10% is ok" 0 THRESHOLD_PCT=10
add failed 50 180
expect "old failures outside the window are ignored" 0 THRESHOLD_PCT=10
expect "wider window counts old failures" 1 WINDOW_MINUTES=240 THRESHOLD_PCT=30
expect "no_answer and busy are not technical failures" 0 THRESHOLD_PCT=6
expect "bad input is a usage error" 2 WINDOW_MINUTES=abc

echo "check-call-failures: $pass passed"
