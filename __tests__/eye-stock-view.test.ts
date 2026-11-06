import { describe, expect, it } from 'vitest';
import { meanOfAvailable, percentileScores } from '@/lib/eye/normalize';
import { buildStockView } from '@/lib/eye/stock-view';
import type { StockFactorRaw } from '@/lib/eye/types';

describe('percentileScores', () => {
    it('ranks 0..100 and keeps missing values empty', () => {
        expect(percentileScores([10, 30, null, 20])).toEqual([0, 100, null, 50]);
    });

    it('gives ties the average rank', () => {
        expect(percentileScores([1, 1, 3, 5])).toEqual([100 / 3 / 2, 100 / 3 / 2, 200 / 3, 100]);
    });

    it('inverts when lower is better', () => {
        expect(percentileScores([1, 2, 3], { higherIsBetter: false })).toEqual([100, 50, 0]);
    });

    it('refuses to rank fewer than three readings', () => {
        expect(percentileScores([1, 2, null])).toEqual([null, null, null]);
    });
});

describe('meanOfAvailable', () => {
    it('averages only what exists', () => {
        expect(meanOfAvailable([null, 40, 60])).toBe(50);
        expect(meanOfAvailable([null, null])).toBeNull();
    });
});

const stock = (symbol: string, metric: StockFactorRaw['metric'], extra: Partial<StockFactorRaw> = {}): StockFactorRaw => ({
    symbol, name: symbol, industry: 'Tech', marketCap: 1000, price: 100, metric, ...extra,
});

describe('buildStockView', () => {
    const stocks = [
        stock('AAA', { peTTM: 10, revenueGrowthTTMYoy: 5, roeTTM: 30, 'totalDebt/totalEquityQuarterly': 0.2 }),
        stock('BBB', { peTTM: 20, revenueGrowthTTMYoy: 15, roeTTM: 20, 'totalDebt/totalEquityQuarterly': 0.5 }),
        stock('CCC', { peTTM: 40, revenueGrowthTTMYoy: 25, roeTTM: 10, 'totalDebt/totalEquityQuarterly': 1.5 }),
        stock('NOPE', {}, { marketCap: null, industry: null }),
    ];
    const { axes, table, skipped } = buildStockView(stocks);

    it('skips stocks without any readable factor', () => {
        expect(skipped).toEqual(['NOPE']);
        expect(table.ids).toEqual(['AAA', 'BBB', 'CCC']);
    });

    it('turns multiples into yields so cheaper means higher', () => {
        expect(table.raw.v_ey).toEqual([10, 5, 2.5]);
        expect(table.columns.v_ey).toEqual([100, 50, 0]);
    });

    it('inverts leverage because lower is better', () => {
        expect(table.columns.q_lev).toEqual([100, 50, 0]);
    });

    it('averages only available scores into clusters, and leaves empty clusters empty', () => {
        expect(table.columns.k_growth).toEqual([0, 50, 100]);
        expect(table.columns.k_momentum).toEqual([null, null, null]);
        expect(table.columns.composite![0]).toBe(((100 + 0 + (100 + 100) / 2) / 3));
    });

    it('reports coverage and missing flags per axis', () => {
        const momentum = axes.find((a) => a.id === 'k_momentum')!;
        expect(momentum.coverage).toBe(0);
        expect(momentum.hasMissing).toBe(true);
        expect(axes.find((a) => a.id === 's_mcap')!.kind).toBe('log');
        expect(table.flags.every((f) => f.lowCoverage)).toBe(true); // each stock has few of the 14 readings
    });
});
