# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenStock — a free, open-source market data platform (Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui + Radix, Better Auth + MongoDB/Mongoose, Finnhub market data, TradingView widgets, Inngest background jobs, Nodemailer/Kit email, multi-provider AI: Gemini default with MiniMax/Siray/OpenRouter fallback).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with Turbopack (http://localhost:3000) — local development only |
| `npm run build` | Production build with Turbopack — local dev / CI only; Docker builds this internally |
| `npm start` | Start the production server — local dev / CI only; Docker runs this via `CMD` |
| `npm run lint` | ESLint |
| `npm test` | Vitest, runs once (`npm run test:watch` to keep watching) |
| `npx vitest run <path>` | Run a single test file, e.g. `npx vitest run __tests__/ai-provider.test.ts` |
| `npx tsc --noEmit` | Type check — builds skip type errors, so run this before opening a PR |
| `npm run test:db` | Checks the MongoDB connection |
| `node scripts/check-env.mjs` | Validates `.env` |
| `npx inngest-cli@latest dev` | Inngest dev server — run alongside the app locally for welcome emails, price alerts, weekly digest |
| `docker compose up -d --build` | **Production deployment on 飞牛NAS** — builds the Docker image and starts OpenStock + MongoDB containers |

> **Important:** Do **not** run `npm install` / `npm run build` / `npm start` directly on the 飞牛NAS host. The `Dockerfile` already runs `npm ci` + `npm run build` at image build time and `npm start` at container runtime. All intermediate artifacts (`node_modules`, `.next/`) stay inside the Docker image layers and never pollute the NAS host filesystem.

### Required environment variables
`MONGODB_URI`, `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL`, `FINNHUB_API_KEY`. Copy `.env.example` to `.env` and fill in. `next build` freezes `NEXT_PUBLIC_*` values into the bundle, so Docker/Railway images built without secrets read `FINNHUB_API_KEY` (not the `NEXT_PUBLIC_` alias) at runtime via `lib/actions/finnhub.actions.ts`.

## Architecture

### Routing (Next.js App Router, route groups)
- `app/(marketing)/` — public pages: landing, about, help, api-docs, sponsor, love, changelog, `/s/[ticker]`, `/compare`
- `app/(auth)/` — sign-in, sign-up, forgot-password, reset-password
- `app/(root)/` — signed-in app: dashboard, watchlist, `stocks/[symbol]`, profile, `eye` (middleware redirects to sign-in when no session)
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
- `alert.actions.ts` — create/get/delete, requires realtime mode, only US stocks / Binance pairs via `hasFinnhubQuotes`. `SYMBOL_PATTERN` itself accepts `600519.SS` but the `hasFinnhubQuotes` check immediately rejects `.SS`/`.SZ`; the Inngest checker (`lib/inngest/functions.ts`) calls `getQuote` directly with no gate, but no gated symbol can ever create an alert.
- `finnhub.actions.ts` — key pool (comma-separated `FINNHUB_API_KEYS` rotated per request), in-flight request queue (max 2 per key), per-URL deduplication, stale-while-revalidate cache, 429 → next key, failure cool-down (60s). Exports `getQuote`, `getLiveQuotes`, `getCompanyProfile`, `getStockMetrics`, `getWatchlistData`, `getNews`, `searchStocks` (cached; public instance returns `POPULAR_STOCKS` without calling Finnhub, signed-in search hits the API). Finnhub free returns `403` for non-US/non-crypto symbols (incl. `.SS`/`.SZ`), so quotes/profile/metrics/watchlist prices are gated by `hasFinnhubQuotes` and skipped; `searchStocks` has no such gate and can surface A-shares (dead end: watchlist price stays `0`).
- `adanos.actions.ts`, `profile.actions.ts`, `user.actions.ts` — sentiment card, profile updates, user listing for the news digest.
  - `adanos.actions.ts` additionally exports `getStockSentimentFromDb(symbol)` (reads latest snapshot per source from `AdanosSentimentSnapshot`, no Adanos API call) and `getStockSentimentInsightsCached(symbol)` (DB-first; falls back to live Adanos API only when no DB data or latest data is older than 48 hours). **When `getStockSentimentInsights` falls back to the live API, it now persists per-source results to `AdanosSentimentSnapshot`, so the `/adanos` overview page and future page views share the same MongoDB data.** Use these cached variants instead of `getStockSentimentInsights` on stock detail pages to avoid per-page-load Adanos requests.

