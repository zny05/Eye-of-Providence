import { describe, expect, it } from 'vitest';
import { AXIS_CATALOG_IDS, buildExplainView, DEFAULT_AXIS_IDS } from '@/lib/eye/explain-view';
import { meanOfAvailable, percentileScores } from '@/lib/eye/normalize';
import { parseSymbols } from '@/lib/eye/symbols';
import { MAX_AXES, MAX_SELECTED, type StockFactorRaw } from '@/lib/eye/types';

describe('parseSymbols', () => {
    it('uppercases, de-duplicates and drops invalid entries', () => {
        expect(parseSymbols('aapl, msft,AAPL,,bad symbol,BRK.B')).toEqual(['AAPL', 'MSFT', 'BRK.B']);
        expect(parseSymbols(['nvda', 'amd'])).toEqual(['NVDA', 'AMD']);
        expect(parseSymbols(undefined)).toEqual([]);
    });

    it('caps the selection at 12', () => {
        const many = Array.from({ length: 20 }, (_, i) => `T${i}`).join(',');
        expect(parseSymbols(many)).toHaveLength(MAX_SELECTED);
        expect(MAX_SELECTED).toBe(12);
    });
});

describe('percentileScores', () => {
    it('ranks 0..100 and keeps missing values empty', () => {
        expect(percentileScores([10, 30, null, 20])).toEqual([0, 100, null, 50]);
    });

    it('gives ties the average rank, inverts on request, and needs three readings', () => {
        expect(percentileScores([1, 1, 3, 5])).toEqual([100 / 3 / 2, 100 / 3 / 2, 200 / 3, 100]);
        expect(percentileScores([1, 2, 3], { higherIsBetter: false })).toEqual([100, 50, 0]);
        expect(percentileScores([1, 2, null])).toEqual([null, null, null]);
    });

    it('averages only what exists', () => {
        expect(meanOfAvailable([null, 40, 60])).toBe(50);
        expect(meanOfAvailable([null, null])).toBeNull();
    });
});

const stock = (symbol: string, extra: Partial<StockFactorRaw> = {}, metric: StockFactorRaw['metric'] = {}): StockFactorRaw => ({
    symbol, name: symbol, industry: 'Technology', marketCap: 1000, price: 100, changePct: 0, recommendation: null, metric, ...extra,
});

