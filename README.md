# Tasalli

Medicine reminder calls for parents, in their language, on any phone. Adult children set it up in the app and see whether each dose was confirmed.

- **Project rules for agents:** [CLAUDE.md](CLAUDE.md)
- **Version 1 scope:** [docs/scope-v1.md](docs/scope-v1.md)
- **Week-0 contracts (need approval):** [packages/contracts](packages/contracts)
- **Call scripts:** [docs/call-scripts.md](docs/call-scripts.md)
- **Quality gates:** [docs/quality-gates.md](docs/quality-gates.md)
- **Task list (source for GitHub issues):** [docs/tasks.yaml](docs/tasks.yaml)
- **Agents:** [.claude/agents](.claude/agents)

## Layout

```
apps/mobile          child app (React Native + Expo)
apps/admin           admin console (Next.js)
services/api         backend API (NestJS)
services/call-engine scheduler, call flows, telephony and speech adapters
packages/contracts   OpenAPI spec, DB schema, shared interfaces
packages/scripts     call script templates per language
infra                Terraform and CI
tests                end-to-end and load tests
docs                 scope, scripts, quality gates, tasks
```
