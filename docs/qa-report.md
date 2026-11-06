# QA report

A full pass over the app and server before launch: automated checks, two independent code reviews (one for the server, one for the app), an API stress run with bad input, a load test at realistic scale, a native render test, and a screenshot review at 390pt and 320pt in both themes.

The stores, the European Central Bank and Expo's push service aren't reachable from the development sandbox, so the server was run end to end against a local fake store. Nothing here has been run against the live stores yet.

## What was broken, and is now fixed

### Would have hurt people on day one

| Problem | Effect | Fix |
| --- | --- | --- |
| The notification-tap hook ran outside the data provider | **The iOS and Android app crashed on launch** ("No QueryClient set"). Web hid it, because web uses a no-op version of that hook. Confirmed by running the new smoke test against the previous version. | App-wide effects now live inside the provider. A smoke test renders the real app on the native code path so this can't come back silently. |
| Steam rows showed the cheapest Steam region's price | A UK user saw Elden Ring at £12.96 (the Argentina price) instead of £25.91, their real price | Rows, ranking and filters use your own store's price on Steam |
| A repeat sale at the same price was treated as a duplicate | No alert for the December sale if November's hit the same target | Alert keys include the sale they belong to; if the top alert was already sent, the next one goes out instead |
| Two refresh jobs running at once could each miss the other's changes | Missed "on sale" alerts during busy periods | Refreshing and alert planning happen as one locked step |
| A sale that had already ended still counted in alert planning | A new sale elsewhere didn't trigger "on sale" | Fixed a point-free `.map()` that passed the array index as the current time |
| A short Expo outage marked alerts as failed for good | Alerts lost during a blip | Network errors retry with backoff (1, 2, 4, 8, 16 min) |
| Changing currency left target prices in the old currency | A €20 target became ¥20 | The server converts targets when your currency changes, and the app refreshes the watchlist |
| Steam home stores outside the default list (NZ, CH, NO, ZA...) weren't priced | No Steam deals or alerts for those users | Every user's own store is always priced |

### Security and abuse

- The rate limiter trusted a client-supplied `X-Forwarded-For` header, so it could be bypassed, and enough fake addresses reset everyone's limit. It now uses the real socket address unless `TRUST_PROXY=1`, and expired entries are swept instead of wiping everything.
- Opening a game page could trigger a fresh fetch from every store on every request. On-demand refreshes are now deduplicated and happen at most once per game per 3 hours.
- Device registration is limited to 10 a minute per address. Watches are capped at 300 per install.
- A reinstall could leave the same push token on two device rows, so one phone got duplicate alerts. Tokens are now unique and move to the newest install.

### Accuracy and data

- Sale flags counted sales whose end time had passed.
- Price history kept showing a region after the game was delisted there.
- Japan matching retried the same unmatched games forever and stopped at the first error. Misses are now remembered for a week and errors are handled per game.
- Big-deal digests with no known end date were stamped as already expired and silently dropped.
- "Sale ending soon" could fire twice for one sale if exchange rates changed which region was cheapest.
- Sale event "top picks" used prices from before the refresh.
- A negative page cursor returned items from the end of the list.
- New: if your own eShop starts a sale while another region is still cheaper, you now hear about it ("on sale in your eShop, still cheaper in South Africa").

### App behaviour

- Lists didn't refresh when you came back to the app (React Native has no window focus events); now they do.
- The alerts switch could show "on" when this build can't receive pushes at all, and denying the system prompt jumped straight to Settings. Now it explains the situation, offers Settings only when the system won't ask again, and follows permission changes made in the OS settings.
- If the server forgot a device, the app showed "Unknown device". It now registers again and retries.
- Flipping two alert switches quickly made one snap back; a fast watch and unwatch could arrive at the server in the wrong order. Watch changes now run in order.
- The price chart swallowed vertical swipes, so the page wouldn't scroll. It now only takes horizontal drags.
- The offline cache saved every search and filter combination with no limit. It now keeps only the watchlist, alerts, exchange rates and default deal lists.
- The Alerts tab showed "No alerts yet" when loading failed. It now shows the error and a retry.
- People in countries we don't list (Ireland, Austria, Belgium...) defaulted to the US store. Euro countries now default to Germany.
- Filters and search keep the current list on screen while the next one loads, instead of flashing a skeleton.
- The cheapest-region markers were lime on near-white in light mode (about 1.2:1 contrast). They're dark green there now.
- Prices shrink to fit on narrow screens, and covers get smaller under 360pt wide.
- The target-price field moves above the keyboard, and only saves when the value changed.
- Copy: curly apostrophes throughout, "Your store" on Steam pages, and no "pull down to retry" on screens that can't be pulled.
- Lint (React Compiler rules) found refs read during render and state set inside effects. Both are rewritten to the recommended patterns.

## Performance (in memory, 15,000 games × 18 countries, 3,000 users)

| Operation | Before | After |
| --- | --- | --- |
| Deals list, repeat request or next page | 175 ms | under 1 ms (cached until prices change) |
| Deals list, first request for a new filter | 175 ms | 90 to 340 ms |
| Planning alerts for a 3,000-game sale (12,857 alerts) | 3.1 s | 1.3 s |
| Directory search | 10 ms | 9 ms |

The big win for alerts was reusing number formatters, which the app benefits from too, since every list row formats several prices.

## Checks now in place

- Server: 68 tests (`cd server && npm test`), typecheck, and `npx tsx scripts/loadtest.ts`.
- App: 28 tests including 8 native smoke tests that render the real app (`npm test`), typecheck, and `npm run lint`, which is now clean.
- `expo-doctor`: 18 of 20 checks pass. The other 2 need Expo's online services and couldn't run in the sandbox.

## Still open

- **Live stores:** the first run against Nintendo, Steam, the ECB and Expo may turn up renamed fields.
- **Real devices:** cold-start notification taps and the keyboard behaviour should be checked on an actual iPhone and Android phone.
- **Push setup:** the app needs an EAS project ID before push can work.
