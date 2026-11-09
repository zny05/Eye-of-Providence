'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { getCompanyProfile, getLiveQuotes, getStockFactorMetrics, getStockPeers, getStockRecommendation } from '@/lib/actions/finnhub.actions';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { buildExplainView, type ExplainView } from '@/lib/eye/explain-view';
import { getCosmyDayEvents, nextEventDays, eventCountInDays } from '@/lib/eye/cosmyday';
import { parseSymbols } from '@/lib/eye/symbols';
import type { StockFactorRaw } from '@/lib/eye/types';

// Grey peers give the percentile scale and the "how does it compare" backdrop; Finnhub free allows ~60 calls a minute.
const BACKGROUND_MAX = 14;
const PEER_SOURCES = 3;

export interface EyeExplain {
    selected: string[];
    watchlist: { symbol: string; company: string }[];
    backgroundCount: number;
    view: ExplainView | null;
}

// Peers of the first few selected symbols (round-robin), then the user's own watchlist, up to BACKGROUND_MAX.
async function pickBackground(selected: string[], watchlist: string[]): Promise<string[]> {
    const lists = await Promise.all(selected.slice(0, PEER_SOURCES).map((s) => getStockPeers(s)));
    const out: string[] = [];
    const take = (symbol: string) => {
        if (out.length < BACKGROUND_MAX && !selected.includes(symbol) && !out.includes(symbol)) out.push(symbol);
    };
    for (let i = 0; out.length < BACKGROUND_MAX && lists.some((l) => i < l.length); i++) lists.forEach((l) => l[i] && take(l[i]));
    watchlist.forEach(take);
    return out;
}

export async function getEyeExplain(requested: string[]): Promise<EyeExplain> {
    // DB-first: getStockFactorMetrics / getCompanyProfile / getStockRecommendation read from the
    // FinnhubMetricSnapshot Mongo cache (TTL 12h) in steady state; live Finnhub is the miss/backfill
    // path and is also pre-warmed by the Inngest job every 6 hours. API key spend stays under the
    // free plan's 60/min and the page no longer waits on ~50 live Finnhub calls per load.
    // DB-first：稳态只读 Mongo，miss 才打 Finnhub，Inngest 每 6 小时预热。
    await requireUserId();
    const selected = parseSymbols(requested);
    const items: { symbol: string; company?: string }[] = await getUserWatchlist();
    const watchlist = items.map((i) => ({ symbol: i.symbol, company: i.company || i.symbol }));
    if (selected.length === 0) return { selected, watchlist, backgroundCount: 0, view: null };

    const background = await pickBackground(selected, watchlist.map((w) => w.symbol));
    const universe = [...selected, ...background];
    const quotes = await getLiveQuotes(universe);

    const stocks: StockFactorRaw[] = await Promise.all(
        universe.map(async (symbol) => {
            const [profile, metric, recommendation] = await Promise.all([
                getCompanyProfile(symbol),
                getStockFactorMetrics(symbol),
                selected.includes(symbol) ? getStockRecommendation(symbol) : null,
            ]);
            return {
                symbol,
                name: profile?.name || watchlist.find((w) => w.symbol === symbol)?.company || symbol,
                industry: profile?.finnhubIndustry ?? null,
                marketCap: profile?.marketCapitalization ?? null,
                price: quotes[symbol]?.c ?? null,
                changePct: quotes[symbol]?.dp ?? null,
                recommendation,
                metric: metric ?? {},
            };
        }),
    );

    // CosmyDay sky-event feed (DB-first too; null = unavailable, the two cosmyday axes
    // will show no-data / fetch-failed and ExplainView.astro.cosmyday will carry the error).
    // CosmyDay 天象 feed 也走 DB-first（12h TTL）；null 表示无数据，轴会显示 no-data/fetch-failed。
    const nowDate = new Date();
    let cosmyday: Parameters<typeof buildExplainView>[3];
    try {
        const snapshot = await getCosmyDayEvents();
        cosmyday = {
            nextEventDays: nextEventDays(snapshot, nowDate),
            eventCount7d: eventCountInDays(snapshot, 7, nowDate),
            error: snapshot.error,
        };
    } catch (error) {
        cosmyday = { nextEventDays: null, eventCount7d: 0, error: error instanceof Error ? error.message : String(error) };
    }

    return { selected, watchlist, backgroundCount: background.length, view: buildExplainView(stocks, selected, nowDate, cosmyday) };
}
