# @tasalli/integrations

Outside-service integrations for Tasalli. Each one is an interface, a fake for tests,
and, where the service is free, a real implementation.

Founder rule (Nov 2026): **no integrations with services that cost money yet.** So MSG91,
the WhatsApp Business API and Razorpay are interfaces plus fakes only. See
[Adding real providers later](#adding-real-providers-later).

| Integration | Interface | Real implementation | Fake / dev |
| --- | --- | --- | --- |
| OTP by SMS | `OtpSender` + `OtpService` | none yet (paid) | `FakeOtpSender`, `DevConsoleOtpSender` |
| Push | `PushSender` | `FcmPushSender` (FCM HTTP v1, free) | `FakePushSender` |
| WhatsApp templates | `WhatsAppSender` | none yet (paid) | `FakeWhatsAppSender` |
| Alerts to the child | `handleAlertJob`, `startAlertWorker` | BullMQ worker | `InMemoryAlertData` |

All configuration is read from environment variables by name (safety rule 8). Phone numbers
are masked to the last 4 digits in every log line (`maskPhone`, `Logger`).

## OTP

`OtpService` issues and checks codes: 6 digits, 5 minutes, single use, stored hashed,
locked after 5 wrong attempts, 30 s resend cooldown, at most 5 sends per number per hour.
Storage is `InMemoryOtpStore` (tests) or `RedisOtpStore`.

`RoutingOtpSender(domestic, international)` sends `+91` numbers one way and everything else
another way, so an Indian DLT route and an international route can be plugged in separately.

| Env var | Meaning |
| --- | --- |
| `OTP_PROVIDER` | `console` (default outside production) or `fake`. Production refuses to start until a real provider is added. |
| `OTP_DEV_FIXED_CODE` | Optional, 6 digits. Every issued code is this value. Refused in production. |
| `NODE_ENV` / `APP_ENV` | `production` disables the console sender and the fixed code. |

Dev mode prints `[dev OTP] +••••••••2861 code 424242 (valid 5 min)` to the console.

## Push (Firebase Cloud Messaging HTTP v1)

`FcmPushSender` signs a service-account JWT (RS256), exchanges it at
`https://oauth2.googleapis.com/token` for an access token with scope
`https://www.googleapis.com/auth/firebase.messaging` (cached until a minute before expiry,
refreshed once on 401), and posts `{ message: { token, notification, data, android } }` to
`https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`. No Google SDK dependency.

Each send returns `ok`, `invalid_token` (UNREGISTERED, SENDER_ID_MISMATCH, or INVALID_ARGUMENT
about the token: remove the token), `retryable` (429, 5xx, network) or `error`.

| Env var | Meaning |
| --- | --- |
| `PUSH_PROVIDER` | `fcm` (default in production) or `fake` (default elsewhere) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Whole service-account key file as JSON, or the three below |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `\n` in the key is unescaped |

## WhatsApp

Provider-agnostic `WhatsAppSender.sendTemplate({ to, template, locale, params })` with named
params. Templates (`missed_dose_alert`, `evening_summary`, en + hi) are defined in
`src/whatsapp/templates.ts`; the founder-review copy is `docs/whatsapp-templates.md`.
`renderTemplate` validates params the way WhatsApp does (all present, no extras, no newlines,
tabs or long runs of spaces); `sanitizeParam` cleans free text first.

| Env var | Meaning |
| --- | --- |
| `WHATSAPP_PROVIDER` | Only `fake` exists. Production refuses to start until a real provider is added. |

## Alert worker

Consumes the call engine's alerts and sends them to the child by push and WhatsApp.

**Queue interface** (matches `services/call-engine/src/queue/jobs.ts` on `call-engine/v1`):

| | |
| --- | --- |
| Queue | `integrations-alerts` (same BullMQ `prefix` as the call engine) |
| Job name | `alert` |
| jobId | dedupe key, one per kind and call group or person, e.g. `dose_missed_<callGroupId>`; never contains `:` |
| Options | producer sets `attempts: 5`, exponential backoff |

```ts
interface AlertJob {
  kind: 'dose_missed' | 'doctor_changed' | 'unwell' | 'opted_out'
      | 'consent_given' | 'consent_declined' | 'consent_no_answer'
      | 'evening_summary';            // PROPOSED, see below
  personId: string;
  ownerUserId: string;
  callGroupId: string | null;
  doseIds: string[];
  at: string;                         // ISO UTC
  reason?: string;                    // 'retries_exhausted' | 'said_not_taken' | ...
  localDate?: string;                 // PROPOSED, evening_summary only: parent's YYYY-MM-DD
}
```

**Proposed for alignment with the call engine:** an `evening_summary` alert per person per local
day, jobId `evening_summary_<personId>_<YYYY-MM-DD>` (`eveningSummaryJobId`), enqueued by the
scheduler at the parent's evening (proposed 8:30 pm local, or after the day's last dose). If
`localDate` is missing it is derived from `at` in the parent's time zone. Once agreed, these
types should move to `packages/contracts`.

