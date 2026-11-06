# Handoff: where things stand

Gamely was built in a cloud Claude Code session and moved to a local project on the owner's Windows PC (`D:\Users\Renzo\Desktop\Gamely-Market`, branch `ccr-86b2d07a-hyz453`). This note is what that conversation knew that the code doesn't say on its own.

## How the owner works

- Writing for them should sound human and plain. Never use em dashes.
- No paid servers. The server runs on their PC; the app must keep working when the PC is off (phone-only mode).
- They aren't a developer: give exact commands to type, one step at a time, and say which window to type them in.
- Every session ships its own work: push, restart the PC server if it changed, and send app changes as an over-the-air update (`npm run update:app`). The steps are at the end of `AGENTS.md`.
- Never ask them to paste a password, token or key into the chat. The Firebase service account key goes straight to Expo (`npm run setup:push` handles it).

## What's running on their PC

- **Server auto-start is on.** A launcher in the Windows Startup folder (`Gamely Server.vbs`) starts the server at login with no window. Check it with `npm run autostart:status`; logs are in `server/data/server.log`.
- **Auto-update is off** (turned off on 2026-11-06, since work now happens in this folder).
- `.env` (app) and `server/.env` were written by `npm run setup` for their Wi-Fi address. Rerun it if the PC's address changes.

## Verified, and not yet

| Thing | Status |
| --- | --- |
| App and server tests, lint, typecheck | Passing (41 app tests, 84 server tests). The app smoke tests have a 60 s timeout because a cold Jest cache takes over 5 s to load every screen |
| Over-the-air updates (2026-11-06) | Set up: `expo-updates`, channel `preview`, runtime version = app `version` (1.0.0). APKs built before this can't receive updates; the first APK with it needs installing once. Publish with `npm run update:app` |
| Americas (2026-11-06) | On, with the search key from Nintendo's US store page (the owner's choice; see README "Americas catalog"). Dry run: 18,694 European games linked to their US listing, 1,101 Americas-only games; Bananza US $69.99. `AMERICAS=off` in `server/.env` turns it off |
| Japan, Hong Kong, Korea (2026-11-06) | Checked live on the PC. Donkey Kong Bananza priced in JP (¥7,980), HK (HKD 449) and KR (₩79,800). See "Asian eShops" below |
| Server against the live stores | One live run on the PC: over 5,000 prices fetched, no errors |
| Server auto-start on Windows | Confirmed working |
| Auto-update (`scripts/update.mjs`) | Tested on Linux copies; the Windows Task Scheduler part hasn't run for real yet |
| APK build (`npm run build:android`) | Confirmed. R8 is turned off (`enableMinifyInReleaseBuilds: false` in app.json): SDK 58 enables it by default and it stripped WorkManager's Room database, crashing the app at launch |
| Android push (`npm run setup:push`) | Confirmed on a real phone. Firebase project `gamely-baik6i`; `google-services.json` is committed; the FCM V1 key is on Expo. A target-price alert went from the server through Expo and Firebase to the phone |
| Phone-only mode on a real phone | Confirmed: with the server stopped, deals and the watchlist still load |

The cloud session couldn't reach the stores, Expo, or Expo's docs, so anything touching those was written from documented formats and tested with samples. Working locally, you can check against the real services.

## Asian eShops: how they're found

Japan was never matched before 2026-11-06, for three reasons: the old lookup searched Japan's catalog by product code, which that search doesn't support (always 0 results); Europe has no product code for most Switch 2 games (Bananza included); and the catalog job only ran on a 12-hour timer that restarted from zero at every login, so it rarely ran at all. Daily jobs now remember their last run (`job_runs` table) and run at startup when overdue.

- **Sources** (`shared/stores/nintendoRegions.ts`): Japan's `search.nintendo.jp` (about 15,800 downloadable games, 53 pages of 300, ~400 KB each, so newest 3 pages per run and the whole list weekly); Hong Kong and Korea from `www.nintendo.com/{hk,kr}/api/search?k=Switch` (2 or 3 requests each). Their paged `/api/software` list shuffles same-day titles between pages and misses about 1 in 10, so don't switch back to it. `store.nintendo.com.hk` and `store.nintendo.co.kr` sit behind a bot challenge: don't use them.
- **Matching** (`server/src/ingest/regions.ts`): product code core plus platform (the core alone repeats: Odyssey is HAC AAAC, Bananza is BEE AAAC). When Europe has no code, the application ID from Europe must match exactly one Hong Kong listing on the same platform; the ID comes from `ec.nintendo.com/HK/zh/titles/<nsuid>` (Korea's pages don't have it). Pages are read once and remembered, 250 per run.
- **Coverage after the first live run**: 5,121 games linked in Japan, 3,141 in Hong Kong, 1,649 in Korea (out of about 20,000 Switch games). The rest fill in over later runs.

## Open ideas, not started

- Merging this branch into `main` once the owner is happy with it.

## Where to read more

- `README.md`: what the app does, how to run everything, with/without-PC table.
- `AGENTS.md`: project layout and the checks to run before finishing.
- `DESIGN.md`, `docs/design-audit.md`: the visual system and why.
- `docs/qa-report.md`: the deep QA pass and what it fixed.
