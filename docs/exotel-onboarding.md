# Exotel: onboarding and what is left

Status: 26 Nov 2026. The adapter is built and tested in code (`services/call-engine/src/providers/exotel*.ts`). It has **not** run on a live Exotel account yet: that needs the business registration and KYC below.

## Why Exotel

| | Twilio (now) | Exotel |
| --- | --- | --- |
| Caller ID in India | Only **non-Indian** numbers can call India (Twilio India guidelines), so parents see a +1 number | Indian numbers (ExoPhones), and the TRAI **1601 series** for service and transactional calls by entities outside banking and government (TRAI direction, Aug 2026) |
| Price | About $0.0496/min to Indian mobiles (Twilio pricing page) | Quote-based, billed per pulse. **Get a written quote.** |
| Speech | Built in (`<Say>`, `<Gather>` speech) | **Not built in.** Audio comes over a WebSocket (Voicebot applet); we do speech-to-text and text-to-speech |

## Onboarding checklist (founder)

1. **Business registration.** A sole proprietorship is enough. Exotel KYC for a sole proprietorship asks for a **GST certificate or Shop & Establishment licence**, a **PAN**, and the **proprietor's ID proof**.
2. **Exotel account.** Sign up for a trial. The trial works during KYC review, with limited outbound minutes.
3. **KYC.** Upload the documents under My Account, then KYC docs. You can't buy ExoPhones or go live until KYC is approved.
4. **Sales call.** Use the questions below, and get the quote in writing.
5. **Numbers.** Buy an ExoPhone. Apply for a **1601-series** number (only registered entities get one; ask Exotel to help with the registration).
6. **Compliance.** Ask Exotel how DND/NCPR scrubbing applies to consented service calls. Our consent call is recorded and logged (`consent_events`). Have the lawyer confirm this too (handover item 6).
7. **Call flow.** In the Exotel dashboard (App Bazaar), create an app with:
   - a **Voicebot** applet: URL `wss://<call-engine public host>/exotel/voicebot?t=<EXOTEL_WEBHOOK_SECRET>`, sample rate **8000**;
   - then a **Hangup** applet.

   Note the app id for `EXOTEL_APP_ID`.

### Questions for the Exotel sales call
- Per-minute outbound rate to Indian mobiles, and the pulse size (15, 30 or 60 seconds).
- Calls per second and concurrent channels on each plan. We need about 20 concurrent at peak for 100 parents, and it must be raisable.
- Voicebot applet: is it included or priced extra, and is 8 kHz stable? Expected audio latency?
- 1601-series allotment for a sole proprietorship providing health reminder service calls: steps, cost and timeline.
- DND/NCPR: are consented transactional calls exempt? Do they scrub automatically?
- Data residency: is the API and media served from India (a Mumbai cluster)? Which API host should we use?
- Recordings: where are they stored, how do we fetch and delete them via the API, and what is the retention?
- Status callback: exact fields and the date format.

## Configuration (call engine)

```
TELEPHONY_PROVIDER=exotel
EXOTEL_ACCOUNT_SID=...
EXOTEL_API_KEY=...
EXOTEL_API_TOKEN=...
EXOTEL_SUBDOMAIN=api.exotel.com          # or the India cluster host Exotel gives you
EXOTEL_APP_ID=...                        # the call flow with the Voicebot applet
EXOTEL_WEBHOOK_SECRET=<long random>      # in the status URL and the Voicebot URL
CALLER_ID=<ExoPhone or 1601 number>
MAX_CALLS_PER_SECOND=...                 # from the Exotel plan
MAX_CONCURRENT_CALLS=...
```

## How it works

1. `ExotelProvider.placeCall` calls `POST /v1/Accounts/{sid}/Calls/connect.json` with `From`= the parent, `CallerId`, `Url`= our call flow, `CallType=trans`, `TimeLimit`, and `StatusCallback`= `/webhooks/exotel/status?c=<callId>&t=<secret>`.
2. When the parent answers, Exotel opens `wss://.../exotel/voicebot`. The endpoint refuses any connection without the secret.
3. `VoicebotSession` runs the conversation:
   - It speaks each prompt through `SpeechProvider.synthesize` as 100 ms PCM chunks, then sends a `mark`.
   - Only when Exotel echoes the mark (the prompt has played in full) does it listen. This is the same "listen only from the question" safety rule as on Twilio.
   - A key press goes to the engine at once. Speech is detected by loudness, ends after 1 s of quiet, and goes to `SpeechProvider.transcribe`. Silence for the listen time becomes a silence event.
4. Every input goes to `Engine.handleEvent`, the same path Twilio webhooks take: de-duplication (rule 6), "no" before "yes" (rule 4), confidence rules, retries, caps.

## What is left (engineering)

1. **A real SpeechProvider.** Today only `FakeSpeech` exists, so an Exotel call would be silent. It must return 8 kHz 16-bit mono PCM (`audio/l16`) or a WAV at that rate.
   - **Speech to text:** Deepgram nova-2 (Hindi, `hi`) did best on our Twilio calls; Sarvam and Google are the alternatives.
   - **Text to speech:** Google Cloud TTS `hi-IN-Chirp3-HD-Aoede` keeps today's voice; Sarvam Bulbul is the alternative.
   - Both need paid API keys: a founder decision.
2. **Speaking pace.** Twilio used SSML (90% rate and pauses). Set the TTS speaking rate to match, and render the longer pause as silence between parts.
3. **Recordings.** Add the Exotel recording URL fetch and delete, to replace the Twilio recording client.
4. **A live test** on the Exotel trial: the consent call, then a reminder call. Compare answer rate and recognition with Twilio.
5. **Multi-instance.** `ExotelProvider` keeps each call's first prompt in memory until its stream starts, so it needs a single call-engine instance for now (same as the webhook lock).

## Sources
- Exotel Voicebot applet: https://developer.exotel.com/docs/agentstream/stream-voicebot-applet
- Exotel connect to call flow: https://developer.exotel.com/docs/voice-v1/api-reference/connect-to-flow
- Exotel KYC: https://developer.exotel.com/docs/getting-started/kyc-verification and https://developer.exotel.com/docs/faqs/account-setup
- Exotel DND: https://developer.exotel.com/docs/faqs/ndnc-dnd ; 1600/1601 numbers: https://exotel.com/blog/1600-phone-number/
- TRAI 1601 direction (Aug 2026): https://www.trai.gov.in/sites/default/files/2026-08/Direction_10082026.pdf
- Twilio India voice guidelines: https://www.twilio.com/en-us/guidelines/in/voice ; pricing: https://www.twilio.com/en-us/voice/pricing/in
