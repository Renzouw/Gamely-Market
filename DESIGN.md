# Gamely design system

Gamely is a tool people open to answer one question fast: "where is this cheapest right now, and should I buy it?" The design gets out of the way of that answer. It should feel like a well-made price board, calm and exact, with one colour that means "look here".

## Principles

1. **The price is the hero.** Every screen leads with the number that matters, in the user's own currency.
2. **One signal colour.** Lime means best price, savings or a good alert. It's never used for chrome, links or decoration, so it keeps its meaning.
3. **Say what's true.** Freshness, sources and gaps are stated plainly. If we couldn't confirm a game in a region, we say so instead of guessing.
4. **Native first.** Grouped lists, sheets, switches and haptics behave the way iOS and Android users expect.

## Colour

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `bg` | #0F0F0E | #F5F3EE | Screen background (warm ink / paper) |
| `surface` | #181816 | #FFFFFF | Grouped lists, sheets |
| `raised` | #22221F | #ECE9E2 | Inputs, secondary buttons, cover placeholders |
| `line` | #2D2C29 | #E0DCD3 | Hairlines and borders |
| `text` | #F4F2EC | #141412 | Primary text, selected states |
| `muted` | #A9A59B | #55524B | Secondary text |
| `subtle` | #8A867C | #6E6A62 | Tertiary text, at least 4.5:1 on `bg` |
| `signal` | #C8F04A | #C8F04A | Fills: primary button, discount tag, cheapest marker |
| `signalText` | #C8F04A | #3F6B00 | Signal as text, darker in light mode for contrast |
| `warn` | #FFB547 | #9A5B00 | Sale ending soon, stale prices |

Platforms get a small dot and nothing more: Switch 2 #FF5C3A, Switch #F0A202, Steam #4FA3E0.

## Type

- **Schibsted Grotesk** for all text. An editorial grotesk built for news, so it stays clear at small sizes.
- **IBM Plex Mono** for prices in lists and tables, so digits line up.
- Large single prices (the game page headline, chart readout) use Schibsted Grotesk, because a monospace decimal point looks gappy at display sizes.

Every text goes through `src/theme/Text.tsx`: `largeTitle 30`, `title 21`, `headline 16`, `body 15`, `callout 14`, `footnote 13`, `caption 11.5`, `overline 11.5 caps`, and `priceXL 42`, `priceL 24`, `priceM 17`, `priceS 13`, `priceXS 12`.

## Space and shape

4pt grid (`2, 4, 8, 12, 16, 20, 28, 40`). 16pt screen gutter. Radii `6, 10, 14, 20`, pill for chips. Every tap target is at least 44pt.

## Components

- **Game row**: cover, title and one context line on the left, a right-aligned price column (price, then discount). The context line shows, in order of importance: sale ending within 48h, saving abroad, where it's cheapest.
- **Price spread**: every region as a dot on one line. Cheapest is a lime dot, home is an outlined dot.
- **Price chart**: a step line (prices hold until a store changes them) with the all-time low marked. Drag to read any day.
- **Platform tabs**: words with an underline. No pills.
- **Chips**: text only. Selected is an inverted fill, never a colour.
- **Sheets** for choices (sort, home eShop, currency, quiet hours).
- **Cover fallback**: neutral tile, initials, and a thin platform-coloured rule.

## Motion

Pressables settle to 97.5% under the finger with a short spring. Selection changes give a light haptic. Skeletons pulse at 1.3s. Nothing bounces, slides in or celebrates.

## Copy

Short, plain and specific. "Ends in 5h", "🇿🇦 30% cheaper", "We couldn't confirm this exact game in Japan". No exclamation marks, no developer language in shopping screens.
