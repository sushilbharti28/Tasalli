# Tasalli: project rules for every agent

Tasalli sends automated medicine reminder calls to elderly parents in India, in their language, on any phone. Adult children set it up in an Android app and see whether each dose was confirmed. The parent confirms by saying a short phrase ("le li", "haan") or pressing 1.

The execution plan (scope, workstreams, timeline, quality gates) is the source of truth for what to build. Version 1 scope is in `docs/scope-v1.md`.

## Repository layout

| Path | What lives there | Owner agent |
| --- | --- | --- |
| `apps/mobile` | Child app, React Native + Expo, Android first | mobile |
| `apps/admin` | Admin console (Next.js), helper link later | web |
| `services/api` | Backend API, NestJS + TypeScript | backend |
| `services/call-engine` | Scheduler, call flows, provider adapters, speech | call-engine |
| `packages/contracts` | OpenAPI spec, DB schema, shared types, call events | lead (changes need founder approval) |
| `packages/scripts` | Call script templates per language | content |
| `infra` | Terraform, CI, environments | devops |
| `tests` | Cross-service end-to-end and load tests | qa |
| `docs` | Scope, decisions, runbooks | lead |

Work only inside the paths your agent owns. If you need a change elsewhere, open an issue and tag the owning agent.

## Stack

- TypeScript everywhere. Node 20 LTS. pnpm workspaces.
- Postgres (managed, Mumbai region). Redis + BullMQ for scheduled jobs.
- Telephony: Exotel first, Plivo fallback, always behind the `TelephonyProvider` interface in `packages/contracts`. A `FakeProvider` exists for tests and local work.
- Speech: Sarvam or Google, behind `SpeechProvider`. Decision pending (week 1).
- Messaging: MSG91 (OTP SMS), WhatsApp Business templates, Firebase push. Payments: Razorpay subscriptions.

## Safety rules (never break these)

1. **The app never computes, suggests or changes a dose.** It repeats exactly what the family entered.
2. **The app never compares what is inside medicines** (composition, brand equivalence). The look-alike check compares appearance fields only.
3. **No call before consent.** A person must be `consented` before any reminder is scheduled. Key 9 (or a stop phrase) blocks the number across all accounts immediately.
4. **"No" beats "yes".** Speech handling checks negative phrases ("nahi", "nahi li", "baad mein") before positive ones. Unclear speech is never a confirmation: ask once more (speech or keypad), and if it is still unclear leave the dose unconfirmed.
5. **Caps:** at most 6 calls per phone number per day across all accounts; at most 4 people per account.
6. **Exactly once.** Every provider webhook is idempotent. A repeated webhook never creates a second call or a second confirmation.
7. **Times are stored in the parent's time zone** and converted only at the edges.
8. **No secrets in the repository.** Read keys from environment variables by name. Never log phone numbers in full (mask all but the last 4 digits).
9. **Health data stays in India** (Mumbai region) and is deleted on request.

## How to work

- One task = one GitHub issue = one branch = one pull request. Branch name: `<agent>/<issue-number>-short-name`.
- Contracts first: if your change needs an API, schema or event change, propose it in `packages/contracts` in its own PR and wait for founder approval.
- Every PR includes tests. CI must pass. Keep PRs small (under ~400 changed lines where possible).
- PR description: what changed, how it was tested, which safety rules it touches.
- Do not merge your own PR. The founder merges.

## Commands

Node 20 (`.nvmrc`), pnpm 9 (`packageManager` in root `package.json`). Full guide: `docs/runbooks/local-setup.md`.

```
cp .env.example .env              # local defaults, fake providers, no real keys
pnpm install
docker compose up -d postgres redis   # or: pnpm db:up
pnpm build                        # every package that has a build script
pnpm typecheck                    # tsc --noEmit in every package
pnpm lint                         # eslint in every package (shared eslint.config.mjs)
pnpm test                         # all unit tests
pnpm format                       # prettier --write
pnpm --filter @tasalli/api dev
pnpm --filter @tasalli/call-engine dev   # uses FakeProvider unless TELEPHONY_PROVIDER is set
pnpm stack:up                     # whole system in Docker: postgres, redis, api, call-engine, admin
```

Package conventions (CI relies on them):

- Each workspace package defines whichever of `build`, `typecheck`, `lint`, `test` it supports. Root scripts run them with `--if-present`, so a missing script is skipped, not an error.
- `tsconfig.json` extends `../../tsconfig.base.json`. Depend on shared packages with `"workspace:*"`.
- Tests that need Postgres or Redis read `TEST_DATABASE_URL` / `REDIS_URL` (CI provides both).
- Lockfile: only the devops agent commits `pnpm-lock.yaml`. Other agents install with `pnpm install --no-frozen-lockfile` and leave the lockfile out of their PRs.
