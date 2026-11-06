# Gamely

A mobile app for game deals on Nintendo Switch 2, Switch and Steam. It compares every eShop region you can actually buy from, converts prices into your currency, and alerts you when a game you're watching goes on sale.

There are two parts:

- **The app** (repo root): Expo / React Native for iOS and Android.
- **The server** (`server/`): polls the stores on a schedule, keeps price history, spots changes and sends push alerts.

## What it does

**Deals.** Everything on sale for Switch 2, Switch or Steam. Each game shows the best price across your regions, where that price is, and how much less it is than your own eShop. Sort by popular, biggest discount, lowest price, ending soon or newest. Filter to 50% off or more, under a set price, or "Cheaper abroad".

**Directory.** Every Switch game, on sale or not, with a line of the cheapest regions under each one. Steam search too.

**Game page.** The best price, the saving against your eShop, when the sale ends and the lowest price on record. Below that, a price spread across every region, the full region list, and a price history chart you can scrub through.

**Watchlist and alerts.** Watch a game and choose what you want to hear about: it goes on sale, hits its lowest price, a sale is about to end, any further drop, or it reaches your price. Alerts arrive as push notifications and are also kept in an Alerts tab.

**Settings that keep "best price" honest.** Pick your home eShop and currency, and untick regions you can't pay in. Every best price, saving and alert respects that list. Quiet hours hold alerts until morning.

## Accuracy

