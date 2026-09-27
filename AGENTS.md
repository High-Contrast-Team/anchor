This is an Nx monorepo for the OpenConf hackathon. Optimize for iteration speed.

- `apps/api`: the NestJS backend. It serves `/api/*` (state, moments, spaced retrieval), Twilio WhatsApp at `/whatsapp`, and the family record for the website at `/web/*` (`apps/api/src/app/web.ts`, checks a Telegram Login `id_token` on each request). Model calls use OpenAI by default (`OPENAI_API_KEY`; optional Gemini via `ANCHOR_MODEL_PROVIDER`). Auth is Nest JWT Bearer (`AUTH_JWT_SECRET`) with accounts in Neon Postgres project `anchor` (`eu-central-1`). Neon also holds website families, consents, file metadata (`user_files`), and optional moment snapshots. Media uses Vercel Blob (`fra1`). The Telegram family record (JSON) lives with Cloud Run service `anchor-bot` in `europe-west1` on Cloud Storage. Deploy: Vercel `anchor-api` + Cloud Run bot (see `DEPLOY.md`). Secrets: `apps/api/.env.local` / `.env.example`. Root uses pnpm and Nx: `pnpm dev:api`, `pnpm dev:web`, `pnpm lint`, `pnpm typecheck`, `pnpm nx test api`.
- `apps/web`: the Astro + React website (landing, legal pages, email registration, the family record at `/family`, data export and deletion at `/my-data`, interactive `/app` demo). Telegram Login `id_token` is kept in `sessionStorage` and sent to the bot at `PUBLIC_BOT_URL` (`apps/web/src/lib/telegram.ts`). Public privacy copy must name Neon (`eu-central-1`), Vercel Blob (`fra1`), Cloud Run + Cloud Storage (`europe-west1`), Vercel, OpenAI, Twilio, and messaging providers. Static build on Vercel project `anchor`. Local: `pnpm dev:web`. Env: `apps/web/.env.example` (`PUBLIC_TELEGRAM_CLIENT_ID`, `PUBLIC_BOT_URL`).
- `apps/mobile`: the Expo/React Native app. Android is the only target platform. The app is on hold, `.nxignore` hides it from Nx, and it keeps its own npm `package.json`. Run every command in the sections below from `apps/mobile`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

The project uses npm (`package-lock.json`).

```bash
npm run android             # boot the emulator, build and install the dev build, start Metro on port 8090
npm start                   # start Metro only, when the dev build is already installed
npm run e2e                 # run the Maestro flows in .maestro/ against the running app
npm run lint                # lint
npm run typecheck           # typecheck
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done. To see a change on the emulator, or when the app does not start, use the `run-android` skill.

## Navigation & Routing

The app is a single screen in `App.tsx`, registered by `index.ts`. Expo Router is not installed. Add Expo Router when the app gets a second screen, then follow these rules:

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- The app runs as a development build (`expo-dev-client`), not in Expo Go. After you add a library with native code or change `app.json`, run `npm run android` again to rebuild. A JavaScript change needs no rebuild, because Fast Refresh applies it.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Notion

The hackathon brief and board live on the [OpenConf Hackathon](https://app.notion.com/p/OpenConf-Hackathon-3aa9ca0cda4c80d190e5dd517d462084) page. Only the project-scoped `notion-openconf` server in `.mcp.json` reaches that workspace.

Fetch the page id `3aa9ca0cda4c80d190e5dd517d462084` with `notion-openconf` first. When the fetch returns `object_not_found`, stop and ask the user to run `claude mcp login notion-openconf` in this directory. Do not probe `plugin:notion:notion` or the claude.ai Notion connector for this page. Both return `object_not_found`.
