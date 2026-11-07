'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { POPULAR_STOCKS } from '@/lib/constants';
import { cache } from 'react';
import { QUOTE_TTL_SECONDS } from '@/lib/market-data';
import { hasFinnhubQuotes } from '@/lib/markets';
import { getSession } from '@/lib/better-auth/auth';
import { FACTOR_METRIC_KEYS, type FactorMetricKey } from '@/lib/eye/types';
import { connectToDatabase } from '@/database/mongoose';
import { FinnhubMetricSnapshot, FINNHUB_METRIC_TTL_MS } from '@/database/models/finnhub-metric.model';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
// Key pool: each free key has its own 60 req/min, so N keys = N x the quota. Rotated per request.
// Read through an alias: `next build` freezes a literal process.env.NEXT_PUBLIC_* into the bundle, so Docker and
// Railway images (built without secrets) would ignore a NEXT_PUBLIC_FINNHUB_API_KEY set at runtime.
const env = process.env;
const FINNHUB_KEYS = (env.FINNHUB_API_KEYS || env.NEXT_PUBLIC_FINNHUB_API_KEY || env.FINNHUB_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
let nextKeyIndex = 0;
const FETCH_TIMEOUT_MS = 5000;
// Finnhub stalls bursts of parallel requests from one key (measured: 4 at once -> most hang),
// so calls are queued. ponytail: per-instance limiter; a shared queue (Redis) if instances multiply.
const MAX_IN_FLIGHT_PER_KEY = 2;
const MAX_CACHE_ENTRIES = 1000;
const FAILURE_TTL_MS = 60_000;
// Quotes are shared across everyone looking at a symbol: Finnhub cost scales with symbols, not users
const LIVE_QUOTE_TTL = QUOTE_TTL_SECONDS;
// Long-lived responses also go to the Next data cache, which Vercel shares across all instances
const SHARED_CACHE_MIN_TTL = 60;

type FinnhubQuote = {
    c?: number;  // current
    d?: number;  // change
    dp?: number; // change %
    h?: number;  // day high
    l?: number;  // day low
    o?: number;  // open
    pc?: number; // previous close
    t?: number;  // unix time of the last trade
};

type FinnhubStockMetrics = {
    metric?: Record<string, number | string | null | undefined>;
};

type FinnhubCompanyProfile = {
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    name?: string;
    ticker?: string;
    finnhubIndustry?: string;
    weburl?: string;
};

type SearchStockCandidate = FinnhubSearchResult & {
    __exchange?: string;
};

const FINNHUB_EXCHANGE_SUFFIXES = new Set([
    'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
    'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
    'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SS', 'ST', 'SW', 'SZ', 'T',
    'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);

// Thrown instead of calling Finnhub while an endpoint is in its failure cool-down; not worth logging again.
class RecentFailure extends Error {}
const logFailure = (what: string, symbol: string, e: unknown) => {
    if (!(e instanceof RecentFailure)) console.error(`Error fetching ${what} for`, symbol, e);
};

let activeRequests = 0;
const waitingForSlot: (() => void)[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { value: unknown; freshUntil: number; failed?: boolean }>();

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (activeRequests >= MAX_IN_FLIGHT_PER_KEY * Math.max(1, FINNHUB_KEYS.length)) await new Promise<void>((resolve) => waitingForSlot.push(resolve));
    activeRequests++;
    try {
        return await run();
    } finally {
        activeRequests--;
        waitingForSlot.shift()?.();
    }
}

// The token travels in a header, so cache keys are the same whichever key served them.
// On 429 the next key in the pool gets a turn.
async function fetchWithKeyPool(url: string, ttl: number) {
    if (FINNHUB_KEYS.length === 0) throw new Error('No Finnhub API key configured (FINNHUB_API_KEYS)');
    let res: Response | null = null;
    for (let attempt = 0; attempt < FINNHUB_KEYS.length; attempt++) {
        const key = FINNHUB_KEYS[nextKeyIndex++ % FINNHUB_KEYS.length];
        res = await fetch(url, {
            headers: { 'X-Finnhub-Token': key },
            // Without a timeout a stalled Finnhub socket holds the page for Node's 300s default
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            ...(ttl >= SHARED_CACHE_MIN_TTL ? { next: { revalidate: ttl } } : { cache: 'no-store' as const }),
        });
        if (res.status !== 429) break;
    }
    return res!;
}

// One network call per URL at a time, however many pages ask for it
function request<T>(url: string, ttl = 0): Promise<T> {
    let pending = inFlight.get(url) as Promise<T> | undefined;
    if (!pending) {
        pending = withSlot(async () => {
            const res = await fetchWithKeyPool(url, ttl);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Fetch failed ${res.status}: ${text}`);
            }
            return (await res.json()) as T;
        }).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
    }
    return pending;
}

// Stale-while-revalidate: after the first fetch nobody waits on Finnhub; expired entries
// are served instantly and refreshed in the background.
async function fetchJSON<T>(url: string, revalidateSeconds = 0): Promise<T> {
    if (!revalidateSeconds) return request<T>(url);

    const store = (entry: { value: unknown; freshUntil: number; failed?: boolean }) => {
        if (responseCache.size >= MAX_CACHE_ENTRIES) responseCache.delete(responseCache.keys().next().value!);
        responseCache.set(url, entry);
    };
    const refresh = () => request<T>(url, revalidateSeconds).then(
        (value) => {
            store({ value, freshUntil: Date.now() + revalidateSeconds * 1000 });
            return value;
        },
        (error) => {
            // A stalling endpoint fails fast for a minute instead of costing every visitor the full timeout.
            // A stale value keeps being served, but its next refresh also waits out the cool-down.
            const existing = responseCache.get(url);
            store(existing && !existing.failed
                ? { value: existing.value, freshUntil: Date.now() + FAILURE_TTL_MS }
                : { value: null, freshUntil: Date.now() + FAILURE_TTL_MS, failed: true });
            throw error;
        },
    );

    const hit = responseCache.get(url);
    if (!hit || (hit.failed && hit.freshUntil < Date.now())) return refresh();
    if (hit.failed) throw new RecentFailure(`Finnhub request failed recently: ${url.split('?')[0]}`);
    if (hit.freshUntil < Date.now()) refresh().catch(() => { /* keep serving the stale value */ });
    return hit.value as T;
}

/* -------------------------------------------------------------
 * DB-first Finnhub metric cache (FinnhubMetricSnapshot, TTL 12h).
 * English: /eye and the watchlist can fan out 50+ Finnhub calls per page load
 * and exhaust the free plan's 60/min. Persisting here makes the steady state a
 * pure Mongo read; live Finnhub only runs on miss or from the warm-up job.
 * 中文：/eye 和自选页一次页面加载可能发出 50+ 个 Finnhub 请求，撑爆免费版 60/min。
 * 把 metric=all 响应落库后，稳态只是读 Mongo；只有 miss 或定时预热才真的打 API。
 * ------------------------------------------------------------- */

export interface FinnhubMetricFromDb {
    metric: Record<string, number | string | null | undefined> | null;
    profile: Record<string, unknown> | null;
    recommendation: Array<Record<string, unknown>> | null;
    fetchedAt: Date;
}

/** Read a Finnhub metric snapshot from Mongo if it's fresh (within TTL) and status 200. / 从 Mongo 读快照。 */
export async function getFinnhubMetricFromDb(symbol: string): Promise<FinnhubMetricFromDb | null> {
    try {
        await connectToDatabase();
    } catch {
        return null;
    }
    const since = new Date(Date.now() - FINNHUB_METRIC_TTL_MS);
    const doc = await FinnhubMetricSnapshot.findOne({
        symbol: symbol.toUpperCase(),
        status: 200,
        fetchedAt: { $gte: since },
    }).lean().exec();
    if (!doc) return null;
    const d = doc as Record<string, unknown>;
    return {
        metric: (d.metric as FinnhubMetricFromDb['metric']) ?? null,
        profile: (d.profile as FinnhubMetricFromDb['profile']) ?? null,
        recommendation: (d.recommendation as FinnhubMetricFromDb['recommendation']) ?? null,
        fetchedAt: (d.fetchedAt as Date) ?? new Date(),
    };
}

async function upsertFinnhubMetricSnapshot(
    symbol: string,
    payload: {
        status: number;
        metric?: Record<string, number | string | null | undefined> | null;
        profile?: Record<string, unknown> | null;
        recommendation?: Array<Record<string, unknown>> | null;
        rawError?: string | null;
    }
): Promise<void> {
    try {
        await connectToDatabase();
        const now = new Date();
        const doc: Record<string, unknown> = {
            symbol: symbol.toUpperCase(),
            fetchedAt: now,
            status: payload.status,
            metric: payload.metric ?? {},
            profile: payload.profile ?? null,
            recommendation: payload.recommendation ?? null,
            rawError: payload.rawError ?? null,
            ttlExpiresAt: new Date(now.getTime() + FINNHUB_METRIC_TTL_MS),
        };
        // A 429 / network error must not clobber a previously-good 200 snapshot:
        // only write a non-200 marker when there is no good record yet.
        // 429/网络错误不能覆盖已有的 200 好记录——只有当前没有好记录时才写非 200 标记。
        if (payload.status !== 200) {
            const existing = await FinnhubMetricSnapshot.findOne({
                symbol: symbol.toUpperCase(),
                status: 200,
            }).lean().exec();
            if (existing) return;
        }
        await FinnhubMetricSnapshot.updateOne(
            { symbol: symbol.toUpperCase() },
            { $set: doc },
            { upsert: true }
        );
    } catch (e) {
        // Mongo write failures must never break the user-facing path.
        console.error('Finnhub metric snapshot upsert failed for', symbol, (e as Error)?.message);
    }
}

function getExchangeLabel(symbol: string, exchange?: string) {
    if (exchange?.trim()) {
        return exchange.trim();
    }

    const parts = symbol.split('.');
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    if (!suffix) {
        return 'US';
    }

    return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol: string, revalidateSeconds = 0) {
    try {
        const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`;
        // Real-time by default; shared views pass a short cache to stay inside Finnhub's 60 req/min
        return await fetchJSON<FinnhubQuote>(url, revalidateSeconds);
    } catch (e) {
        logFailure('quote', symbol, e);
        return null;
    }
}

// Shared, short-lived quotes for anything shown live on screen (pages and /api/quotes)
export async function getLiveQuotes(symbols: string[]) {
    // Symbols the free plan can't price are skipped instead of spending a request on a 403
    const quotes = await Promise.all(symbols.map((s) => (hasFinnhubQuotes(s) ? getQuote(s, LIVE_QUOTE_TTL) : null)));
    return Object.fromEntries(symbols.map((s, i) => [s, quotes[i]?.c ? quotes[i] : null]));
}

export async function getCompanyProfile(symbol: string) {
    // Profiles exist for stocks Finnhub free covers; crypto pairs and non-US listings have none
    if (symbol.includes(':') || !hasFinnhubQuotes(symbol)) return null;
    // DB-first: serve from the FinnhubMetricSnapshot cache when fresh (TTL 12h).
    // DB-first：先读 Mongo 缓存（TTL 12h），miss 才实时调用 Finnhub。
    const fromDb = await getFinnhubMetricFromDb(symbol);
    if (fromDb?.profile) {
        const p = fromDb.profile as Record<string, unknown>;
        return {
            currency: typeof p.currency === 'string' ? p.currency : undefined,
            exchange: typeof p.exchange === 'string' ? p.exchange : undefined,
            logo: typeof p.logo === 'string' ? p.logo : undefined,
            marketCapitalization: typeof p.marketCapitalization === 'number' ? p.marketCapitalization : undefined,
            name: typeof p.name === 'string' ? p.name : undefined,
            ticker: typeof p.ticker === 'string' ? p.ticker : undefined,
            finnhubIndustry: typeof p.finnhubIndustry === 'string' ? p.finnhubIndustry : undefined,
            weburl: typeof p.weburl === 'string' ? p.weburl : undefined,
        } as FinnhubCompanyProfile;
    }
    try {
        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
        // Cache profile for 24 hours
        const profile = await fetchJSON<FinnhubCompanyProfile>(url, 86400);
        await upsertFinnhubMetricSnapshot(symbol, {
            status: 200,
            profile: profile as unknown as Record<string, unknown>,
        });
        return profile;
    } catch (e) {
        logFailure('profile', symbol, e);
        return null;
    }
}

export async function getStockMetrics(symbol: string): Promise<number | null> {
    if (FINNHUB_KEYS.length === 0) {
        console.error('FINNHUB API key is not configured');
        return null;
    }

    try {
        const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
        const data = await fetchJSON<FinnhubStockMetrics>(url, 3600);
        const dividendYield = data?.metric?.dividendYieldIndicatedAnnual;
        return typeof dividendYield === 'number' && Number.isFinite(dividendYield)
            ? dividendYield
            : null;
    } catch (error) {
        logFailure('stock metrics', symbol, error);
        return null;
    }
}

// Same URL and TTL as getStockMetrics, so both share one cached response and one Finnhub request.
// DB-first (FinnhubMetricSnapshot, TTL 12h): steady state is a pure Mongo read; the live Finnhub
// call only runs on miss/backfill or from the Inngest warm-up job. / DB-first：稳态只读 Mongo。
export async function getStockFactorMetrics(symbol: string): Promise<Partial<Record<FactorMetricKey, number | null>> | null> {
    if (FINNHUB_KEYS.length === 0 || !hasFinnhubQuotes(symbol)) return null;

    const fromDb = await getFinnhubMetricFromDb(symbol);
    if (fromDb?.metric) {
        const out: Partial<Record<FactorMetricKey, number | null>> = {};
        for (const key of FACTOR_METRIC_KEYS) {
            const v = fromDb.metric[key];
            out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
        }
        return out;
    }

    try {
        const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
        const data = await fetchJSON<FinnhubStockMetrics>(url, 3600);
        const metric = data?.metric;
        if (!metric) {
            await upsertFinnhubMetricSnapshot(symbol, { status: 0, metric: null, rawError: 'empty metric' });
            return null;
        }
        const out: Partial<Record<FactorMetricKey, number | null>> = {};
        for (const key of FACTOR_METRIC_KEYS) {
            const v = metric[key];
            out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
        }
        await upsertFinnhubMetricSnapshot(symbol, {
            status: 200,
            metric: metric as Record<string, number | string | null | undefined>,
        });
        return out;
    } catch (error) {
        logFailure('factor metrics', symbol, error);
        await upsertFinnhubMetricSnapshot(symbol, {
            status: 0,
            rawError: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Pre-warm the FinnhubMetricSnapshot cache for Inngest (serial, 1s pacing).
 * English: used by `warmFinnhubMetricCacheJob` every 6h. Bypasses the DB check so
 * stale entries are refreshed; never throws — per-symbol failures are logged.
 * 中文：供 Inngest 每 6 小时调用，串行 + 1s 间隔预热 watchlist 标的，绕过 DB 检查强制刷新。
 */
export async function warmFinnhubMetricCache(symbols: string[]): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const raw of symbols) {
        const symbol = raw.toUpperCase();
        if (!hasFinnhubQuotes(symbol)) continue;
        const [profileResult, metricResult] = await Promise.allSettled([
            getCompanyProfile(symbol),
            getStockFactorMetrics(symbol),
        ]);
        // getCompanyProfile/getStockFactorMetrics already write to Mongo on success;
        // here we also record a non-200 marker if both failed and no snapshot exists.
        const goods = [profileResult.status === 'fulfilled' && profileResult.value !== null,
            metricResult.status === 'fulfilled' && metricResult.value !== null];
        if (goods.some(Boolean)) ok++;
        else failed++;
    }
    return { ok, failed };
}

// Companies Finnhub groups with this one (same industry). Endpoint availability on the free plan is unverified.
export async function getStockPeers(symbol: string): Promise<string[]> {
    if (FINNHUB_KEYS.length === 0 || !hasFinnhubQuotes(symbol)) return [];

    try {
        const url = `${FINNHUB_BASE_URL}/stock/peers?symbol=${encodeURIComponent(symbol)}`;
        const peers = await fetchJSON<unknown>(url, 86400);
        return Array.isArray(peers)
            ? peers.filter((p): p is string => typeof p === 'string' && p !== symbol && !p.includes(':') && hasFinnhubQuotes(p))
            : [];
    } catch (error) {
        logFailure('peers', symbol, error);
        return [];
    }
}

// Latest analyst consensus mapped to 1 (strong sell) .. 5 (strong buy). Free-plan access verified 2026-11-07:
// /stock/recommendation returns 200 with rows on free; /stock/price-target is 403 on free and is NOT used.
// DB-first: steady state reads the FinnhubMetricSnapshot recommendation payload (TTL 12h).
export async function getStockRecommendation(symbol: string): Promise<number | null> {
    if (FINNHUB_KEYS.length === 0 || !hasFinnhubQuotes(symbol)) return null;

    const fromDb = await getFinnhubMetricFromDb(symbol);
    if (fromDb?.recommendation && fromDb.recommendation.length) {
        const rows = fromDb.recommendation as Array<{ period?: string; strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }>;
        const latest = [...rows].sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
        if (latest) {
            const counts = [latest.strongSell, latest.sell, latest.hold, latest.buy, latest.strongBuy].map((n) => (typeof n === 'number' && n > 0 ? n : 0));
            const total = counts.reduce((a, b) => a + b, 0);
            if (total > 0) return counts.reduce((sum, n, i) => sum + n * (i + 1), 0) / total;
        }
    }

    try {
        const url = `${FINNHUB_BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(symbol)}`;
        const rows = await fetchJSON<{ period?: string; strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }[]>(url, 3600);
        if (Array.isArray(rows) && rows.length) {
            await upsertFinnhubMetricSnapshot(symbol, {
                status: 200,
                recommendation: rows as unknown as Array<Record<string, unknown>>,
            });
        }
        const latest = Array.isArray(rows) ? [...rows].sort((a, b) => String(b.period).localeCompare(String(a.period)))[0] : undefined;
        if (!latest) return null;
        const counts = [latest.strongSell, latest.sell, latest.hold, latest.buy, latest.strongBuy].map((n) => (typeof n === 'number' && n > 0 ? n : 0));
        const total = counts.reduce((a, b) => a + b, 0);
        return total === 0 ? null : counts.reduce((sum, n, i) => sum + n * (i + 1), 0) / total;
    } catch (error) {
        logFailure('recommendation', symbol, error);
        return null;
    }
}

export async function getWatchlistData(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    // Fetch quotes and profiles in parallel
    const promises = symbols.map(async (sym) => {
        const covered = hasFinnhubQuotes(sym);
        const [quote, profile] = covered
            ? await Promise.all([getQuote(sym, LIVE_QUOTE_TTL), getCompanyProfile(sym)])
            : [null, null];

        return {
            symbol: sym,
            price: quote?.c || 0,
            change: quote?.d || 0,
            changePercent: quote?.dp || 0,
            currency: profile?.currency || 'USD',
            name: profile?.name || sym,
            logo: profile?.logo,
            marketCap: profile?.marketCapitalization,
            peRatio: 0 // Finnhub 'quote' and 'profile2' don't easily give real-time PE. Might need 'metric' endpoint, but skipping for now to save rate limits.
        };
    });

    return await Promise.all(promises);
}


export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    try {
        const range = getDateRange(5);
        if (FINNHUB_KEYS.length === 0) {
            throw new Error('FINNHUB API key is not configured');
        }
        const cleanSymbols = (symbols || [])
            .map((s) => s?.trim().toUpperCase())
            .filter((s): s is string => Boolean(s));

        const maxArticles = 6;

        // If we have symbols, try to fetch company news per symbol and round-robin select
        if (cleanSymbols.length > 0) {
            const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

            await Promise.all(
                cleanSymbols.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}`;
                        const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
                        perSymbolArticles[sym] = (articles || []).filter(validateArticle);
                    } catch (e) {
                        console.error('Error fetching company news for', sym, e);
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            const collected: MarketNewsArticle[] = [];
            // Round-robin up to 6 picks
            for (let round = 0; round < maxArticles; round++) {
                for (let i = 0; i < cleanSymbols.length; i++) {
                    const sym = cleanSymbols[i];
                    const list = perSymbolArticles[sym] || [];
                    if (list.length === 0) continue;
                    const article = list.shift();
                    if (!article || !validateArticle(article)) continue;
                    collected.push(formatArticle(article, true, sym, round));
                    if (collected.length >= maxArticles) break;
                }
                if (collected.length >= maxArticles) break;
            }

            if (collected.length > 0) {
                // Sort by datetime desc
                collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                return collected.slice(0, maxArticles);
            }
            // If none collected, fall through to general news
        }

        // General market news fallback or when no symbols provided
        const generalUrl = `${FINNHUB_BASE_URL}/news?category=general`;
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();
        const unique: RawNewsArticle[] = [];
        for (const art of general || []) {
            if (!validateArticle(art)) continue;
            const key = `${art.id}-${art.url}-${art.headline}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(art);
            if (unique.length >= 20) break; // cap early before final slicing
        }

        const formatted = unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
        return formatted;
    } catch (err) {
        console.error('getNews error:', err);
        throw new Error('Failed to fetch news');
    }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
        if (FINNHUB_KEYS.length === 0) {
            // If no token, log and return empty to avoid throwing per requirements
            console.error('Error in stock search:', new Error('FINNHUB API key is not configured'));
            return [];
        }

        const trimmed = typeof query === 'string' ? query.trim() : '';

        let results: SearchStockCandidate[] = [];

        if (!trimmed) {
            // Shown in the palette on every page, so no API calls: Finnhub's free tier is 60 req/min
            results = POPULAR_STOCKS.map(({ symbol, name, exchange }) => ({
                symbol,
                description: name,
                displaySymbol: symbol,
                type: 'Common Stock',
                __exchange: exchange,
            }));
        } else {
            // A public server action: only signed-in users may spend Finnhub quota on searches
            if (!(await getSession())?.user) return [];
            const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}`;
            const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
            results = Array.isArray(data?.result) ? data.result : [];
        }

        const mapped: StockWithWatchlistStatus[] = results
            .map((r) => {
                const upper = (r.symbol || '').toUpperCase();
                const name = r.description || upper;
                const exchangeFromProfile = r.__exchange;
                const exchange = getExchangeLabel(upper, exchangeFromProfile);
                const type = r.type || 'Stock';
                const item: StockWithWatchlistStatus = {
                    symbol: upper,
                    name,
                    exchange,
                    type,
                    isInWatchlist: false,
                };
                return item;
            })
            .slice(0, 15);

        return mapped;
    } catch (err) {
        console.error('Error in stock search:', err);
        return [];
    }
});
