'use server';

import {
    buildStockSentimentInsights,
    normalizeSourceInsight,
    SOURCE_CONFIG,
    type SentimentSourceInsight,
    type SentimentSourceKey,
    type SentimentTrend,
    type SourceComparePayload,
    type StockSentimentInsights,
} from './adanos.helpers';
import { fetchAdanosJSON, ADANOS_BASE_URL, RecentFailure, MonthlyQuotaExceeded } from '@/lib/adanos/fetch';

const DEFAULT_LOOKBACK_DAYS = 7;

type SourceFetchResult = {
    insight: SentimentSourceInsight | null;
    rawRow: Record<string, unknown> | null;
};

async function fetchCompareSource(
    source: SentimentSourceKey,
    symbol: string,
    days: number,
): Promise<SourceFetchResult> {
    try {
        const url = new URL(`${ADANOS_BASE_URL}${SOURCE_CONFIG[source].path}`);
        url.searchParams.set('tickers', symbol.toUpperCase());
        url.searchParams.set('days', String(days));

        const payload = await fetchAdanosJSON<SourceComparePayload>(url.toString());
        const row = payload?.stocks?.find((item) => item.ticker?.toUpperCase() === symbol.toUpperCase());

        return {
            insight: normalizeSourceInsight(source, row),
            rawRow: row ?? null,
        };
    } catch (error) {
        if (error instanceof RecentFailure || error instanceof MonthlyQuotaExceeded) {
            // 在失败冷却期内，或月度配额已耗尽，静默跳过，不重复打印错误
            return { insight: null, rawRow: null };
        }
        const message = (error as Error).message;
        if (message.includes('404')) return { insight: null, rawRow: null };
        console.error(`Adanos ${source} compare request failed for ${symbol}`, error);
        return { insight: null, rawRow: null };
    }
}

export async function getStockSentimentInsights(
    symbol: string,
    days: number = DEFAULT_LOOKBACK_DAYS,
): Promise<StockSentimentInsights | null> {
    if (!process.env.ADANOS_API_KEY || !symbol?.trim()) {
        return null;
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const lookbackDays = Math.max(1, Math.min(days, 30));
    const sourceKeys = Object.keys(SOURCE_CONFIG) as SentimentSourceKey[];

    const results = await Promise.all(
        sourceKeys.map((source) => fetchCompareSource(source, normalizedSymbol, lookbackDays)),
    );

    const sources: SentimentSourceInsight[] = [];
    const rawRows: Array<{ source: SentimentSourceKey; row: Record<string, unknown> }> = [];
    // Promise.all preserves order, so results[i] corresponds to sourceKeys[i].
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const source = sourceKeys[i];
        if (result.insight) sources.push(result.insight);
        if (result.rawRow) rawRows.push({ source, row: result.rawRow });
    }

    // Persist live per-source data to MongoDB so the /adanos overview page and
    // future page views can read from the local DB instead of calling Adanos again.
    if (rawRows.length > 0) {
        await persistLiveSnapshots(normalizedSymbol, rawRows);
    }

    return buildStockSentimentInsights(normalizedSymbol, sources);
}

/**
 * Persist live Adanos per-source data into AdanosSentimentSnapshot so that the
 * /adanos overview page (and subsequent stock-page views) can read from MongoDB
 * without another Adanos API call. Uses upsert so each symbol+source keeps one
 * latest snapshot.
 */
async function persistLiveSnapshots(
    symbol: string,
    rows: Array<{ source: SentimentSourceKey; row: Record<string, unknown> }>,
): Promise<void> {
    const { connectToDatabase } = await import('@/database/mongoose');
    const { AdanosSentimentSnapshot } = await import('@/database/models/adanos-sentiment.model');
    await connectToDatabase();

    const now = new Date();
    for (const { source, row } of rows) {
        const normalized = normalizeRowFromLive(source, row);
        if (!normalized) continue;

        await AdanosSentimentSnapshot.replaceOne(
            { symbol, source },
            {
                symbol,
                source,
                collectedAt: now,
                buzzScore: normalized.buzzScore,
                sentimentScore: normalized.sentimentScore,
                bullishPct: normalized.bullishPct,
                bearishPct: normalized.bearishPct,
                trend: normalized.trend,
                mentions: normalized.mentions,
                rawJson: normalized.rawJson,
            },
            { upsert: true },
        );
    }
}

/**
 * Normalize a raw Adanos compare row into the fields stored in
 * AdanosSentimentSnapshot. Mirrors adanos-collect.actions.normalizeRow but uses
 * the compare-response field names (buzz_score, sentiment_score, …).
 */
