# Incident basics

Tasalli calls elderly parents about medicines. The worst failures are a call with wrong
details or at the wrong time, a call after someone pressed 9, or reminders silently not
going out. Act on those first.

## Severity

| Sev | Examples | Response |
| --- | --- | --- |
| 1 | Calls to someone who opted out (key 9); wrong medicine or dose spoken; calls at the wrong time; duplicate calls or confirmations; data leak | Stop calls now (below), tell the founder immediately |
| 2 | Reminders not going out; call-failure alert firing; API down | Fix within the hour; tell the founder |
| 3 | Admin console broken; one family affected; slow app | Next working day |

## Stop all calls (Sev 1)

1. Stop the scheduler so no new calls are placed: `docker compose stop call-engine`
   (or scale the call-engine service to 0 where hosted).
2. Leave the api running so webhooks for calls already in progress are still recorded
   (rule 6: they are idempotent).
3. If one number is affected, block it from the admin console (block list) instead of stopping everything.
4. Do not restart the call-engine until the cause is understood and a test reproduces it.

## First 15 minutes

- What is the user-visible effect, since when, how many families? Note times in IST.
- Check: `infra/monitoring/check-uptime.sh`, `infra/monitoring/check-call-failures.sh`,
  `docker compose logs --since 30m api call-engine`, Sentry if configured.
- Calls in the last hour by status:
  ```sql
  select status, count(*) from calls where created_at > now() - interval '1 hour' group by 1;
  ```
- Provider status page (Exotel / Plivo) if `failed` is high for all numbers.
- Never paste full phone numbers into chat, issues or notes: last 4 digits only (rule 8).

## Recover

- Bad deploy: check out the previous commit and `pnpm stack:up` again.
- Lost or corrupted data: restore the latest backup into a scratch database first
  (`TARGET_DATABASE_URL=... infra/scripts/db-restore.sh file.dump`), check it, then swap.
- Missed reminders during an outage: do not bulk re-call automatically. List the missed doses,
  tell the families through the app or WhatsApp, and let the founder decide.

## Afterwards

Open a GitHub issue labelled `incident` with: timeline (IST), impact (families, calls),
cause, fix, and one test or alert that would have caught it. No personal data in the issue.
