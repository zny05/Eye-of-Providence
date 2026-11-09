'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { getCompanyProfile, getLiveQuotes, getStockFactorMetrics, getStockRecommendation } from '@/lib/actions/finnhub.actions';
import { getStockSentimentFromDb } from '@/lib/actions/adanos.actions';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { buildExplainView, classifyInstrument, type ExplainView } from '@/lib/eye/explain-view';
import { getCosmyDayEvents, getCosmyDayTransit, nextEvent, nextEventDays, eventCountInDays } from '@/lib/eye/cosmyday';
import { parseSymbols } from '@/lib/eye/symbols';
import type { StockFactorRaw, StockSentimentRaw } from '@/lib/eye/types';

// Grey peers are the "how does it compare" backdrop. Finnhub free allows ~60
// calls a minute, but the background is capped by BACKGROUND_MAX so a 12-symbol
// selection plus 14 peers never bursts past the limit on one page load.
// Background now comes ONLY from the user's Watchlist — Finnhub /stock/peers
// was removed because peers outside the Watchlist appeared as grey lines the
// user never asked for. Symbols not in the Watchlist never appear as peers.
const BACKGROUND_MAX = 14;

export interface EyeExplain {
    selected: string[];
    watchlist: { symbol: string; company: string }[];
    backgroundCount: number;
    view: ExplainView | null;
}

// Background = the user's own Watchlist symbols only, capped at BACKGROUND_MAX.
// No Finnhub /stock/peers — a symbol the user hasn't put in their Watchlist (or
// selected) never shows up as a grey peer line.
function pickBackground(selected: string[], watchlist: string[]): string[] {
    return watchlist.filter((s) => !selected.includes(s)).slice(0, BACKGROUND_MAX);
}

/**
 * Adanos sentiment aggregates from Mongo only — never calls the Adanos API.
 * Adanos free is 250 requests/month shared across every endpoint, so /eye
 * must not burn it per page load; anything never collected stays no-data.
 */
async function getSentimentForSymbol(symbol: string): Promise<StockSentimentRaw | null> {
    try {
        const { insights, latestCollectedAt } = await getStockSentimentFromDb(symbol);
        if (!insights) return null;
        const totalMentions = insights.sources.reduce((sum, s) => sum + (s.metricValue ?? 0), 0);
        return {
            averageBuzz: insights.averageBuzz ?? null,
            bullishAverage: insights.bullishAverage ?? null,
            coverage: insights.availableSources ?? null,
            totalMentions: totalMentions > 0 ? totalMentions : null,
            latestCollectedAt: latestCollectedAt ?? null,
        };
    } catch {
        return null;
    }
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

    const background = pickBackground(selected, watchlist.map((w) => w.symbol));
    const universe = [...selected, ...background];
    const quotes = await getLiveQuotes(universe);

    const stocks: StockFactorRaw[] = await Promise.all(
        universe.map(async (symbol) => {
            const [profile, metric, recommendation, sentiment] = await Promise.all([
                getCompanyProfile(symbol),
                getStockFactorMetrics(symbol),
                selected.includes(symbol) ? getStockRecommendation(symbol) : null,
                // Sentiment is Mongo-only. Peers get it too so the percentile
                // scale has neighbours, but only selected symbols are guaranteed warm.
                getSentimentForSymbol(symbol),
            ]);
            const name = profile?.name || watchlist.find((w) => w.symbol === symbol)?.company || symbol;
            const industry = profile?.finnhubIndustry ?? null;
            const profileType = profile?.type ?? null;
            const kind = classifyInstrument(symbol, profileType, name, industry);
            return {
                symbol,
                name,
                industry,
                marketCap: profile?.marketCapitalization ?? null,
                price: quotes[symbol]?.c ?? null,
                changePct: quotes[symbol]?.dp ?? null,
                recommendation,
                metric: metric ?? {},
                sentiment,
                kind,
                profileType,
            };
        }),
    );

    // CosmyDay sky-event feed (DB-first too; null = unavailable, the two cosmyday axes
    // will show no-data / fetch-failed and ExplainView.astro.cosmyday will carry the error).
    // CosmyDay 天象 feed 也走 DB-first（12h TTL）；null 表示无数据，轴会显示 no-data/fetch-failed。
    // The banner theme (transit/moon text) is read with the same DB-first path:
    // when the event snapshot is warm we reuse its freshness; a cold snapshot falls
    // back to a single live /content/transit fetch per page load (still cached by
    // the snapshot on the next warm-up cycle).
    const nowDate = new Date();
    let cosmyday: Parameters<typeof buildExplainView>[3];
    try {
        const [snapshot, transit] = await Promise.all([
            getCosmyDayEvents(),
            getCosmyDayTransit(),
        ]);
        const ne = nextEvent(snapshot, nowDate);
        cosmyday = {
            nextEventDays: ne?.days ?? nextEventDays(snapshot, nowDate),
            eventCount7d: eventCountInDays(snapshot, 7, nowDate),
            error: snapshot.error,
            nextEvent: ne ? { days: ne.days, headline: ne.event.headline ?? ne.event.kind ?? 'Sky event', date: ne.event.date } : null,
            theme: transit?.theme ?? null,
            fetchedAgoMs: snapshot.fetchedAt ? nowDate.getTime() - snapshot.fetchedAt.getTime() : null,
        };
    } catch (error) {
        cosmyday = { nextEventDays: null, eventCount7d: 0, error: error instanceof Error ? error.message : String(error), nextEvent: null, theme: null, fetchedAgoMs: null };
    }

    return { selected, watchlist, backgroundCount: background.length, view: buildExplainView(stocks, selected, nowDate, cosmyday) };
}
