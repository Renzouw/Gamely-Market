This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed: do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt, an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add so you get SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/`. Every file there is a screen, and `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`), with no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand. Instead, configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## This project

Gamely compares game prices across Nintendo eShop regions and Steam. Two parts:

- App (repo root): `src/app/` screens (Expo Router), `src/components/`, `src/hooks/queries.ts`, `src/theme/` (tokens and the `Text` type scale, see DESIGN.md).
  - All reads go through `src/api/data.ts`, which uses the Gamely server when reachable (`src/api/server.ts` tracks that) and falls back to phone-only mode (`src/direct/`, which calls the stores directly).
  - The watchlist lives on the phone (`src/state/watchlist.ts`) and syncs to the server (`src/services/watchSync.ts`). Phone-side alerts: `src/services/localAlerts.ts` and `localPlan.ts`.
- Server (`server/`): store adapters in `src/sources/`, ingestion and matching in `src/ingest/`, alert planning in `src/alerts/`, push in `src/push/`, HTTP API in `src/api/`, schedule in `src/jobs.ts`.
- `shared/` holds types, regions, price maths, the API contract, price history and the store parsers (`shared/stores/`) used by both the server and phone-only mode. Keep it free of React and Node APIs.

Before you finish: `npm test && npm run typecheck` at the root, and `npm test && npm run typecheck` in `server/`.
