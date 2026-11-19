# @tasalli/api

NestJS + Postgres backend for the child app. No paid services: OTP and billing are fakes behind interfaces.

## Run

```
pnpm install
pnpm --filter api migrate          # applies migrations/ (0001 is a verbatim copy of packages/contracts/schema.sql)
pnpm --filter api dev
pnpm --filter api test             # unit + API tests; API tests need local Postgres and Redis
```

Environment (names only, see `.env.example`): `DATABASE_URL`, `REDIS_URL`, `BULLMQ_PREFIX`, `SESSION_SECRET`,
`OTP_SENDER=fake`, `OTP_FIXED_CODE` (6 digits, dev/test only, refused in production), `DOSE_HORIZON_DAYS`, `RUN_WORKERS`.
API tests use `TEST_DATABASE_URL` (default `tasalli_api_test`, dropped and recreated each run).

## Fakes

- OTP: `FakeOtpSender` logs the code with the phone masked to the last 4 digits; with `OTP_FIXED_CODE` set that code is accepted.
- Billing: `FakeBillingProvider` does trial/plan logic only. Subscription starts active immediately; a real Razorpay provider implements the same interface and confirms by webhook.
- Script preview and medicine-name autocomplete use a fake previewer and a small seed list.

## Queues (BullMQ, Redis, prefix `BULLMQ_PREFIX`, default `bull`)

Mirrors `services/call-engine/src/queue/jobs.ts`. Payloads carry ids only. Job ids contain no `:`.

API -> call-engine, queue `call-engine`:

| Job | Payload | When |
| --- | --- | --- |
| `consent.call` | `{ personId }` | Person added (not self), or `POST /people/{id}/consent-call` retry |
| `test.call` | `{ userId }` | `POST /test-call` (max 3 a day, inside the 6 a day per number cap) |
| `schedule.replan` | `{ personId }` | Medicine/schedule added, edited, stopped; person paused, resumed, time zone changed, removed; doses generated; dose marked taken manually |

call-engine -> API, queue `tasalli-api-events` (optional; without them doses appear at the next hourly extension):

| Job | Payload | Effect |
| --- | --- | --- |
| `consent-recorded` | `{ personId, result }` | Generate doses (or clear them) after call-engine wrote `people.consent` |
| `number-blocked` | `{ personId, reason }` | Clear upcoming doses for that number in every account |

API internal: `tasalli-api-maintenance`, job `extend-dose-window`, hourly.

The API never places calls. call-engine re-checks consent, the block list and the daily cap when it acts.

## Notes for the founder / contract change requested

- `schema.sql` has no devices table: push tokens (`POST /devices`) are kept in a Redis set `tasalli:devices:<userId>`. Proposal: add a `devices` table.
- Queue names above could move into `packages/contracts`.
- Errors on conflicts return `{ statusCode, code, message }` with codes such as `limit_reached`, `number_blocked`, `already_consented`.

## v1.1 notes

- `BILLING_WEBHOOK_SECRET` signs `POST /webhooks/billing` (HMAC-SHA256 hex of the raw body in `X-Signature`). Unset means every billing webhook is rejected.
- Entitlement in `GET /subscription` (`entitled`, `graceEndsAt`): trialing, active, past_due for at most 3 days after `past_due_since` (paid plans), cancelled until `currentPeriodEnd`.
- `POST /doses/{id}/remind` queues `dose.remind {doseId}` on the `call-engine` queue. call-engine has no handler yet (not in `EngineJobs`); it must re-check consent, block list and the 6/day cap.
- Push tokens are stored in `devices` (the old Redis set `tasalli:devices:*` is no longer written or read).
- New people must be `hi` (400 `language_not_supported`); existing rows are untouched.
