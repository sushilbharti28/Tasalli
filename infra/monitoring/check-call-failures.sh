#!/usr/bin/env bash
# Call-failure alert. Free: needs only psql and the app database.
#
# Counts calls that ended in the last WINDOW_MINUTES and alerts when the share
# with status 'failed' (technical failure: provider error, bad number, network)
# is above THRESHOLD_PCT. 'no_answer' and 'busy' are the parent's behaviour,
# not technical failures, so they are not counted as failures.
# Pilot target (docs/scope-v1.md): under 2% technical failures.
#
# Env:
#   DATABASE_URL       required (read-only user is enough)
#   WINDOW_MINUTES     default 60
#   THRESHOLD_PCT      default 5   (alert threshold, percent)
#   MIN_CALLS          default 20  (below this, too few calls to judge; never alerts)
#   ALERT_WEBHOOK_URL  optional; JSON {"text": "..."} is POSTed (Slack/Discord/Google Chat style)
#
# Exit codes: 0 ok, 1 alert fired, 2 usage or query error.
# No phone numbers or personal data are read or printed (safety rule 8).
set -euo pipefail

[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is required" >&2; exit 2; }
WINDOW_MINUTES="${WINDOW_MINUTES:-60}"
THRESHOLD_PCT="${THRESHOLD_PCT:-5}"
MIN_CALLS="${MIN_CALLS:-20}"

for v in WINDOW_MINUTES THRESHOLD_PCT MIN_CALLS; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || { echo "$v must be a whole number" >&2; exit 2; }
done

row=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -XtA -F ' ' -c "
  select count(*) filter (where status in ('failed','completed','no_answer','busy')),
         count(*) filter (where status = 'failed')
  from calls
  where coalesce(ended_at, created_at) >= now() - interval '${WINDOW_MINUTES} minutes'
") || { echo "query failed" >&2; exit 2; }

read -r total failed <<<"$row"
pct=0
if (( total > 0 )); then pct=$(( failed * 100 / total )); fi
msg="Tasalli call failures: ${failed}/${total} (${pct}%) in the last ${WINDOW_MINUTES} min, threshold ${THRESHOLD_PCT}%"

if (( total >= MIN_CALLS )) && (( failed * 100 > THRESHOLD_PCT * total )); then
  echo "ALERT: $msg"
  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    curl -sS -m 10 -H 'Content-Type: application/json' \
      --data "{\"text\": \"ALERT: ${msg}${APP_ENV:+ [${APP_ENV}]}\"}" "$ALERT_WEBHOOK_URL" >/dev/null \
      || echo "warning: could not post to ALERT_WEBHOOK_URL" >&2
  fi
  exit 1
fi
echo "OK: $msg"
