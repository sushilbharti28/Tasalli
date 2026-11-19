# Local setup

Everything runs on a laptop with fake providers. No vendor accounts, no cloud, no cost.

## Prerequisites

- Node 20 LTS (`nvm use` reads `.nvmrc`). Node 22 also works.
- pnpm 9: `corepack enable` (the version comes from `packageManager` in `package.json`).
- Docker with Compose v2, for Postgres 16 and Redis 7. If you already run Postgres or Redis
  locally, either stop them or set `POSTGRES_PORT` / `REDIS_PORT` before `docker compose up`.

## First run

```sh
cp .env.example .env          # local defaults; TELEPHONY_PROVIDER=fake, SPEECH_PROVIDER=fake
pnpm install
pnpm db:up                    # docker compose up -d postgres redis
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

The Postgres container creates two databases on first start: `tasalli` (dev) and
`tasalli_test` (tests). Credentials are `tasalli` / `tasalli`, local only.

Reset all local data: `docker compose down -v` (deletes the volumes).

## Whole system with one command

```sh
cp .env.example .env    # if you have not already
pnpm stack:up           # docker compose --profile app up --build
```

| Service | URL | Image |
| --- | --- | --- |
| api | http://localhost:3000 (health: `/health`) | `infra/docker/service.Dockerfile` |
| call-engine | http://localhost:3001 | `infra/docker/service.Dockerfile` |
| admin | http://localhost:3002 | `infra/docker/admin.Dockerfile` |
| postgres | localhost:5432 | `postgres:16-alpine` |
| redis | localhost:6379 | `redis:7-alpine` |

Ports can be moved with `API_PORT`, `CALL_ENGINE_PORT`, `ADMIN_PORT`, `POSTGRES_PORT`, `REDIS_PORT`.
App containers read `.env`, then compose points them at the compose Postgres and Redis.
Telephony and speech stay on the fake providers unless you set `TELEPHONY_PROVIDER` /
`SPEECH_PROVIDER`. Stop with `pnpm stack:down`.

A service is built only once its package exists (`services/api`, `services/call-engine`,
`apps/admin`). Until then, start just the data stores with `pnpm db:up`.

Image contract (what the Dockerfiles expect from each package):

- Package name `@tasalli/api`, `@tasalli/call-engine`, `@tasalli/admin`.
- `build` script. Services emit to `dist/` and start with `node dist/main.js`
  (override with `--build-arg ENTRY=...`). Admin emits `.next/` and runs `next start`.
- Runtime dependencies in `dependencies`, build tools in `devDependencies`
  (the image keeps only production dependencies).
- api answers `GET /health` with 2xx (compose healthcheck and uptime check use it).

## Day to day

| Task | Command |
| --- | --- |
| Run one package's tests | `pnpm --filter @tasalli/<pkg> test` |
| API in watch mode | `pnpm --filter @tasalli/api dev` |
| Call engine with FakeProvider | `pnpm --filter @tasalli/call-engine dev` |
| Fix formatting | `pnpm format` |
| Open a psql shell | `docker compose exec postgres psql -U tasalli` |
| Redis CLI | `docker compose exec redis redis-cli` |

## Environment variables

`.env.example` lists every variable the system reads, grouped by area. Rules:

- Code reads variables by name only. Never hard-code a key, never commit `.env`.
- Empty vendor keys are normal locally: the fake providers are used instead.
- `SENTRY_DSN` empty means Sentry is off. It is optional and needs no account to develop.
- If you add a new variable, add it to `.env.example` (with a comment) in the same PR.

## Lockfile policy

- `pnpm-lock.yaml` is committed at the root and owned by the devops agent.
- Other agents and contributors: install with `pnpm install --no-frozen-lockfile` and do not
  include `pnpm-lock.yaml` in your PR. Devops refreshes the lockfile after dependency changes land.
- CI installs with `--frozen-lockfile` when the lockfile matches, and falls back to a normal
  install (with a warning) while package PRs land in parallel. Once version 1 settles the
  fallback is removed and a stale lockfile fails CI.

## Package conventions

- `package.json` name `@tasalli/<pkg>`; scripts any of `build`, `typecheck`, `lint`, `test`.
  Root scripts run them recursively with `--if-present`, so CI does not break on packages
  that do not exist yet or lack a script.
- `tsconfig.json` extends `../../tsconfig.base.json`.
- ESLint uses the shared root `eslint.config.mjs`; a package can add its own config that
  imports and extends it.
- Tests needing a database use `TEST_DATABASE_URL`; CI provides Postgres 16 and Redis 7.
