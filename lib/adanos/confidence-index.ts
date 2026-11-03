/**
 * Market Confidence Index (MCI) — a research indicator computed from locally
 * persisted Adanos sentiment snapshots.
 *
 * MCI = 50 + 50 × clamp(w_A·A + w_S·S + w_P·P, -1, 1)
 *
 *   A — attention change (buzz rising/falling over the lookback window)
 *   S — directional sentiment (sentiment_score from Adanos, −1..+1)
 *   P — prediction-market signal (Polymarket bullish share mapped to −1..+1)
 *
 * Only sources that actually have snapshots in the window contribute; their
 * weights are re-normalised so the total stays 1. If no source has data,
 * the result is null.
 *
 * This is an OpenStock-designed research indicator — Adanos itself provides
 * buzz_score / sentiment_score / trend but no composite confidence index.
 */

import { connectToDatabase } from '@/database/mongoose';
import { AdanosSentimentSnapshot, type IAdanosSentimentSnapshot } from '@/database/models/adanos-sentiment.model';

export type MciComponent = 'attention' | 'sentiment' | 'prediction';

export type MciWeights = Partial<Record<MciComponent, number>>;

export const DEFAULT_MCI_WEIGHTS: MciWeights = {
    attention: 0.2,
    sentiment: 0.4,
    prediction: 0.4,
};

// Latest snapshot per source we keep; older than this is ignored for MCI.
const LOOKBACK_DAYS = 7;
// Minimum number of sources that must have data before an MCI is emitted.
const MIN_SOURCES = 1;

type RawSignal = {
    source: string;
    // Maps to MciComponent: attention ← buzzChange, sentiment ← sentiment, prediction ← prediction
    buzzChange: number | null;    // −1..+1 attention delta
    sentiment: number | null;     // −1..+1 directional sentiment
    prediction: number | null;    // −1..+1 prediction-market signal
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function componentValue(signal: RawSignal, component: MciComponent): number | null {
    if (component === 'attention') return signal.buzzChange;
    if (component === 'sentiment') return signal.sentiment;
    return signal.prediction;
}

/**
 * Buzzy change over time: compare the mean buzz of the newest half of the
 * window against the oldest half. Returns −1..+1, or null when there isn't
 * enough history to compare.
 */
function buzzChangeSignal(values: { collectedAt: Date; buzzScore: number | null }[]): number | null {
    const withBuzz = values.filter((v) => v.buzzScore !== null);
    if (withBuzz.length < 4) return null;

    withBuzz.sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
    const mid = Math.ceil(withBuzz.length / 2);
    const older = withBuzz.slice(0, mid);
    const newer = withBuzz.slice(mid);

    const olderAvg = older.reduce((s, v) => s + (v.buzzScore ?? 0), 0) / older.length;
    const newerAvg = newer.reduce((s, v) => s + (v.buzzScore ?? 0), 0) / newer.length;

    const base = olderAvg === 0 ? 0 : (newerAvg - olderAvg) / Math.abs(olderAvg);
    return clamp(base, -1, 1);
}

function toMci(component: number) {
    return 50 + 50 * clamp(component, -1, 1);
}

function emptyComponents(): Record<MciComponent, { value: number | null; weight: number; contributing: number }> {
    return {
        attention: { value: null, weight: 0, contributing: 0 },
        sentiment: { value: null, weight: 0, contributing: 0 },
        prediction: { value: null, weight: 0, contributing: 0 },
    };
}

/**
 * Fetch the most recent snapshots (within LOOKBACK_DAYS) for a symbol across
 * every Adanos source, grouped by source.
 */
async function fetchRecentSnapshots(symbol: string): Promise<Map<string, IAdanosSentimentSnapshot[]>> {
    await connectToDatabase();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const rows = await AdanosSentimentSnapshot.find({
        symbol: symbol.toUpperCase(),
        collectedAt: { $gte: since },
    }).sort({ collectedAt: -1 }).lean<IAdanosSentimentSnapshot[]>();

    const grouped = new Map<string, IAdanosSentimentSnapshot[]>();
    for (const row of rows) {
        const bucket = grouped.get(row.source) ?? [];
        bucket.push(row);
        grouped.set(row.source, bucket);
    }
    return grouped;
}

function buildRawSignals(grouped: Map<string, IAdanosSentimentSnapshot[]>): RawSignal[] {
    const signals: RawSignal[] = [];

    for (const [source, rows] of grouped) {
        const latest = rows[0];
        const sentiment = latest.sentimentScore !== null
            ? clamp(latest.sentimentScore, -1, 1)
            : null;

        const prediction =
            source === 'polymarket' && latest.bullishPct !== null
                ? clamp((latest.bullishPct - 50) / 50, -1, 1)
                : null;

        signals.push({
            source,
            buzzChange: buzzChangeSignal(rows.map((r) => ({ collectedAt: r.collectedAt, buzzScore: r.buzzScore }))),
            sentiment,
            prediction,
        });
    }

    return signals;
}

/**
 * Aggregate per-source signals into a single Market Confidence Index.
 *
 * Components missing for every source are dropped and their weight re-normalised
 * across the remaining ones. Returns null when fewer than MIN_SOURCES sources
 * have any usable data.
 */
export function aggregateMci(signals: RawSignal[], weights: MciWeights = DEFAULT_MCI_WEIGHTS): {
    mci: number | null;
    components: Record<MciComponent, { value: number | null; weight: number; contributing: number }>;
    sources: number;
} {
    const availableSources = signals.length;
    if (availableSources < MIN_SOURCES) {
        return { mci: null, components: emptyComponents(), sources: 0 };
    }

    const present: MciComponent[] = [];
    for (const component of ['attention', 'sentiment', 'prediction'] as MciComponent[]) {
        const hasAny = signals.some((s) => componentValue(s, component) !== null);
        if (hasAny) present.push(component);
    }

    if (present.length === 0) {
        return { mci: null, components: emptyComponents(), sources: availableSources };
    }

    const totalWeight = present.reduce((sum, c) => sum + (weights[c] ?? 0), 0);
    const normalised = Object.fromEntries(
        present.map((c) => [c, (weights[c] ?? 0) / totalWeight])
    ) as Record<MciComponent, number>;

    let weightedSum = 0;
    const components: Record<MciComponent, { value: number | null; weight: number; contributing: number }> = {
        attention: { value: null, weight: normalised.attention ?? 0, contributing: 0 },
        sentiment: { value: null, weight: normalised.sentiment ?? 0, contributing: 0 },
        prediction: { value: null, weight: normalised.prediction ?? 0, contributing: 0 },
    };

    for (const component of present) {
        const values = signals
            .map((s) => componentValue(s, component))
            .filter((v): v is number => v !== null);
        if (values.length === 0) continue;
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        components[component] = { value: avg, weight: normalised[component], contributing: values.length };
        weightedSum += avg * normalised[component];
    }

    const mci = toMci(weightedSum);
    return { mci, components, sources: availableSources };
}

/**
 * Compute the Market Confidence Index for a symbol from locally persisted
 * Adanos snapshots. Requires MongoDB (called from server actions / jobs only).
 */
export async function computeMarketConfidenceIndex(
    symbol: string,
    weights: MciWeights = DEFAULT_MCI_WEIGHTS,
) {
    const grouped = await fetchRecentSnapshots(symbol);
    const signals = buildRawSignals(grouped);
    return aggregateMci(signals, weights);
}
