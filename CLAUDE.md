# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenStock — a free, open-source market data platform (Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui + Radix, Better Auth + MongoDB/Mongoose, Finnhub market data, TradingView widgets, Inngest background jobs, Nodemailer/Kit email, multi-provider AI: Gemini default with MiniMax/Siray fallback).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with Turbopack (http://localhost:3000) |
| `npm run build` | Production build with Turbopack |
| `npm start` | Start the production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest, runs once (`npm run test:watch` to keep watching) |
| `npx vitest run <path>` | Run a single test file, e.g. `npx vitest run __tests__/ai-provider.test.ts` |
| `npx tsc --noEmit` | Type check — builds skip type errors, so run this before opening a PR |
| `npm run test:db` | Checks the MongoDB connection |
| `node scripts/check-env.mjs` | Validates `.env` |
| `npx inngest-cli@latest dev` | Inngest dev server — run alongside the app locally for welcome emails, price alerts, weekly digest |

### Required environment variables
`MONGODB_URI`, `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL`, `FINNHUB_API_KEY`. Copy `.env.example` to `.env` and fill in. `next build` freezes `NEXT_PUBLIC_*` values into the bundle, so Docker/Railway images built without secrets read `FINNHUB_API_KEY` (not the `NEXT_PUBLIC_` alias) at runtime via `lib/actions/finnhub.actions.ts`.

## Architecture

### Routing (Next.js App Router, route groups)
- `app/(marketing)/` — public pages: landing, about, help, api-docs, sponsor, love, changelog, `/s/[ticker]`, `/compare`
- `app/(auth)/` — sign-in, sign-up, forgot-password, reset-password
- `app/(root)/` — signed-in app: dashboard, watchlist, `stocks/[symbol]`, profile (middleware redirects to sign-in when no session)
- `app/api/` — `auth/[...all]` (Better Auth), `inngest` (background jobs), `quotes` (live prices)

`middleware.ts` uses `isPublicPath` from `lib/public-paths.ts` to let marketing/public pages through unauthenticated; everything else requires the session cookie. Public checks are whole-segment (`/s` does not unlock `/stocks` or `/sponsor`).

### Data layer
- `database/mongoose.ts` — cached Mongoose connection (`global.mongooseCache`), forces IPv4/Google DNS to avoid SRV lookup failures; connects on first use.
- `database/models/watchlist.model.ts` — `Watchlist` (userId + symbol unique index, max 50 per user).
- `database/models/alert.model.ts` — `Alert` (userId, symbol, targetPrice, ABOVE/BELOW condition, 90-day expiry, max 50 active).

### Auth
`lib/better-auth/auth.ts` — `getAuth()` connects to MongoDB on first use (not at import, so `next build` needs no reachable DB). Auth is exposed as a lazy Proxy so imports don't block builds. `getSession` is `cache()`d once per request. `requireUserId()` throws "Unauthorized" when there's no session — server actions must never trust a client-supplied userId. Social providers (Google/GitHub) enable only when their env vars are set; account linking is disabled.

### Server actions (`lib/actions/`)
All are `'use server'`. Each begins with `requireUserId()` where appropriate.
- `auth.actions.ts` — sign up (rate-limited per IP), sign in (per-IP + per-email), social sign-in, password reset/request, sign out. Sign-up also emits an Inngest `app/user.created` event for the welcome email.
- `watchlist.actions.ts` — add/remove/get/contains, symbol validated against `SYMBOL_PATTERN`, capped at 50.
- `alert.actions.ts` — create/get/delete, requires realtime mode, only US stocks / Binance pairs via `hasFinnhubQuotes`.
- `finnhub.actions.ts` — key pool (comma-separated `FINNHUB_API_KEYS` rotated per request), in-flight request queue (max 2 per key), per-URL deduplication, stale-while-revalidate cache, 429 → next key, failure cool-down (60s). Exports `getQuote`, `getLiveQuotes`, `getCompanyProfile`, `getStockMetrics`, `getWatchlistData`, `getNews`, `searchStocks` (cached; public instance returns `POPULAR_STOCKS` without calling Finnhub, signed-in search hits the API).
- `adanos.actions.ts`, `profile.actions.ts`, `user.actions.ts` — sentiment card, profile updates, user listing for the news digest.

### Market data mode
`lib/market-data.ts` — `DATA_MODE` is `realtime` only when `NEXT_PUBLIC_OPENSTOCK_DATA_MODE=realtime` (fixed at build time). `QUOTE_TTL_SECONDS` = 15s realtime / 3600s cached. `alertsEnabled` follows realtime mode. Markets are defined in `lib/markets.ts` (US, India, Germany, Canada, Australia, Crypto, Forex) with feed freshness and TradingView embed constraints.

### Background jobs (`lib/inngest/functions.ts`)
Four functions, all with AI-provider fallback via `callAIProviderWithFallback`:
- `sign-up-email` — on `app/user.created`, personalized welcome email.
- `weekly-news-summary` — cron `0 9 * * 1` (Mon 9AM UTC), Kit broadcast.
- `check-stock-alerts` — cron `*/5 * * * *`, concurrency 1, claims alerts atomically before emailing (releases claim on failure so the next run retries).
- `check-inactive-users` — cron `0 10 * * *`, logs intent; 1:1 send not wired up (Kit broadcast would mail the whole list).

### AI (`lib/ai-provider.ts`)
`callAIProvider(prompt, provider?)` — Gemini (REST `generateContent`) or OpenAI-compatible (MiniMax/Siray `chat/completions`). `callAIProviderWithFallback` tries primary (`AI_PROVIDER`, default gemini) then fallback (MiniMax if key set, else Siray; gemini otherwise). Tests stub global `fetch` and assert exact request shape (no unsupported thinking/reasoning parameters).

### Rate limiting
`lib/rate-limit.ts` — MongoDB fixed-window counters with TTL index, shared across serverless instances (better-auth's own limiter only covers `/api/auth` routes). Paired per-IP and per-account limits for sign-in/sign-up/password reset.

### Components
`components/ui/` — shadcn primitives (button, input, dialog, etc.). `components/shell/` — app shell. Feature folders: `stocks/`, `watchlist/`, `landing/`, `marketing/`, `forms/`, `profile/`, `sponsors/`, `seo/`. TradingView widget configs live in `lib/constants.ts` (candle chart, technicals, profile, financials, heatmap, timeline).

## Conventions to keep
- Server actions: validate all input (symbol regex, country/goal/risk/industry against `lib/constants.ts` options), never trust client `userId`, `revalidatePath` after mutations.
- Finnhub calls go through `fetchJSON` in `finnhub.actions.ts` — never `fetch` Finnhub directly elsewhere; respects the key pool, in-flight queue, and cache.
- New background jobs: add to `lib/inngest/functions.ts` and register the route in `app/api/inngest`.
- Tests: Vitest, globals + node environment, `@` aliased to repo root. Stub `fetch` globally; assert exact request URL/headers/body where the action documents it (see `__tests__/ai-provider.test.ts`).
- Builds set `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` to true — run `npm run lint` and `npx tsc --noEmit` separately before a PR.