**What is sent**

| Kind | Push | WhatsApp |
| --- | --- | --- |
| `dose_missed` | yes | `missed_dose_alert` (if opted in) |
| `evening_summary` | yes | `evening_summary` (if opted in) |
| others | yes | no |

**Data it reads** through `AlertDataSource` (services/api implements it over Postgres):
person (nickname, time zone), the account holder (phone, app language, time zone, WhatsApp
opt-in, push tokens), doses by id, doses of a local date, and `removePushToken` for dead tokens.
The job carries ids only; names and statuses are read at send time, so:

- a missed alert is skipped if the family marked the doses taken meanwhile, and lists only the
  doses still missed;
- deleted people and accounts get nothing (rule 9).

Texts use the family's words verbatim (rule 1). Times are shown in the parent's time zone, with
the zone name added when the child's time zone differs (rule 7).

**Exactly once** (rule 6, gate "2 retries, then missed, then exactly one alert"): BullMQ ignores
a second enqueue with the same jobId; inside a job each channel is claimed in the
`IdempotencyStore` as `<jobId>:push:<userId>` / `<jobId>:whatsapp:<userId>`. A retried job only
re-sends channels that failed temporarily. A permanent failure is logged (phone masked) and not
retried. If the process dies between sending and recording, the claim expires after 10 minutes
and that one channel may be sent again (at-least-once in that crash case only).

```ts
startAlertWorker(
  { data, push: createPushSenderFromEnv(process.env), whatsapp: createWhatsAppSenderFromEnv(process.env),
    idempotency: new RedisIdempotencyStore(redis), logger, androidChannelId: 'alerts' },
  { connection, prefix },
);
```

## Testing

```
pnpm --filter @tasalli/integrations test
REDIS_URL=redis://localhost:6379 pnpm --filter @tasalli/integrations test   # also runs Redis-backed tests
pnpm --filter @tasalli/integrations lint                                     # tsc --noEmit
```

## Adding real providers later

Each real provider is a new class implementing the existing interface, chosen by an env var
in the matching `create...FromEnv` factory. Nothing that calls the interface changes.

### SMS OTP (for example MSG91)

1. Founder: register the sender ID (header) and the OTP template on the DLT portal; get the
   DLT entity ID and template ID. Template text must match what we send exactly.
2. Add `Msg91OtpSender implements OtpSender` reading `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`
   (and the DLT template ID configured on that MSG91 template) from env. We generate and check
   the code ourselves in `OtpService`; the sender only delivers it.
3. International numbers: either the same provider's international route or a second
   `OtpSender`, wired with `RoutingOtpSender(domestic, international)`.
4. Add `OTP_PROVIDER=msg91` to `createOtpSenderFromEnv`, with a test that uses recorded
   request/response payloads and an injected `fetch`.

### WhatsApp (Meta Cloud API, Gupshup, Exotel or another BSP)

1. Founder: WhatsApp Business account, a verified sender number, and the two templates in
   `docs/whatsapp-templates.md` approved in `en` and `hi` under the same names.
2. Add e.g. `MetaWhatsAppSender implements WhatsAppSender`. For the Meta Cloud API that is
   `POST https://graph.facebook.com/{version}/{WHATSAPP_PHONE_NUMBER_ID}/messages` with
   `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}` and body
   `{ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code },
   components: [{ type: "body", parameters: [{ type: "text", parameter_name, text }] }] } }`.
   Map `locale` to the provider's language code (`en`, `hi`). Throw `WhatsAppSendError` with
   `retryable` set from the HTTP status.
3. If the provider sends delivery-status webhooks, verify their signature (Meta:
   `X-Hub-Signature-256`, HMAC-SHA256 of the raw body with the app secret; use
   `verifyHmacSha256Hex`) and dedupe by message id + status with `IdempotencyStore`.
4. Add the provider to `createWhatsAppSenderFromEnv`, test with recorded payloads.
