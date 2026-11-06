# Handoff: where things stand

Gamely was built in a cloud Claude Code session and moved to a local project on the owner's Windows PC (`D:\Users\Renzo\Desktop\Gamely-Market`, branch `ccr-86b2d07a-hyz453`). This note is what that conversation knew that the code doesn't say on its own.

## How the owner works

- Writing for them should sound human and plain. Never use em dashes.
- No paid servers. The server runs on their PC; the app must keep working when the PC is off (phone-only mode).
- They aren't a developer: give exact commands to type, one step at a time, and say which window to type them in.
- Never ask them to paste a password, token or key into the chat. The Firebase service account key goes straight to Expo (`npm run setup:push` handles it).

## What's running on their PC

- **Server auto-start is on.** A launcher in the Windows Startup folder (`Gamely Server.vbs`) starts the server at login with no window. Check it with `npm run autostart:status`; logs are in `server/data/server.log`.
- **Auto-update may be on** (`npm run autoupdate`, a Task Scheduler task called "Gamely Update"). Now that work happens in this folder, turn it off with `npm run autoupdate:off`.
- `.env` (app) and `server/.env` were written by `npm run setup` for their Wi-Fi address. Rerun it if the PC's address changes.

## Verified, and not yet

| Thing | Status |
| --- | --- |
| App and server tests, lint, typecheck | Passing (39 app tests, 70 server tests) |
| Server against the live stores | One live run on the PC: over 5,000 prices fetched, no errors |
| Server auto-start on Windows | Confirmed working |
| Auto-update (`scripts/update.mjs`) | Tested on Linux copies; the Windows Task Scheduler part hasn't run for real yet |
| APK build (`npm run build:android`) | Not confirmed yet |
| Android push (`npm run setup:push`) | Written and tested against stand-ins for the Firebase and Expo tools only. The likely snag: Firebase refusing to create a project until the account accepts its terms in the console |
| Phone-only mode on a real phone | Tested in the app's smoke tests, not yet on a device |

The cloud session couldn't reach the stores, Expo, or Expo's docs, so anything touching those was written from documented formats and tested with samples. Working locally, you can check against the real services.

## Open ideas, not started

- Hong Kong and Korea eShops (separate catalogs).
- Americas eShops need Algolia credentials (`NA_SEARCH_*` in `server/.env.example`); off by default.
- EAS Update for over-the-air app updates, so small app changes don't need a new APK.
- Merging this branch into `main` once the owner is happy with it.

## Where to read more

- `README.md`: what the app does, how to run everything, with/without-PC table.
- `AGENTS.md`: project layout and the checks to run before finishing.
- `DESIGN.md`, `docs/design-audit.md`: the visual system and why.
- `docs/qa-report.md`: the deep QA pass and what it fixed.
