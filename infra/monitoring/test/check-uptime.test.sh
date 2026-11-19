#!/usr/bin/env bash
# Tests for check-uptime.sh against a throwaway local HTTP server.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/../check-uptime.sh"
PORT=$(( 20000 + RANDOM % 20000 ))

node -e "
  require('http').createServer((req, res) => {
    res.statusCode = req.url === '/health' ? 200 : 503; res.end();
  }).listen($PORT, '127.0.0.1');
" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && break; sleep 0.1; done

pass=0
expect() {
  local desc="$1" want="$2"; shift 2
  set +e; out=$(env ALERT_WEBHOOK_URL= "$@" "$CHECK" 2>&1); got=$?; set -e
  [[ "$got" == "$want" ]] || { echo "FAIL: $desc (want $want, got $got): $out"; exit 1; }
  echo "ok - $desc"; pass=$((pass + 1))
}

expect "healthy base URL is up" 0 PUBLIC_BASE_URL="http://127.0.0.1:$PORT"
expect "503 is down" 1 UPTIME_URLS="http://127.0.0.1:$PORT/broken"
expect "one down of two fails" 1 UPTIME_URLS="http://127.0.0.1:$PORT/health http://127.0.0.1:$PORT/x"
expect "unreachable host is down" 1 UPTIME_URLS="http://127.0.0.1:1/health" TIMEOUT_SECONDS=2
expect "missing config is a usage error" 2 PUBLIC_BASE_URL= UPTIME_URLS=
echo "check-uptime: $pass passed"
