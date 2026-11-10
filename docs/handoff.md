# Handoff: where things stand

Gamely was built in a cloud Claude Code session and moved to a local project on the owner's Windows PC (`D:\Users\Renzo\Desktop\Gamely-Market`, branch `ccr-86b2d07a-hyz453`). Since 2026-11-06 `main` is the default branch on GitHub and holds the same work; each session pushes to both (see `AGENTS.md`). When no other session is using this folder, it can be switched to `main` (`git switch main`) and the old branch retired. This note is what that conversation knew that the code doesn't say on its own.

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
| Over-the-air updates (2026-11-06) | Set up: `expo-updates`, channel `preview`, runtime version = app `version`, now 1.1.0 (raised for `expo-web-browser`, which opens Eneba in an in-app Chrome tab). Updates only reach APKs of the same version, so the 1.1.0 APK must be installed once. Publish with `npm run update:app` |
| App icon (2026-11-06) | A price line stepping down to the lime "lowest" dot. Every size (adaptive, themed, notification, splash, favicon) comes from `python scripts/make-icons.py`; changing it needs a new APK |
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
- **Southeast Asia (added 2026-11-10, the day the Philippine eShop opened)**: group `sea`. Catalog from `search.nintendo.jp/nintendo_soft_ph` (same fields as Japan, about 4,000 games, read whole each catalog run), linked by product code. Singapore, Malaysia and Thailand share the same IDs and are live in the price API (SGD, MYR, THB), so each is one line in `SWITCH_REGIONS`. First run: 1,588 games linked in PH. The Philippine web eShop has no per-game pages yet.

## Open ideas, not started

- **A free always-on cloud server (paused 2026-11-06, the owner's call: "use the PC server for now").** Where it stands:
  - Chosen: Oracle Cloud Always Free, home region Singapore (`ap-singapore-1`), the `VM.Standard.E2.1.Micro` AMD shape (its public IPv4 is included free; 10 TB/month outbound). Google Cloud was ruled out: its free e2-micro is free but an in-use external IPv4 costs $0.005/hour (about $3.65/month, free allowance one hour a month).
  - Blocked on sign-up: Oracle doesn't accept prepaid or virtual cards (its FAQ), so the owner's Maya card was refused and GCash won't work either. Wise is hit-and-miss. A bank credit/debit card is the reliable route. Repeated failed card attempts can get a sign-up auto-rejected, so try once per card.
  - Agreed plan for charges: stay on the free account (it can't bill) and add a small budget alert; don't upgrade to Pay As You Go unless Oracle actually reclaims the idle server.
  - Already on the PC: Oracle's CLI in `%USERPROFILE%\.oci-cli-venv` (run `oci setup bootstrap --region <region>` once the account exists; the owner signs in in the browser), and an SSH key at `~/.ssh/gamely_oracle`.
  - Still to do: create the VCN, subnet, security list (22/80/443) and the Micro instance (Ubuntu); install Node, clone the repo (public), build the server, systemd service, HTTPS with Caddy and an `<ip>.sslip.io` name; copy `server/data/gamely.db` and `server/.env` from the PC (stop the PC server first); point the app at the https address (`EXPO_PUBLIC_API_URL`, then `npm run update:app`); turn off PC auto-start (`npm run autostart:off`) so alerts aren't sent twice; add a deploy command and update the "ship" steps in `AGENTS.md`.

## Where to read more

- `README.md`: what the app does, how to run everything, with/without-PC table.
- `AGENTS.md`: project layout and the checks to run before finishing.
- `DESIGN.md`, `docs/design-audit.md`: the visual system and why.
- `docs/qa-report.md`: the deep QA pass and what it fixed.
