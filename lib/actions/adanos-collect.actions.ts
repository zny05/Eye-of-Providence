'use server';

import { connectToDatabase } from '@/database/mongoose';
import { AdanosSentimentSnapshot } from '@/database/models/adanos-sentiment.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { fetchAdanosJSON } from '@/lib/adanos/fetch';

const MAX_POINTS_PER_SOURCE = 120; // cap retained history per symbol + source

type AdanosSourceKey = 'reddit' | 'x' | 'news' | 'polymarket' | 'crypto';

const SOURCE_PATHS: Record<AdanosSourceKey, string> = {
    reddit: '/reddit/stocks/v1/compare',
    x: '/x/stocks/v1/compare',
    news: '/news/stocks/v1/compare',
    polymarket: '/polymarket/stocks/v1/compare',
    crypto: '/crypto/v1/trending',
};

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeRow(source: AdanosSourceKey, row: unknown) {
    const r = row as Record<string, unknown>;
    const buzzScore = toNumber(r.buzz_score);
    if (buzzScore === null) return null;

    return {
        buzzScore,
        sentimentScore: r.sentiment_score !== null && r.sentiment_score !== undefined ? toNumber(r.sentiment_score) : null,
        bullishPct: toNumber(r.bullish_pct),
        bearishPct: toNumber(r.bearish_pct),
        trend: ['rising', 'falling', 'stable'].includes(String(r.trend ?? ''))
            ? (r.trend as 'rising' | 'falling' | 'stable')
            : null,
        mentions: toNumber(r.mentions ?? r.trade_count),
        rawJson: r,
    };
}

/**
 * Internal collection used by both the user-facing server action and the scheduled
 * background job. No auth here — background jobs run server-side without a session.
 *
 * Sources are fetched serially (one at a time) to avoid hitting Adanos' 100/min rate limit.
 * Each source endpoint is fetched once per call; the fetch layer dedupes identical URLs
 * across concurrent callers.
 */
async function collectAdanosSentimentForSymbol(symbol: string): Promise<{
    collected: number;
    sources: AdanosSourceKey[];
    skipped: AdanosSourceKey[];
}> {
    const normalizedSymbol = String(symbol ?? '').trim().toUpperCase();
    if (!normalizedSymbol) throw new Error('Invalid symbol');

    const sources = Object.keys(SOURCE_PATHS) as AdanosSourceKey[];
    const collected: AdanosSourceKey[] = [];
    const skipped: AdanosSourceKey[] = [];

    await connectToDatabase();

    for (const source of sources) {
        const isCrypto = source === 'crypto';
        const payload = await fetchAdanosJSON<{ stocks?: unknown[]; coins?: unknown[] }>(
            `${process.env.ADANOS_API_BASE_URL || 'https://api.adanos.org'}${SOURCE_PATHS[source]}?${isCrypto ? 'limit=100' : `tickers=${normalizedSymbol}&days=7`}`,
        );

        if (!payload) {
            skipped.push(source);
            continue;
        }

        const rows: unknown[] = Array.isArray(payload.stocks)
            ? payload.stocks
            : Array.isArray(payload.coins)
                ? payload.coins
                : [];

        const tickerField = isCrypto ? 'symbol' : 'ticker';
        const row = rows.find((r) => {
            const rec = r as Record<string, unknown>;
            return String(rec[tickerField] ?? '').toUpperCase() === normalizedSymbol;
        });

        if (!row) {
            skipped.push(source);
            continue;
        }

        const normalized = normalizeRow(source, row);
        if (!normalized) {
            skipped.push(source);
            continue;
        }

        await AdanosSentimentSnapshot.create({
            symbol: normalizedSymbol,
            source,
            collectedAt: new Date(),
            buzzScore: normalized.buzzScore,
            sentimentScore: normalized.sentimentScore,
            bullishPct: normalized.bullishPct,
            bearishPct: normalized.bearishPct,
            trend: normalized.trend,
            mentions: normalized.mentions,
            rawJson: normalized.rawJson,
        });

        // Cap retained history per symbol + source so the free plan's data stays bounded.
        const count = await AdanosSentimentSnapshot.countDocuments({ symbol: normalizedSymbol, source });
        if (count > MAX_POINTS_PER_SOURCE) {
            const toDelete = await AdanosSentimentSnapshot.find({ symbol: normalizedSymbol, source })
                .sort({ collectedAt: 1 })
                .limit(count - MAX_POINTS_PER_SOURCE)
                .select('_id')
                .lean();
            await AdanosSentimentSnapshot.deleteMany({
                _id: { $in: toDelete.map((d) => d._id) },
            });
        }

        collected.push(source);
    }

    return { collected: collected.length, sources: collected, skipped };
}

/**
 * Collect the latest Adanos sentiment snapshots for a symbol across all
 * configured sources and persist them to MongoDB. Requires a signed-in user
 * (server actions never trust a client-supplied userId).
 *
 * Because the free Adanos plan allows only 250 requests/month across every
 * endpoint, callers should invoke this on a schedule (e.g. daily via Inngest
 * or a cron route) rather than on every page view. Computed indices read from
 * the persisted snapshots instead.
 */
export async function collectAdanosSentiment(symbol: string): Promise<{
    collected: number;
    sources: AdanosSourceKey[];
    skipped: AdanosSourceKey[];
}> {
    await requireUserId();
    return collectAdanosSentimentForSymbol(symbol);
}

export { collectAdanosSentimentForSymbol };
