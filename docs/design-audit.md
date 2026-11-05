# Design audit: first build

What follows is an honest read of the first version of the app, screen by screen, with the specific things that made it look generated rather than designed. Each item lists what changed in the rebuild. Screenshots of the first build were taken at 390×844 (iPhone 14/15 size) in both themes.

Severity: **P1** hurts trust or usability, **P2** reads as template or AI work, **P3** polish.

## Identity

| # | Finding | Sev | Fix |
|---|---|---|---|
| 1 | Default "AI dashboard" palette: cold slate background with a periwinkle accent that has nothing to do with the product. | P2 | Warm ink and paper neutrals. One signal colour, a lime "price tag" green, used only for the best price and savings. Everything interactive is plain ink/white. |
| 2 | System font at 700 to 800 weight almost everywhere, so nothing stands out because everything shouts. | P2 | Schibsted Grotesk for text (an editorial grotesk built for news, so it scans well at small sizes) and IBM Plex Mono for prices. Weight is used sparingly: prices and titles only. |
| 3 | Platform badges filled with saturated red, orange and blue. Three loud colours fighting the discount badge on every row. | P2 | Platforms become a small coloured dot and a label in secondary text. |

## Deals screen

| # | Finding | Sev | Fix |
|---|---|---|---|
| 4 | The header ate about 75% of the first screen (title, subtitle, segmented control, two chip rows, two banners). The first game started at y≈640 of 844. | P1 | One title line, platform tabs, a single filter row. The first game sits above the halfway mark. |
| 5 | An icon in every chip (flame for Popular, sparkles for Newest). A classic generated-UI tell. | P2 | Sort moves into one "Sort" control that opens a sheet. Chips are text only. |
| 6 | A banner telling users the Americas catalog "is off until set up". That's a note for developers, not shoppers. | P1 | Removed from shopping screens. Data coverage lives in Settings › Data sources. |
| 7 | Rows carried five competing elements (green badge, platform tag, timer pill, ≈ price, strikethrough, flag line). | P2 | Fixed layout: title and context on the left, a right-aligned price column with discount and region underneath. The timer only appears in the last 48 hours. The "≈" prefix is gone. |
| 8 | Missing cover art showed as an empty grey box, which reads as broken. | P1 | A tinted tile with the game's initials, coloured by platform. |
| 9 | Plain FlatList with inline render functions and separators: wasted re-renders on long lists. | P2 | FlashList, memoised rows, stable callbacks, and cached images. |

## Game screen

| # | Finding | Sev | Fix |
|---|---|---|---|
| 10 | A progress bar on every region row. Seventeen grey bars say less than one clear chart. | P2 | One "price spread" strip at the top: every region as a dot on a single line, cheapest highlighted, home outlined. The rows themselves stay clean. |
| 11 | Outlined "HOME" and "BEST" tags in capitals, plus a strikethrough squeezed into the local price line (the space was inside the strike, so it read like a dash). | P3 | A coloured rule marks the cheapest row and "Your eShop" is written as words. Regular prices sit on their own line. |
| 12 | Hero image under a flat grey shade with the back button floating over content when scrolling. | P3 | Full-bleed art with a proper gradient into the page, and the title set over the art. |
| 13 | Price history only existed for games you had watched, and only from that day. | P1 | Full history from the server for every game, with the all-time low marked and a scrubbable chart. |

## Watchlist, alerts and settings

| # | Finding | Sev | Fix |
|---|---|---|---|
| 14 | No record of past alerts. If you swiped a notification away it was gone. | P1 | An Alerts tab inside Watchlist listing every alert, newest first. |
| 15 | "Target: Any drop" and similar copy that didn't say what would actually happen. | P2 | Per-game alert switches with plain labels ("Goes on sale", "Lowest price ever", "Sale ending soon") and a target price field. |
| 16 | Settings was a wall of selected blue chips. You couldn't tell selected from not at a glance. | P2 | Native grouped rows. Region selection gets its own screen with check marks, grouped by eShop region, with select all per group. |
| 17 | No quiet hours. Price alerts at 3am feel cheap. | P2 | Quiet hours (default 10pm to 8am in your time zone). Alerts that land in that window wait until morning. |

## Trust and accuracy

| # | Finding | Sev | Fix |
|---|---|---|---|
| 18 | Nothing told you how fresh a price was. | P1 | Every list and game page shows when prices were last confirmed. Prices older than 36 hours are flagged. |
| 19 | Exchange rates came from one free feed with no attribution. | P1 | European Central Bank reference rates first. The few currencies the ECB doesn't publish are marked as market rates. |
| 20 | A sale that had already ended could still show until the next check. | P1 | The server hides a sale the moment its end time passes. |

## Accessibility

| # | Finding | Sev | Fix |
|---|---|---|---|
| 21 | Chips were about 32pt tall, under the 44pt minimum. | P1 | All tap targets are at least 44pt (with hit slop where the visual is smaller). |
| 22 | Faint text (#6B7280 on #0E1013) sat near 4:1 contrast. | P2 | Secondary text is at least 4.5:1 in both themes. |
| 23 | Rows announced only the title to screen readers. | P2 | Rows announce title, best price, region and discount. Charts have a text summary. |
