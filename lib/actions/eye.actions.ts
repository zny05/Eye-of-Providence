'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { getCompanyProfile, getLiveQuotes, getStockFactorMetrics } from '@/lib/actions/finnhub.actions';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { buildStockView, type StockView } from '@/lib/eye/stock-view';
import type { StockFactorRaw } from '@/lib/eye/types';

export interface EyeStockView extends StockView {
    asOf: string;
    requested: number;
}

// Cross-section of the signed-in user's watchlist. Every Finnhub read goes through finnhub.actions (key pool, cache).
export async function getEyeStockView(): Promise<EyeStockView> {
    await requireUserId();
    const items: { symbol: string; company?: string }[] = await getUserWatchlist();
    const symbols = items.map((i) => i.symbol);
    const quotes = await getLiveQuotes(symbols);

    const stocks: StockFactorRaw[] = await Promise.all(
        items.map(async ({ symbol, company }) => {
            const [profile, metric] = await Promise.all([getCompanyProfile(symbol), getStockFactorMetrics(symbol)]);
            return {
                symbol,
                name: profile?.name || company || symbol,
                industry: profile?.finnhubIndustry ?? null,
                marketCap: profile?.marketCapitalization ?? null,
                price: quotes[symbol]?.c ?? null,
                metric: metric ?? {},
            };
        }),
    );

    return { ...buildStockView(stocks), asOf: new Date().toISOString(), requested: symbols.length };
}
