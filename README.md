# Gamely

A mobile app for finding game deals on Nintendo Switch 2, Switch and Steam. It checks every eShop region you can actually buy from, converts the prices into your currency, and tells you where a game is cheapest right now.

Built with Expo (React Native), so it runs on iOS and Android from one codebase.

## What it does

**Deals.** Everything on sale, split into Switch 2, Switch and Steam. Each game shows its best price across your regions in your currency, which country that price is in, and how much less it is than your own eShop. Sort by popular, biggest discount, cheapest, ending soon or newest. Quick filters: 50%+ off, under a set price, and "Cheaper abroad" (only games at least 15% cheaper in another region than at home).

**Directory.** Search every Switch game, not just the ones on sale. Each row has a strip of the cheapest regions with the local price and the converted price side by side, so you can compare without opening the game. Steam search is here too.

**Game page.** The best price up top, the saving against your home eShop, and the sale end time. Under that, every region ranked cheapest first with a bar that shows the price spread at a glance. Regions where buying is awkward (Brazil, Argentina, Japan) carry a short payment note.

**Watchlist and alerts.** Save a game, set a price, and get a notification when the best price in your regions drops to it. The app records the price each time it checks, so watched games build up a small price history and a "lowest seen" figure.

**Settings that make "best price" honest.** Pick your home eShop and currency, then switch off any regions you can't pay in. Every best price and saving in the app respects that list.

## How it's different from the price sites

- Mobile first, with Steam and both Switch generations in one place.
- "Best price" only counts shops you've said you can buy from, so the top result is something you can actually get.
- Savings are shown against your own eShop, not just as a raw discount.
- The directory shows regional prices inline instead of hiding them a tap away.
- Price alerts and history live on your phone. No account needed.

## Running it

```bash
npm install
npx expo start
```

Then open it in Expo Go, or press `i` / `a` for a simulator. Price alerts use a background task and notifications, which need a development build (`npx expo run:ios` or `npx expo run:android`, or `eas build --profile development`).

Checks:

```bash
npm test           # unit tests
npm run typecheck  # TypeScript
```

The web build is only useful for layout work. Browsers block the store APIs (CORS), so prices won't load there.

## Where the prices come from

| Data | Source | Needs a key? |
| --- | --- | --- |
| Switch prices per country | Nintendo's eShop price endpoint (`api.ec.nintendo.com`) | No |
| Europe, Oceania and South Africa game list | Nintendo of Europe's game search | No |
| Americas game list | Nintendo of America's store search (Algolia) | Yes, see below |
| Japan | Nintendo Japan's software search, matched by product code | No |
| Steam deals, search and regional prices | Steam store endpoints | No |
| Exchange rates | open.er-api.com, refreshed daily | No |

Nintendo gives games a different ID in each of its three regional groups (Americas, Europe/Oceania, Japan). Countries inside a group share IDs, so one lookup prices a game in all of them. The app matches the same game across groups by title, and uses the product code for Japan, where titles are in Japanese.

### Americas catalog

Nintendo of America doesn't have an open catalog endpoint like Europe does. Their store search runs on Algolia, so the Americas lookup is off unless you supply search credentials. Copy `.env.example` to `.env` and fill in:

```
EXPO_PUBLIC_NA_SEARCH_APP_ID=
EXPO_PUBLIC_NA_SEARCH_API_KEY=
EXPO_PUBLIC_NA_SEARCH_INDEX=store_game_en_us
```

Without it the app still works for the Europe/Oceania group and Japan, and Settings shows the Americas catalog as not set up. Check Nintendo's terms before you ship with any credentials you didn't get from them directly. The cleaner long-term fix is a small backend of your own (see below).

## Project layout

```
src/
  app/          screens: Deals, Directory, Watchlist, Settings, game/[key]
  api/          store adapters (nintendo/, steam.ts, fx.ts) and the HTTP helper
  domain/       regions, price conversion and ranking, title matching
  state/        settings and watchlist (persisted with AsyncStorage)
  services/     price alerts and the background check
  components/   rows, region table, sparkline, small UI pieces
  __tests__/    Jest tests for parsing, pricing, matching and alerts
```

## Known limits and next steps

- **Not yet tested against the live stores.** The adapters follow how these public endpoints have historically responded, and the parsers are covered by tests with sample responses. The first run on a real phone may turn up a field that has been renamed. Each adapter keeps its field names in one place so that's a quick fix.
- **Background checks are up to the OS.** iOS in particular runs them when it sees fit, often overnight. Pull to refresh on the Watchlist checks right away.
- **Price history starts when you watch a game.** A shared backend that snapshots prices daily would give full history and all-time lows for every game, and would also be the right home for the cross-region ID matching and the Americas catalog.
- **Hong Kong and Korea eShops** use their own catalogs and aren't covered yet.
- **Steam regional prices are for comparison.** Steam charges the price of your account's country, and switching store region to get a cheaper price breaks Steam's rules. The app says so on every Steam game page.

Gamely isn't affiliated with Nintendo or Valve.