- **Prices come only from the stores.** Nintendo's own eShop price endpoint (the price charged at checkout) and Steam's store APIs. Catalog listings are only used to find games, never for prices.
- **Exchange rates come from the European Central Bank.** The few currencies the ECB doesn't publish (ARS, CLP, COP, PEN and a handful more) use a market rate, and the app says so.
- **Cross-region matching is strict.** Nintendo gives each regional group its own game IDs. We only link two listings when the product code matches, or the title matches and the publisher or release date agrees too. Japan, Hong Kong and South Korea list games in their own languages, so there titles never count: a game is linked only by its product code plus platform, or by its worldwide application ID (read from Hong Kong's eShop page when Europe has no product code). If we're not sure, we leave the region out and the app says so, rather than show the wrong game's price.
- **Outages don't look like price changes.** If a store doesn't answer, we keep the last confirmed price and flag it as stale after 36 hours. A price is only removed when the store says the game is no longer sold there.
- **Ended sales disappear on time.** A sale is hidden the moment its end time passes, even before the next check.
- **Freshness is visible.** Lists and game pages say when prices were last confirmed. Settings › Data sources shows the health of every source.

## How often prices update

| What | How often |
| --- | --- |
| Games on anyone's watchlist, and sales ending within 48 hours | Every 10 minutes |
| New sales (Nintendo catalogs and Steam specials) | Every 20 minutes |
| Everything currently on sale | Every 30 minutes |
| Every game in every region | Once a day |
| Exchange rates | Every 6 hours (the ECB publishes once a day) |
| "Sale ends soon" reminders | Hourly |
| Store-wide sale detection | After every discovery pass, about every 20 minutes |
| Big-deal digests | Every 3 hours, at most one per person every 12 hours |

Opening a game whose prices are more than 3 hours old triggers a fresh check on the spot. All intervals can be changed with env vars (see `server/.env.example`).

## Alerts

The server compares every refresh with the previous prices and decides, per person, whether something worth telling them happened. It only looks at that person's regions and currency, and for Steam only at the store their account buys in. Each change produces at most one alert (target price beats lowest price, which beats "on sale", which beats "dropped"), the same alert is never sent twice, and four or more alerts at once are rolled into one summary. Alerts that fall in quiet hours wait until they end, and alerts about a sale that has already finished are dropped. Pushes go through Expo's push service, which handles both Apple and Google, and dead tokens are cleaned up from delivery receipts.

## Sale events and big deals

Separate from the watchlist, the server tells people when something big is happening:

- **Store-wide sales.** Every discovery pass records how many games each store says are discounted (Steam's own specials count, and Nintendo Europe's count for Switch and Switch 2). When that number jumps to at least 1.6× a normal day, with a real jump in games too (1,500 on Steam, 300 on Switch, 40 on Switch 2), a sale event starts and everyone who opted in gets one push, for example "A big Steam sale is on: 38,400 games discounted, about 4× a normal day. Top picks: ...". A normal day is the median from 2 to 8 days earlier. Nothing fires until a week of history exists, so a new server can't raise a false alarm. Each event alerts once, and it closes when the count falls back near normal. A live event also shows as a banner on the Deals screen.
- **Big deals on popular games.** Every 3 hours the server looks for popular games (by store ranking) that went to 50% off or more in the last day, in that person's regions and currency. It sends them as one digest, at most every 12 hours, never repeats a game for the same sale, and leaves out games already on the person's watchlist.

Both can be switched off, limited to certain platforms, and the big-deal threshold can be set from 40% to 80%, all in Settings › Sales and events. Quiet hours apply to these too.

## Running it

### Quick start on your computer

```bash
npm run setup       # installs everything and writes the config for your Wi-Fi
npm run autostart   # the price server starts whenever you log in (npm run server runs it once)
npm start           # the app in Expo Go; scan the QR code with your phone
```

Run `npm run setup` again if your computer's address changes, then update it in the app under Settings › Gamely server.

### With and without your PC

The app works either way and switches on its own:

| | PC off (or you're away from home) | PC on, server running |
|---|---|---|
| Deals, directory, regional prices | Yes, fetched live by the phone | Yes, faster |
| Watchlist and target prices | Yes (stored on the phone) | Yes (synced to the server) |
| Alert when a watched game goes on sale | When you open the app, plus a few background checks a day | Within about 10 minutes, even with the app closed |
| Store-wide sale and big-deal alerts | No | Yes |
| Americas eShops | No | With the Americas catalog set up |
| Price history | What this phone has seen | Full history |

When the server is reachable, phone-side alerts stay quiet so nothing arrives twice.

### Auto-start and memory

`npm run autostart` registers the server to start at login with no console window: a launcher in the Startup folder on Windows, a LaunchAgent on macOS, a systemd user service on Linux. None of them need admin rights. `npm run autostart:status` shows whether it's running and the last log lines. `npm run autostart:off` removes it.

The server runs as a single precompiled Node process: about 80 to 100 MB of RAM normally, and up to roughly 150 to 180 MB with a full catalog. Its heap is capped at 256 MB. It's idle almost all the time, waking every few minutes to check prices. The database grows to about 50 to 100 MB on disk. Logs go to `server/data/server.log` and rotate at 5 MB.

It only runs while the PC is awake. If the PC sleeps, the phone uses phone-only mode until it wakes.

### Keeping this folder up to date

```bash
npm run autoupdate          # check GitHub every 30 minutes and pull in new changes
npm run update              # or update right now, by hand
npm run autoupdate:status   # is it on, and what did it last pull in?
npm run autoupdate:off
```

Each check runs in the background with no window (Task Scheduler on Windows, a LaunchAgent on macOS, a systemd timer on Linux; no admin rights). When there's something new it pulls it in, installs any new packages, and rebuilds and restarts the background server if server code changed. If `npm start` is running, the app reloads by itself. The APK on your phone only changes when you build a new one.

It only fast-forwards, so it never throws away work: if you've edited project files or made your own commits in this folder, it skips the update and says why in `server/data/update.log`. Your `.env` files, the server's database, `google-services.json` and your Expo project link are left alone. (The project link that `eas init` writes into `app.json` is kept in `.gamely-local.json` and put back after every update.)

### Server

```bash
cd server
npm install
npm run dev          # API on :8787, jobs start immediately
npm test             # 70 tests, including a full price-change-to-push run
npx tsx scripts/loadtest.ts   # 15,000 games x 18 countries, 3,000 users, in memory
```

It stores everything in one SQLite file (Node's built-in SQLite, no database server needed). To deploy, build `server/Dockerfile` from the repo root and mount a volume at `/data`. Any host that runs a container with a disk works: Fly.io, Railway, Render, a small VPS. Behind a proxy that sets `X-Forwarded-For`, set `TRUST_PROXY=1` so rate limits apply per real client.

### App

```bash
npm install
cp .env.example .env   # point EXPO_PUBLIC_API_URL at your server
npx expo start
npm test               # app tests, including smoke tests that render the real app on the native code path
npm run lint
npm run typecheck
```

Push alerts need a real phone and an installed build (`npm run build:android`, which links the Expo project for you). Android also needs Firebase, below. Expo Go is fine for everything else.

### Install on your phone

```bash
npm run build:android   # builds in Expo's cloud (free plan), then prints a link to install the APK
npm run build:ios       # needs a paid Apple Developer account
```

The first run asks you to log in to Expo and links the project. When it finishes, open the link on your phone to install. Then in the app, go to Settings › Gamely server and enter the address `npm run setup` printed. Without it, the app runs in phone-only mode.

### Update the app without a new APK

```bash
npm run update:app      # sends the current app code to installed phones (Expo Update, free plan)
```

Open Gamely, wait a few seconds, close it fully and open it again: the new version is in use. This covers screens, wording and logic. A new native library, an Expo SDK upgrade or a plugin change in `app.json` can't go this way: raise `version` in `app.json`, then `npm run build:android` and install the new APK. Updates only reach APKs with the same `version`, so an update can never land on an app it doesn't fit.

### Push notifications on Android

Android delivers push through Google's Firebase Cloud Messaging, so Expo needs two things from a free Firebase project. One command sets it up:

```bash
npm run setup:push
```

It links the Expo project, logs in to Firebase (your browser opens), creates a Firebase project and its Android app (or reuses ones you pick), and puts `google-services.json` in this folder. Then it opens the one Firebase page it can't do for you: click *Generate new private key*. It finds the downloaded key, hands it to Expo's credentials tool (you pick four menu options it lists for you), deletes the key afterwards, and offers to start the new build. Firebase is built into the app, so the APK needs rebuilding once.

To do it by hand instead:

1. **Create the Firebase project.** At [console.firebase.google.com](https://console.firebase.google.com), add a project (Google Analytics isn't needed). Then add an Android app to it with the package name `com.gamely.market`.
2. **Download `google-services.json`** when Firebase offers it (or later from Project settings › Your apps) and put it in the project folder, next to `app.json`. The build picks it up on its own. This file is app configuration, not a secret.
3. **Give Expo permission to send.** In Firebase, open Project settings › Service accounts and click *Generate new private key*. That downloads a JSON key, which *is* a secret: don't put it in the project folder or share it. Upload it to Expo, either in the terminal:
   ```bash
   npx eas-cli@latest credentials
   ```
   (choose Android, then the build profile, then the Google Service Account key for push notifications, FCM V1, and upload the file), or on expo.dev under your project › Credentials › Android. Once it's uploaded you can delete the downloaded key.
4. **Build again** with `npm run build:android` and install the new APK. Firebase is built into the app, so the old APK can't get pushes.

Then in the app, turn on alerts in Settings. If a test alert doesn't arrive, `npm run autostart:status` shows the server's last log lines, including push errors.

### Americas catalog

Nintendo of America has no open catalog endpoint like Europe does. Their store search runs on Algolia, so the Americas are off unless the server is given search credentials (`NA_SEARCH_*` in `server/.env.example`). Without them, the US, Canada, Mexico, Brazil and other Americas eShops are left out, and the app says so in Settings › Data sources. Check Nintendo's terms before you use any credentials you didn't get from them directly.

## Project layout

```
src/                app (Expo Router screens in src/app)
shared/             types, regions, price maths and the API contract, used by both sides
server/src/
  sources/          store adapters (Nintendo, Steam, exchange rates)
  ingest/           catalog sync, cross-region matching, price refresh
  alerts/           who to alert about what, quiet hours
  push/             Expo push sending and delivery receipts
  api/              HTTP API, deal ranking, price history
  jobs.ts           the schedule
docs/design-audit.md   the design review of the first build and what changed
DESIGN.md           colours, type, components and motion
```

## Known limits

- **Lightly tested against the live stores.** The first live run on a real PC fetched over 5,000 prices with no errors, but most testing used sample responses and a fake store, because the development sandbox can't reach Nintendo, Steam, the ECB or Expo. If a store renames a field, each adapter keeps its field names in one place.
- **Japan, Hong Kong and Korea fill in over a few weeks.** Games with a product code link on the first catalog run. Games without one (most Switch 2 games in Europe's catalog) need one Hong Kong eShop page read each, at most 250 pages per run, watched games first, then games on sale, then popular ones. Without the server, the phone prices these three regions only for games the server already matched.
- **Steam regional prices are for comparison.** Steam charges your account country's price, and the app says so.

Gamely isn't affiliated with Nintendo or Valve.
