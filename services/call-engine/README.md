# call-engine

Scheduler, call flows and telephony for Tasalli reminder and consent calls.
Provider: **Twilio** (free trial) behind `TelephonyProvider`; `FakeProvider` for tests and local work.
Speech: Twilio `<Say>` (Hindi voice) for output and `<Gather input="dtmf speech" language="hi-IN">` for replies, so no separate TTS or STT service. `SpeechProvider` stays in the contract; the fake is used.

## Commands

```
pnpm --filter call-engine test        # 70 tests, FakeProvider and recorded Twilio payloads, no network
pnpm --filter call-engine lint        # tsc
pnpm --filter call-engine dev         # webhook server on PORT (default 8080); FakeProvider unless TELEPHONY_PROVIDER=twilio
pnpm --filter call-engine test-call +91XXXXXXXXXX   # one real consent-style call, see below
```

## Environment (names only; never commit values)

| Variable | Needed for |
| --- | --- |
| `TELEPHONY_PROVIDER=twilio` | use Twilio (otherwise FakeProvider) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio REST and signature check |
| `TWILIO_FROM_NUMBER` | caller ID (E.164), a number owned by your Twilio account |
| `PUBLIC_BASE_URL` | URL Twilio can reach, no trailing slash (the tunnel URL when local) |
| `PORT` | default 8080 |
| `DATABASE_URL`, `REDIS_URL` | Postgres and BullMQ. Unset = in-memory store and queue (local only) |
| `SCRIPTS_DIR` | optional `packages/scripts` folder; files override the built-in Hindi/English lines |
| `TWILIO_*` voices | edit `VOICES` in `src/providers/twilio.ts` (hi and en use `Polly.Aditi`) |

## Try a real call locally (free tunnel)

1. Install cloudflared and start a quick tunnel to the port the engine will use:
   `cloudflared tunnel --url http://localhost:8080`
   It prints `https://<random>.trycloudflare.com`. The URL changes every run.
2. Export the environment (use your shell or a git-ignored `.env`):
   ```
   export TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+1...
   export PUBLIC_BASE_URL=https://<random>.trycloudflare.com
   ```
3. `pnpm --filter call-engine test-call +91XXXXXXXXXX`. It starts a throwaway webhook server on `PORT`,
   places a consent call through the real consent flow, and prints what happened (key pressed or words heard, consent result).
   Answer, then press 1 or say "haan"; 9 to test opt-out; say "nahi" to test the negative path.
4. For the full engine instead (`pnpm --filter call-engine dev` with `TELEPHONY_PROVIDER=twilio`), Twilio posts to
   `PUBLIC_BASE_URL/webhooks/twilio/status` and `/webhooks/twilio/input`. If the tunnel URL changes, restart with the new `PUBLIC_BASE_URL`
   (the URL is part of the signature Twilio computes; a mismatch gives 401).

## Twilio trial limits

- Calls only go to **verified numbers** (Console > Phone Numbers > Verified Caller IDs). Verify the founder's and any tester's phone first.
- The trial account has a **non-Indian caller ID** (a US/other Twilio number). The parent's phone shows that number; Indian numbers cannot be used as caller ID on trial. This is fine for testing, not for production.
- Trial calls begin with a Twilio message ("You have a trial account... press any key") before our script plays. Press any key to continue.
- Enable calls to India: Console > Voice > Settings > Geo permissions > India (off by default).
- Trial credit is limited; calls are short, and the 3 test calls/day cap per user applies to `test.call` jobs.
- Speech recognition on trial uses Twilio's default model; keys 1/2/0/3/9 always work as the fallback.
- Production later needs a paid account, Indian regulatory registration (TRAI/DLT, an Indian caller ID or a compliant route). Not in scope now.

## How it works

- `src/engine/scheduler.ts`: `schedule.replan` creates doses for the next 48 h in the parent's time zone and one delayed `dose.due` job per dose.
  When one fires, doses due within 30 minutes join one call group. Nothing is planned for people who are not `consented`, are paused, or whose number is blocked.
- `src/engine/calls.ts`: places consent, reminder and test calls. The 6/number/day cap (parent's local day, across accounts) and the block check run under a per-phone lock.
  Retries: 2 more calls, 10 minutes apart, then the doses are `missed` and a `dose_missed` alert is queued. Snooze once (15 min).
- `src/engine/flows.ts`: reply handling. Keys 1/2/0/3/9 and spoken replies; negative phrases first; unclear -> ask once -> keypad only -> goodbye; silence never confirms.
  Key 9 or a stop phrase (Hindi or English) blocks the number everywhere and opts out every person on it.
- `src/engine/engine.ts`: job dispatcher and `handleWebhook`: verifies the signature, records each event id once, serialises per call, replays the same reply for a repeated input, ignores terminal statuses after the call ended.
- Twilio: `src/providers/twilio.ts`. "Audio URLs" are `say:<lang>:<base64url text>`; the adapter turns them into `<Say>`. Webhook URLs carry `?c=<callId>&n=<nonce>`, so a retried request is the same event.
- Full flow tables and alerts consumed by other services: queue names and payloads are in `src/queue/jobs.ts`.

## Contract changes requested (not made here)

1. `TelephonyProvider.name` should include `'twilio'` (the adapter casts for now).
2. `renderNextAction(next, ctx?: { callId: string })`: optional second argument; Twilio needs the call id for the next webhook URL.
3. `CallEvent` speech: optional `confidence?: number` (Twilio returns it).
4. `packages/contracts/package.json`: `"type": "module"` so tsx can import its runtime values (`src/contracts-values.ts` is a synced copy until then).
5. `DoseStatus`: a `cancelled` value for doses removed by a schedule edit.
