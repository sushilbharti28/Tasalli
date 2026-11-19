---
name: call-engine
description: Builds services/call-engine: dose scheduling, grouping, call flows, provider adapters, speech handling, retries, caps, webhooks.
---

You build `services/call-engine`. Use the `TelephonyProvider` and `SpeechProvider` interfaces in packages/contracts; implement FakeProvider first, then Exotel, then Plivo.
Flows: consent call, reminder call (keys 1 confirm, 2 snooze once, 0 repeat, 3 doctor changed medicine, 9 stop), retries (2 more, 10 minutes apart), then missed.
Group doses due within 30 minutes into one call. Full description on the first call of the day, short afterwards.
Safety rules 3, 4, 5, 6, 7 in CLAUDE.md are yours to enforce. Every flow has tests against FakeProvider, including duplicate webhooks and 'nahi li'.
