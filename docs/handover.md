# Handover: where Tasalli stands (23 Nov 2026)

Read this with `CLAUDE.md` at the start of a new session. It records what is built, how to run it, the founder's decisions, and what is next.

## Status

Version 1 runs end to end on the founder's Mac with real Twilio calls (trial account) and fakes for everything paid. About 1,000 automated tests pass (`pnpm -r test` with Postgres and Redis running).

| Part | Path | State |
| --- | --- | --- |
| Backend API | `services/api` (NestJS) | Built: OTP sign-in (fake SMS), people + consent, medicines + schedules, look-alike check, doses, billing on a fake provider with 3-day grace, extra reminder endpoint |
| Call engine | `services/call-engine` | Built and tested on real calls: consent call, step-by-step reminder call, Twilio adapter, recordings copied locally then deleted from Twilio |
| Integrations | `packages/integrations` | Fakes for OTP, WhatsApp, billing; FCM push (free); alert worker |
| Call scripts | `packages/scripts` | Hindi + English active; bn/mr/ta/te drafted, disabled |
| Child app | `apps/mobile` (Expo) | Built, runs in mock mode; not yet connected to the real API on a phone |
| Admin console | `apps/admin` (Next.js) | Built: families, consent and call logs, block list, pause, metrics |
| Contracts | `packages/contracts` | OpenAPI, DB schema, call-engine interfaces |

## Running it on the Mac

```bash
cd ~/Tasalli
git pull && pnpm install
docker compose up -d postgres redis          # Docker Desktop must be open
DATABASE_URL=postgres://tasalli:tasalli@localhost:5432/tasalli pnpm --filter @tasalli/api migrate   # once, and after schema changes
cloudflared tunnel --url http://localhost:8080   # separate tab; copy the https address
# put that address in .env as PUBLIC_BASE_URL and CALL_ENGINE_PUBLIC_BASE_URL
pnpm --filter call-engine test-call +91XXXXXXXXXX      # consent call
pnpm --filter call-engine test-reminder +91XXXXXXXXXX  # 3-medicine reminder (add --split for separate calls)
pnpm --filter call-engine dev                          # long-running engine; GET /health on the tunnel should say ok
```

Notes:
- `.env` is at the repo root and is git-ignored. The call engine reads it itself; never use `set -a; source .env` (stale values then override `.env`).
- `CALL_ENGINE_PORT=8080`; the API uses `PORT=3000`.
- The quick tunnel address changes on every restart: update both URL lines in `.env`. A free named Cloudflare tunnel with a fixed address is a pending task.
- `test-call` / `test-reminder` start their own server on 8080, so stop `dev` first.
- Twilio trial: only verified numbers, a non-Indian caller ID, and a trial notice before our audio.

## Founder decisions (do not change without asking)

Calls:
- Hindi only for now. Voice `Google.hi-IN-Chirp3-HD-Aoede` (override with `TWILIO_VOICE`). SSML: 90% rate; pauses 200 ms at a comma, 350 ms at a sentence end, 700 ms before the question after each medicine (24 Nov 2026: 85% felt slow, 95% too fast).
- Consent call: presence check first, names the relation and child ("aapke bete Rahul…"), announces recording. Reminder calls never mention the child or relation.
- Reminder call (v1.6 wording, 24 Nov 2026): "Namaste Ramesh ji." Then who is calling and why ("Hum Tasalli se bol rahe hain. Aapko dopahar ke khane ke baad wali teen dawaiyon ki yaad dilane ke liye phone kiya hai. Dawaiyon ke baare mein sunne ke liye, haan boliye, ya 1 dabaiye."); that yes is the presence check. Then all choices once (haan/1, phir se/0, nahi/2), then one medicine at a time: "Aapki pehli dawai, {amount} {printed name} {strength} ki hai. Ise aap {spoken name} kehte hain." plus look and pack as short sentences, a longer pause, "Dawai lene ke baad, haan boliye, ya 1 dabaiye." Full Roman text: `docs/call-scripts.md`.
- Calls greet the parent by the first word of their full name ("Namaste Ramesh ji"), never by the nickname ("Mummy", "Papa" is the family's word, not a name). No full name: "Namaste ji".
- Prompts never ask for "le li" (it was misheard); a clear "le li" still confirms. Unclear speech gets one re-ask with the same choices (speech or key; rule 4 updated); a medicine with no usable answer: "Maaf kijiye, kisi wajah se is dawai ka jawab darj nahi ho paaya. Hum agli dawai par chalte hain. Chinta mat kijiye, is dawai ke liye hum aapko phir phone karenge." The call-again promise is only said when a call really follows (retry or 15-minute reminder left).
- Sizes are three: very small, small, large (bahut chhoti si / chhoti si / badi si). The call maps the app's older five (rai, dal/matar, badam/bigger); the app and contract change to three is the next PR.
- All numbers are spoken as Hindi words (ek, ek sau bees milligram, aadha, dedh). Stored data stays verbatim.
- One call groups only doses with the same 30-minute window and the same food timing.
- Time limit: 180 s for up to 5 medicines, +40 s for each extra; Twilio TimeLimit is 30 s more as a backstop.
- Safety rules in `CLAUDE.md` (never compute doses, appearance-only look-alike check, no call before consent, negatives before positives, caps, idempotency).

Product:
- Failed payment: reminders continue for 3 days from `past_due_since`, then pause; the child gets one "calls paused, payment due" push + WhatsApp per day.
- Recordings: consent and reminder calls are recorded (test calls are not); copied to `RECORDINGS_DIR` and deleted from Twilio after the copy is verified. Retention period not decided (suggested 90 days). Production storage must be in the Mumbai region.
- No paid services for now except the Twilio trial. Exotel/Plivo, MSG91, WhatsApp, Razorpay and cloud hosting are interfaces with fakes until the founder decides to spend.
- Helper web link is a later iteration.
- New people must be Hindi; other languages come later.

## Working style

- The founder wants speed and automation: merge PRs once tests pass, then tell the founder what changed. Ask before changing call wording or product behaviour.
- Agents: definitions in `.claude/agents/`. Run at most two at a time to stay within usage limits; use a lighter model for routine coding.
- Do not commit `.env`, recordings (`.recordings/`) or secrets.

## Pending work

1. `caller_relation` on people (son, daughter, grandson, granddaughter, daughter_in_law, son_in_law, other): contracts, API, app "your relation to them" field. The call engine already reads it if present.
2. Fixed-address Cloudflare named tunnel (free account).
3. Run the mobile app against the real API on a phone (Expo Go); full flow: add parent, consent call, add medicine, reminder call.
4. Admin console reads recordings through the call engine's `/internal/recordings` with `RECORDINGS_READ_TOKEN`; support notes API on the new `support_notes` table.
5. Hardening: admin login throttling, OTP rate limit per IP, confirm step for "mark as taken" in the app, end-to-end test (consent → dose → call), load test.
6. Founder inputs: recording retention period, native-speaker review of `packages/scripts/hi.yaml`, doctor review of scripts, lawyer review of `docs/content/` policy and terms, Firebase project for push.
7. Before a pilot with other families: business registration (sole proprietorship is enough), Indian caller ID (Exotel or paid Twilio), Mumbai hosting and recording storage, paid SMS/WhatsApp/payments, Play Store account.