function normalizeRowFromLive(
    source: SentimentSourceKey,
    row: Record<string, unknown>,
): {
    buzzScore: number | null;
    sentimentScore: number | null;
    bullishPct: number | null;
    bearishPct: number | null;
    trend: 'rising' | 'falling' | 'stable' | null;
    mentions: number | null;
    rawJson: Record<string, unknown>;
} | null {
    const toNumber = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    };

    const buzzScore = toNumber(row.buzz_score);
    if (buzzScore === null) return null;

    const metricField = SOURCE_CONFIG[source].metricField;
    return {
        buzzScore,
        sentimentScore: row.sentiment_score !== null && row.sentiment_score !== undefined
            ? toNumber(row.sentiment_score) : null,
        bullishPct: toNumber(row.bullish_pct),
        bearishPct: toNumber(row.bearish_pct),
        trend: ['rising', 'falling', 'stable'].includes(String(row.trend ?? ''))
            ? (row.trend as 'rising' | 'falling' | 'stable')
            : null,
        mentions: toNumber(row[metricField] ?? row.mentions ?? row.trade_count),
        rawJson: row,
    };
}

// If DB sentiment data is older than this, treat it as stale and re-fetch from Adanos API.
const SENTIMENT_STALENESS_WINDOW_MS = 48 * 60 * 60 * 1000;

function toDbNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

function snapshotToSourceInsight(
    source: string,
    row: { buzzScore: number | null; bullishPct: number | null; trend: string | null; mentions: number | null },
): SentimentSourceInsight | null {
    const buzzScore = toDbNumber(row.buzzScore);
    if (buzzScore === null) return null;

    const sourceKey = source as SentimentSourceKey;
    const cfg = SOURCE_CONFIG[sourceKey];
    const metricValue = toDbNumber(row.mentions ?? 0) ?? 0;

    return {
        source: sourceKey,
        label: cfg?.label ?? source,
        companyName: null,
        buzzScore,
        bullishPct: toDbNumber(row.bullishPct),
        trend: row.trend === 'rising' || row.trend === 'falling' || row.trend === 'stable'
            ? (row.trend as SentimentTrend)
            : null,
        metricLabel: cfg?.metricLabel ?? 'Mentions',
        metricValue: Math.round(metricValue),
    };
}

/**
 * Read the latest Adanos sentiment snapshot per source from MongoDB and build
 * StockSentimentInsights without calling the Adanos API.
 */
export async function getStockSentimentFromDb(
    symbol: string,
): Promise<{ insights: StockSentimentInsights | null; latestCollectedAt: Date | null }> {
    if (!symbol?.trim()) {
        return { insights: null, latestCollectedAt: null };
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const { connectToDatabase } = await import('@/database/mongoose');
    const { AdanosSentimentSnapshot } = await import('@/database/models/adanos-sentiment.model');
    await connectToDatabase();

    const rows = await AdanosSentimentSnapshot.aggregate([
        { $match: { symbol: normalizedSymbol } },
        { $sort: { collectedAt: -1 } },
        { $group: { _id: '$source', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
    ]) as Array<{
        source: string;
        buzzScore: number | null;
        bullishPct: number | null;
        trend: string | null;
        mentions: number | null;
        collectedAt: Date;
    }>;

    if (rows.length === 0) {
        return { insights: null, latestCollectedAt: null };
    }

    let latestTime = 0;
    for (const row of rows) {
        const t = new Date(row.collectedAt).getTime();
        if (t > latestTime) latestTime = t;
    }

    const sources: SentimentSourceInsight[] = [];
    for (const row of rows) {
        const insight = snapshotToSourceInsight(row.source, row);
        if (insight) sources.push(insight);
    }

    if (sources.length === 0) {
        return { insights: null, latestCollectedAt: new Date(latestTime) };
    }

    return {
        insights: buildStockSentimentInsights(normalizedSymbol, sources),
        latestCollectedAt: new Date(latestTime),
    };
}

/**
 * Get sentiment insights for a symbol, preferring locally persisted MongoDB data.
 * If no DB data exists, or the latest data is older than 48 hours, falls back to
 * calling the Adanos API directly. This avoids hitting Adanos on every page view
 * while keeping the data fresh enough for individual stock pages.
 */
export async function getStockSentimentInsightsCached(
    symbol: string,
): Promise<StockSentimentInsights | null> {
    if (!process.env.ADANOS_API_KEY || !symbol?.trim()) {
        return null;
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const { insights, latestCollectedAt } = await getStockSentimentFromDb(normalizedSymbol);

    const isStale = !latestCollectedAt
        || Date.now() - latestCollectedAt.getTime() > SENTIMENT_STALENESS_WINDOW_MS;

    if (!isStale && insights) {
        return insights;
    }

    // Data is stale or missing: fall back to live Adanos API
    return getStockSentimentInsights(normalizedSymbol);
}
