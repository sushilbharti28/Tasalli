# Release: Android app (Expo EAS) and backend

Status: guidance only. Nothing is set up that costs money. The mobile agent owns
`apps/mobile` (including `eas.json` and `app.config.*`); devops owns this runbook.
Production releases happen only after the founder approves.

## Tracks

| Stage | Who sees it | Gate to move on |
| --- | --- | --- |
| Local build (`eas build --local` or `expo run:android`) | Developers | CI green |
| Play internal testing | Founder + up to 100 named testers | Founder smoke test on real phones |
| Play closed testing | Pilot families | Quality gates in `docs/quality-gates.md` pass on staging, founder approval |
| Production | Everyone | Founder approval, Play pre-launch report clean, no medical claims in the listing |

## What the mobile agent adds in `apps/mobile` (suggested `eas.json`)

```json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "env": { "APP_ENV": "dev" } },
    "preview": { "distribution": "internal", "android": { "buildType": "apk" }, "env": { "APP_ENV": "staging" } },
    "production": { "autoIncrement": true, "android": { "buildType": "app-bundle" }, "env": { "APP_ENV": "prod" } }
  },
  "submit": {
    "production": {
      "android": { "serviceAccountKeyPath": "./play-service-account.json", "track": "internal", "releaseStatus": "draft" }
    }
  }
}
```

- `track: internal` first; change to `alpha` (closed testing) only after founder approval.
- `play-service-account.json` is a secret: never commit it (add it to `apps/mobile/.gitignore`);
  on EAS, upload it as a secret file instead.
- The app reads its API URL from `app.config.*` via `APP_ENV`, never hard-coded keys.
  Only public values (API base URL, Sentry DSN for the app) go into the app bundle.
- Firebase `google-services.json` is needed for push; keep it out of git and provide it
  as an EAS secret file.

## Steps, once the founder has the accounts

1. `cd apps/mobile && npx eas-cli login` (founder's Expo account), `npx eas-cli init`.
2. Build: `npx eas-cli build -p android --profile production`.
   Free alternative with no build quota: `npx eas-cli build -p android --profile production --local`
   (needs Android SDK + JDK 17 on the machine).
3. First upload to Play must be manual: Play Console > Testing > Internal testing > Create release,
   upload the `.aab`. After that: `npx eas-cli submit -p android --profile production`.
4. Add testers (email list) in Play Console; share the opt-in link.
5. Record the version, build number and commit SHA in the release PR / GitHub release notes.

## Backend release (local or hosted later)

- Merges to `main` are done by the founder only. CI must be green.
- There is no deploy pipeline yet (no hosting, see `hosting-later.md`). Running a release locally:
  `git pull && pnpm stack:up`.
- Before any schema migration on a database with real data: take a backup with
  `infra/scripts/db-backup.sh` and confirm the restore works (`db-restore.sh` into a scratch database).

## Founder must provide before the first Play build

- Google Play developer account (one-time registration fee; founder decision).
- Expo account (free plan has a monthly cloud build quota; `--local` builds avoid it).
- A Play service-account JSON with release permissions, for `eas submit`.
- Firebase project for push (`google-services.json`, FCM service account).
- Store listing text reviewed for no medical claims; privacy policy URL.
