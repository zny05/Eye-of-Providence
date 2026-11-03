'use server';

import {
    buildStockSentimentInsights,
    normalizeSourceInsight,
    SOURCE_CONFIG,
    type SentimentSourceInsight,
    type SentimentSourceKey,
    type SourceComparePayload,
    type StockSentimentInsights,
} from './adanos.helpers';
import { fetchAdanosJSON, ADANOS_BASE_URL, RecentFailure, MonthlyQuotaExceeded } from '@/lib/adanos/fetch';

const DEFAULT_LOOKBACK_DAYS = 7;

async function fetchCompareSource(
    source: SentimentSourceKey,
    symbol: string,
    days: number,
): Promise<SentimentSourceInsight | null> {
    try {
        const url = new URL(`${ADANOS_BASE_URL}${SOURCE_CONFIG[source].path}`);
        url.searchParams.set('tickers', symbol.toUpperCase());
        url.searchParams.set('days', String(days));

        const payload = await fetchAdanosJSON<SourceComparePayload>(url.toString());
        const row = payload?.stocks?.find((item) => item.ticker?.toUpperCase() === symbol.toUpperCase());

        return normalizeSourceInsight(source, row);
    } catch (error) {
        if (error instanceof RecentFailure || error instanceof MonthlyQuotaExceeded) {
            // 在失败冷却期内，或月度配额已耗尽，静默跳过，不重复打印错误
            return null;
        }
        const message = (error as Error).message;
        if (message.includes('404')) return null;
        console.error(`Adanos ${source} compare request failed for ${symbol}`, error);
        return null;
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

    const sources = await Promise.all(
        sourceKeys.map((source) => fetchCompareSource(source, normalizedSymbol, lookbackDays)),
    );

    return buildStockSentimentInsights(normalizedSymbol, sources);
}