describe('buildExplainView', () => {
    const asOf = new Date('2025-03-25T12:00:00Z'); // Mercury is retrograde
    const stocks = [
        stock('PEER1', { changePct: -1 }, { peTTM: 40, revenueGrowthTTMYoy: 25, roeTTM: 10, '13WeekPriceReturnDaily': 10 }),
        stock('AAA', { changePct: 2, recommendation: 4.2 }, { peTTM: 10, revenueGrowthTTMYoy: 5, roeTTM: 30, '13WeekPriceReturnDaily': -5, 'monthToDatePriceReturnDaily': 3 }),
        stock('PEER2', { changePct: 0.5 }, { peTTM: 20, revenueGrowthTTMYoy: 15, roeTTM: 20, '13WeekPriceReturnDaily': 0 }),
        stock('BBB', { changePct: -3, industry: 'Banking' }, { peTTM: 5, revenueGrowthTTMYoy: 9, roeTTM: 15, '13WeekPriceReturnDaily': 7 }),
        stock('EMPTY', { changePct: null, marketCap: null, price: null }),
    ];
    const view = buildExplainView(stocks, ['AAA', 'BBB', 'EMPTY'], asOf);
    const { axes, table } = view;

    it('offers a catalog the user picks from, with the suggested 16 ending in the three price outcomes', () => {
        expect(axes.map((a) => a.id)).toEqual(AXIS_CATALOG_IDS);
        expect(DEFAULT_AXIS_IDS).toHaveLength(MAX_AXES);
        expect(DEFAULT_AXIS_IDS.slice(-3)).toEqual(['r_today', 'r_1m', 'r_1q']);
        for (const id of DEFAULT_AXIS_IDS) expect(AXIS_CATALOG_IDS).toContain(id);
        expect(new Set(AXIS_CATALOG_IDS).size).toBe(AXIS_CATALOG_IDS.length);
        expect(AXIS_CATALOG_IDS.length).toBeGreaterThan(MAX_AXES);
        expect(axes.filter((a) => a.role === 'outcome').every((a) => !a.isScore)).toBe(true);
        expect(axes.filter((a) => a.role === 'astro')).toHaveLength(2);
    });

    it('scores optional axes too, inverting leverage because lower is better', () => {
        const withLev = buildExplainView([
            stock('A', {}, { peTTM: 10, 'totalDebt/totalEquityQuarterly': 0.2, psTTM: 2 }),
            stock('B', {}, { peTTM: 12, 'totalDebt/totalEquityQuarterly': 0.5, psTTM: 4 }),
            stock('C', {}, { peTTM: 14, 'totalDebt/totalEquityQuarterly': 1.5, psTTM: 8 }),
        ], ['A'], asOf).table;
        expect(withLev.columns.q_lev).toEqual([100, 50, 0]);
        expect(withLev.columns.v_ps).toEqual([100, 50, 0]);
    });

    it('puts selected instruments first in the user order and skips ones without data', () => {
        expect(view.skipped).toEqual(['EMPTY']);
        expect(table.ids).toEqual(['AAA', 'BBB', 'PEER1', 'PEER2']);
        expect(table.selectedIndex).toEqual([0, 1, null, null]);
    });

    it('turns P/E into a yield and scores it against the whole universe', () => {
        expect(table.raw.v_ey).toEqual([10, 20, 2.5, 5]);
        const scores = table.columns.v_ey as number[];
        [200 / 3, 100, 0, 100 / 3].forEach((expected, i) => expect(scores[i]).toBeCloseTo(expected));
    });

    it('keeps outcomes as raw percentages with ranks, never as scores', () => {
        expect(table.columns.r_today).toEqual([2, -3, -1, 0.5]);
        expect(table.rank.r_today[0]).toBe(100);
        const today = axes.find((a) => a.id === 'r_today')!;
        expect(today.domain[0]).toBeLessThan(0);
        expect(today.domain[1]).toBeGreaterThan(2);
        expect(axes.find((a) => a.id === 'r_1m')!.hasMissing).toBe(true);
    });

    it('fills the symbolic layer from the industry and the date', () => {
        expect(table.columns.a_ruler).toEqual(['Uranus', 'Jupiter', 'Uranus', 'Uranus']);
        expect(table.columns.a_ruler_retro).toEqual(['Direct', 'Direct', 'Direct', 'Direct']); // Uranus/Jupiter direct in March 2025
        expect(view.astro.moon.illumination).toBeGreaterThanOrEqual(0);
        expect(view.astro.retrograde).toContain('Mercury');
    });

    it('labels axes with a reason: ok when a value exists, no-data when every field is null', () => {
        // v_ey has readings; g_gm is null for every fixture (no grossMarginTTM key), so no-data.
        expect(axes.find((a) => a.id === 'v_ey')!.reason).toBe('ok');
        expect(axes.find((a) => a.id === 'q_gm')!.reason).toBe('no-data');
        expect(axes.find((a) => a.id === 'r_today')!.reason).toBe('ok');
        // the month-to-date axis now reads monthToDatePriceReturnDaily, which only AAA has
        expect(axes.find((a) => a.id === 'r_1m')!.reason).toBe('ok');
        expect(axes.find((a) => a.id === 'r_1q')!.reason).toBe('ok');
    });

    it('uses monthToDatePriceReturnDaily for r_1m (1MonthPriceReturnDaily is not on Finnhub free)', () => {
        expect(table.columns.r_1m).toEqual([3, null, null, null]);
        expect(axes.find((a) => a.id === 'r_1m')!.labelEn).toBe('Month-to-date return');
        expect(axes.find((a) => a.id === 'r_1m')!.labelZh).toContain('MTD');
    });
});