### Market data mode
`lib/market-data.ts` — `DATA_MODE` is `realtime` only when `NEXT_PUBLIC_OPENSTOCK_DATA_MODE=realtime` (fixed at build time). `QUOTE_TTL_SECONDS` = 15s realtime / 3600s cached. `alertsEnabled` follows realtime mode. Markets are defined in `lib/markets.ts` (US, India, Germany, China A-Shares, Canada, Australia, Crypto, Forex) with feed freshness and TradingView embed constraints. China A-Shares was added 2026-11-04 as a TradingView-embed-only market (Tier 1): `MarketId` + entry in `lib/markets.ts`, `CN: 'cn'` in `COUNTRY_MARKET`, SSE/SZSE symbols already mapped in `lib/utils.ts`; no Finnhub quotes/alerts. `cn` pulse currently contains only the two indices `SSE:000001` (Shanghai Composite) / `SZSE:399001` (Shenzhen Component) after removing the initial `SSE:600519` / `SZSE:000858` tiles (K-line embeds verified working for `600519.SS`; A-share stocks remain in `groups`).

### Eye of Omniscience (`/eye`)
Price-explanation view: the user selects 1-12 instruments (URL `?s=AAPL,MSFT`), each drawn as a coloured line through a user-composed set of vertical-flow parallel-coordinate axes (each axis is a horizontal track, axes stack top to bottom). The user picks 2-16 axes, chooses each axis's data type independently from the catalog in `lib/eye/explain-view.ts` (`AXIS_CATALOG_IDS`; `DEFAULT_AXIS_IDS` is only the suggested starting layout: valuation, growth, quality, momentum, size/liquidity, analyst sentiment, a symbolic (astrology) layer, ending in today / 1 month / 1 quarter price outcomes), and reorders by dragging; the layout lives in the URL (`?axes=`). Grey background lines are Finnhub peers topped up from the watchlist (max 14). Spec: `docs/全视之眼_PCP价格解释视图_深度研究报告.md` (the earlier `全视之眼_高维平行坐标图分析模块_总体规划方案.md` §10 holds the geometry spec). Pure logic lives in `lib/eye/` (geometry, categorical layout, hit test, percentile scoring, `explain-view.ts` axis builder, `astro.ts` ephemeris via `astronomy-engine`) and is unit-tested in `__tests__/eye-*.test.ts`; UI in `components/eye/` (Canvas for lines, DOM for axis rows). Outcome axes are raw price changes and are never scored or weighted; the symbolic layer is a cultural overlay and never feeds a score. Finnhub reads go through `getStockFactorMetrics`, `getStockPeers`, `getStockRecommendation` in `finnhub.actions.ts` (the metric call reuses the `metric=all` URL/cache of `getStockMetrics`); never fetch Finnhub elsewhere. The module reads no Adanos data. Finnhub field names and units are unverified; axes are marked `unverified` until checked. `lib/eye/registry/industries.json` (130 industries from the knowledge base, `node scripts/build-eye-registry.mjs`) is kept as a data asset but is not shown in the UI.

### Background jobs (`lib/inngest/functions.ts`)
Four functions, all with AI-provider fallback via `callAIProviderWithFallback`:
- `sign-up-email` — on `app/user.created`, personalized welcome email.
- `weekly-news-summary` — cron `0 9 * * 1` (Mon 9AM UTC), Kit broadcast.
- `check-stock-alerts` — cron `*/5 * * * *`, concurrency 1, claims alerts atomically before emailing (releases claim on failure so the next run retries).
- `check-inactive-users` — cron `0 10 * * *`, logs intent; 1:1 send not wired up (Kit broadcast would mail the whole list).
- `collectAdanosSentimentJob` — cron `0 2 8,24 * *` (monthly 8th & 24th 02:00 UTC, was weekly Tuesday), concurrency 1, collects every watchlist symbol once per run and writes snapshots to `AdanosSentimentSnapshot`. **Not weekly/daily** — the shared Adanos free tier is only 250 requests/month across all endpoints, so bi-monthly cadence preserves quota. Before collecting each symbol, checks whether the latest persisted snapshot is older than 48 hours (or missing); fresh symbols are skipped entirely to avoid re-fetching and further preserve quota. Do not change back to weekly/daily without verifying remaining quota.

### AI (`lib/ai-provider.ts`)
`callAIProvider(prompt, provider?)` — Gemini (REST `generateContent`) or OpenAI-compatible (MiniMax/Siray `chat/completions`). `callAIProviderWithFallback` tries primary (`AI_PROVIDER`, default gemini) then fallback (MiniMax if key set, else Siray; gemini otherwise). Tests stub global `fetch` and assert exact request shape (no unsupported thinking/reasoning parameters).

