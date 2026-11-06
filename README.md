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
- **Cross-region matching is strict.** Nintendo gives each regional group its own game IDs. We only link two listings when the product code matches, or the title matches and the publisher or release date agrees too. If we're not sure, we leave the region out and the app says so, rather than show the wrong game's price.
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
npm run setup     # installs everything and writes the config for your Wi-Fi
npm run server    # terminal 1: the price server
npm start         # terminal 2: the app; scan the QR code with Expo Go
```

Your phone needs to be on the same Wi-Fi as the computer. Run `npm run setup` again if your computer's address changes. The sections below explain each part.

### Server

```bash
cd server
npm install
npm run dev          # API on :8787, jobs start immediately
npm test             # 68 tests, including a full price-change-to-push run
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

Push alerts need a real phone and an EAS project ID in `app.json` (`expo.extra.eas.projectId`, from `npx eas-cli init`), then a development or production build (`eas build`). Expo Go is fine for everything else.

### Install on your phone

1. Deploy the server somewhere with HTTPS (see above). Release builds won't talk to a plain `http://` address.
2. `npx eas-cli@latest login`, then `npx eas-cli@latest init` (this adds the project ID that push alerts need).
3. Point the app at your server: `npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://your-server --environment preview --visibility plaintext`
4. Android: `npx eas-cli@latest build --profile preview --platform android`, then open the link it prints on your phone and install the APK.
5. iPhone (needs a paid Apple Developer account): `npx eas-cli@latest device:create` to register your phone, then `npx eas-cli@latest build --profile preview --platform ios` and open the link on the phone.

To try it before any of that, run the server on your computer and open the app in Expo Go with `EXPO_PUBLIC_API_URL=http://<your computer's local IP>:8787 npx expo start`. Everything works except push alerts, which Expo Go doesn't support.

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

- **Not yet run against the live stores.** The development sandbox couldn't reach Nintendo, Steam, the ECB or Expo, so the adapters are written to these services' documented and historically observed responses and tested with hand-written sample responses, plus a full local run against a fake store. The first live run may turn up a renamed field; each adapter keeps its field names in one place.
- **Hong Kong and Korea eShops** use separate catalogs and aren't covered yet.
- **Steam regional prices are for comparison.** Steam charges your account country's price, and the app says so.

Gamely isn't affiliated with Nintendo or Valve.
