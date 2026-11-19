# Hosting later

Founder rule for now: nothing that costs money is set up. The whole system runs locally
(`pnpm stack:up`) and CI runs on GitHub Actions. This note lists options for when the pilot
needs a public URL. Nothing here has been signed up for.

## Constraints any option must meet

- Health data stays in India (safety rule 9): database, Redis, audio and recordings in an
  Indian region (Mumbai `ap-south-1` / `asia-south1`, or Hyderabad / Delhi).
- Managed Postgres with automated daily backups and point-in-time restore, and a tested restore.
- Redis that never evicts keys (`maxmemory-policy noeviction`) because BullMQ holds scheduled calls.
- A secret store; the code already reads every key from env vars by name (`.env.example`).
- A public HTTPS URL for provider webhooks (`PUBLIC_BASE_URL`).

## Options, cheapest first

| Option | What it looks like | Notes |
| --- | --- | --- |
| One VM in Mumbai | Run `docker compose --profile app up -d` on a single VM; Caddy in front for free HTTPS; nightly `pg_dump` to object storage in India | Lowest cost and closest to local setup. Backups and patching are on us. Fine for a 50-family pilot. |
| Container platform with an India region | Images from `infra/docker/*` on a managed container service; managed Postgres and Redis in the same region | Less ops. Check that the database and Redis are really hosted in India, not only the app. |
| AWS ap-south-1 | ECS Fargate (api, call-engine), RDS Postgres with backups, ElastiCache Redis, ALB with HTTPS, Secrets Manager, S3 for audio, CloudWatch alarms | Most robust and most expensive. Terraform can be written when chosen. |
| GCP asia-south1 | Cloud Run, Cloud SQL, Memorystore, Secret Manager, Cloud Storage | Similar to AWS. Natural if Google Speech is chosen. |

## What carries over unchanged

- Images: `infra/docker/service.Dockerfile`, `infra/docker/admin.Dockerfile`.
- Config: env var names in `.env.example`.
- Monitoring: `infra/monitoring/*.sh` run from cron or any scheduler.
- CI already builds the images on every PR, so a deploy step only needs to push and roll out.

## Before choosing, the founder decides

- Budget per month for the pilot.
- Domain name (for `PUBLIC_BASE_URL` and provider webhook allow-lists).
- Who holds the cloud account and the billing.