### Rate limiting
`lib/rate-limit.ts` — MongoDB fixed-window counters with TTL index, shared across serverless instances (better-auth's own limiter only covers `/api/auth` routes). Paired per-IP and per-account limits for sign-in/sign-up/password reset.

### Components
`components/ui/` — shadcn primitives (button, input, dialog, etc.). `components/shell/` — app shell. Feature folders: `stocks/`, `watchlist/`, `landing/`, `marketing/`, `forms/`, `profile/`, `sponsors/`, `seo/`. TradingView widget configs live in `lib/constants.ts` (candle chart, technicals, profile, financials, heatmap, timeline). There is no TradingView API key (free or paid) — TV usage is browser iframe embeds only (`embed-widget-*.js` via `hooks/useTradingViewWidget.tsx`, `autosize:true` so height is driven by the parent `.tv-frame`). Don't plan a "plug in TV key" path; it doesn't exist. Upgrade paths for real quotes are paid Finnhub or a B-side vendor (Twelve Data/EODHD/Polygon) — relax `hasFinnhubQuotes` for `.SS`/`.SZ`, lift the `createAlert` gate, verify the Inngest checker.
  Non-US stock pages use `TradingViewHeader` in `components/stocks/StockHeader.tsx` when `!hasFinnhubQuotes(symbol)`. Its symbol-info widget height was raised 180→240 on 2026-11-04 so long company names (e.g. `KWEICHOW MOUTAI CO., LTD. CLASS A`) and stat rows fit; the long titles come from TradingView official data, so raise height rather than truncating names.

## Deployment on 飞牛NAS (Docker Compose)

OpenStock is containerized and intended to be deployed on 飞牛NAS via Docker Compose. Do **not** run npm commands on the NAS host.

### 1. Sync source code to NAS

Only sync tracked source files — never copy `node_modules/`, `.next/`, `.env`, or other local dev artifacts to the NAS. Recommended:

```bash
# On your local machine
git archive --format=zip HEAD -o openstock-deploy.zip
# Copy openstock-deploy.zip to the NAS and extract it
```

Or use `rsync` with exclusions:
```bash
rsync -av --delete --exclude='node_modules' --exclude='.next' --exclude='coverage' --exclude='.env' --exclude='.DS_Store' ./ nas-user@nas-ip:/path/to/openstock/
```

### 2. Configure environment on NAS

```bash
cd /path/to/openstock
cp .env.example .env
# Edit .env with NAS-specific values:
# MONGODB_URI, BETTER_AUTH_SECRET, BETTER_AUTH_URL, FINNHUB_API_KEY,
# AI_PROVIDER=openrouter, OPENROUTER_API_KEY, etc.
# Do NOT copy your local .env — NAS needs its own secrets.
```

### 3. Build and start

```bash
docker compose up -d --build
```

This builds the image (running `npm ci` + `npm run build` inside Docker) and starts the OpenStock + MongoDB containers. All build artifacts stay inside Docker image layers.

### 4. Cleanup (optional, to reclaim Docker space)

```bash
docker image prune -f
docker builder prune -f
```

## Conventions to keep
- Server actions: validate all input (symbol regex, country/goal/risk/industry against `lib/constants.ts` options), never trust client `userId`, `revalidatePath` after mutations.
- Finnhub calls go through `fetchJSON` in `finnhub.actions.ts` — never `fetch` Finnhub directly elsewhere; respects the key pool, in-flight queue, and cache.
- Adanos calls go through `fetchAdanosJSON` in `lib/adanos/fetch.ts` — never `fetch` Adanos directly elsewhere. Respects the API key pool, in-flight queue, per-URL dedup, stale-while-revalidate cache, 429 key rotation, failure cooldown, and per-key monthly-quota circuit breaker: when a key returns "Monthly API limit exceeded", that key is marked exhausted until its `reset_at` date and the next key is used; only when ALL keys are exhausted is the global circuit breaker tripped until the earliest `reset_at`.
- Adanos quota is 250 requests/month shared across ALL endpoints per key. Never schedule Adanos collection more than monthly 8th & 24th (`0 2 8,24 * *`). Stock detail pages read sentiment from `AdanosSentimentSnapshot` via `getStockSentimentInsightsCached` (DB-first, 48-hour staleness window). The `/adanos` overview page reads only from `AdanosSentimentSnapshot`; when MongoDB is empty it falls back to `getStockSentimentInsightsCached` (live API) so per-source rows are not blank — this fallback fires only when no snapshot exists.
- New background jobs: add to `lib/inngest/functions.ts` and register the route in `app/api/inngest`.
- Tests: Vitest, globals + node environment, `@` aliased to repo root. Stub `fetch` globally; assert exact request URL/headers/body where the action documents it (see `__tests__/ai-provider.test.ts`). Run targeted tests via `npm test -- __tests__/<file>.test.ts` — bare `npx vitest` fails on this machine with `Cannot read properties of undefined (reading 'config')`. `__tests__/ai-provider.integration.test.ts` always fails offline (Google connect timeout) and is pre-existing noise.
- Builds set `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` to true — run `npm run lint` and `npx tsc --noEmit` separately before a PR.
