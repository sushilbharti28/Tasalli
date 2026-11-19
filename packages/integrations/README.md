# @tasalli/integrations

Outside-service integrations for Tasalli. Each one is an interface, a fake for tests,
and, where the service is free, a real implementation.

Founder rule (Nov 2026): **no integrations with services that cost money yet.** So MSG91,
the WhatsApp Business API and Razorpay are interfaces plus fakes only. See
[Adding real providers later](#adding-real-providers-later).

| Integration | Interface | Real implementation | Fake / dev |
| --- | --- | --- | --- |
| OTP by SMS | `OtpSender` + `OtpService` | none yet (paid) | `FakeOtpSender`, `DevConsoleOtpSender` |

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
