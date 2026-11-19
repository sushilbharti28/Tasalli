#!/usr/bin/env bash
# Uptime check. Free: needs only curl.
# Fails when any URL does not answer 2xx within TIMEOUT_SECONDS.
#
# Env:
#   UPTIME_URLS        space-separated URLs, default "$PUBLIC_BASE_URL/health"
#   TIMEOUT_SECONDS    default 10
#   ALERT_WEBHOOK_URL  optional; JSON {"text": "..."} is POSTed on failure
#
# Exit codes: 0 all up, 1 something down, 2 usage error.
set -euo pipefail

TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10}"
if [[ -z "${UPTIME_URLS:-}" ]]; then
  [[ -n "${PUBLIC_BASE_URL:-}" ]] || { echo "set UPTIME_URLS or PUBLIC_BASE_URL" >&2; exit 2; }
  UPTIME_URLS="${PUBLIC_BASE_URL%/}/health"
fi

down=()
for url in $UPTIME_URLS; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m "$TIMEOUT_SECONDS" "$url" || true)
  if [[ "$code" =~ ^2 ]]; then
    echo "UP   $code $url"
  else
    echo "DOWN ${code:-000} $url"
    down+=("$url (${code:-000})")
  fi
done

if (( ${#down[@]} > 0 )); then
  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    curl -sS -m 10 -H 'Content-Type: application/json' \
      --data "{\"text\": \"DOWN: ${down[*]}${APP_ENV:+ [${APP_ENV}]}\"}" "$ALERT_WEBHOOK_URL" >/dev/null \
      || echo "warning: could not post to ALERT_WEBHOOK_URL" >&2
  fi
  exit 1
fi
