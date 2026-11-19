# Tasalli test plan (maps docs/quality-gates.md to cases)

Run: `pnpm --filter @tasalli/tests test`. Scenario suites in `src/scenarios` take any engine implementing `src/harness/engine.ts`; today they run against the reference engine (`src/reference`). Call-engine PRs should plug the real engine in (follow-up).

| Gate | Cases | Status |
| --- | --- | --- |
| Right call, right time | scenarios/timezones.ts, consent.ts | done (reference engine) |
| Never twice | scenarios/idempotency.ts (duplicate/out-of-order webhooks) | done |
| Words match the data | packages/scripts tests (content agent) | owned elsewhere |
| "Nahi li" never a yes | speech/phrases/*.json, speech/suite.ts, scenarios/speech.ts | done, 6 languages |
| Speech accuracy 90%+ | needs real audio, 20+ speakers | deferred (no paid services) |
| Real networks | founder, real phones | deferred |
| Caps and opt-out | scenarios/caps.ts, optout.ts | done |
| Retries and alerts | scenarios/retries.ts, snooze.ts, grouping.ts | done |
| Privacy | scenarios/privacy.ts (log masking); security-checklist.md | log masking automated; rest manual until API is wired |
| Load 10,000 calls/day | tests/load (not built) | follow-up |
| Payments | real payments deferred; Razorpay webhook signature/idempotency tests | follow-up |
| Store ready | founder, devops | n/a |

## Follow-ups (not built)
1. Run scenario suites against `services/call-engine` once it exposes the harness interface.
2. End-to-end setup flow tests against `services/api` (needs running API + Postgres).
3. Load test: 10,000 calls/day through scheduler on FakeProvider.
4. Automated security tests from security-checklist.md.
