# Monitoring

Everything here is free and works without any account. Paid or hosted monitoring waits
until the system is hosted (see `hosting-later.md`).

## Errors: Sentry (optional)

Sentry is off unless `SENTRY_DSN` is set. No account is needed to develop or run tests.

Wiring, for the api, call-engine and admin owners:

1. Read `SENTRY_DSN`, `APP_ENV` (used as the Sentry environment) and
   `SENTRY_TRACES_SAMPLE_RATE` from the environment. If `SENTRY_DSN` is empty, do not
   initialise Sentry at all.
2. Initialise as early as possible (`@sentry/node` in `main.ts` before the app is created;
   `@sentry/nextjs` for admin).
3. Scrub personal data before sending (safety rule 8): set `sendDefaultPii: false`, and in
   `beforeSend` mask phone numbers to the last 4 digits and drop request bodies on
   webhook and auth routes. Never attach medicine names, transcripts or recordings.
4. Tag events with `callId` / `doseId` (ids only), never the phone number.

If the founder later wants Sentry, the free developer plan is enough for the pilot; it
only needs the DSN put in the secret store. Self-hosting is the other free option.

## Uptime check

`infra/monitoring/check-uptime.sh` checks that each URL answers 2xx.

```sh
PUBLIC_BASE_URL=http://localhost:3000 infra/monitoring/check-uptime.sh
UPTIME_URLS="https://api.example.in/health https://admin.example.in" infra/monitoring/check-uptime.sh
```

## Call-failure alert

`infra/monitoring/check-call-failures.sh` reads the `calls` table and alerts when the share
of calls with status `failed` in the last hour is above a threshold. `no_answer` and `busy`
are the parent's behaviour and are not counted as technical failures.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Read-only user is enough |
| `WINDOW_MINUTES` | 60 | Look-back window |
| `THRESHOLD_PCT` | 5 | Alert above this percentage (pilot target is under 2%) |
| `MIN_CALLS` | 20 | Fewer finished calls than this never alerts |

Exit codes for both scripts: 0 ok, 1 alert, 2 usage error. With `ALERT_WEBHOOK_URL` set,
the message is POSTed as JSON `{"text": ...}`; a Slack, Discord or Google Chat incoming
webhook on a free plan works. The scripts never read or print phone numbers.

Run every 5 minutes with cron on whatever machine runs the system:

```cron
*/5 * * * * cd /srv/tasalli && . ./.env && infra/monitoring/check-uptime.sh
*/5 * * * * cd /srv/tasalli && . ./.env && infra/monitoring/check-call-failures.sh
```

Tests: `pnpm --filter @tasalli/infra test` (needs `TEST_DATABASE_URL`; CI provides it).
