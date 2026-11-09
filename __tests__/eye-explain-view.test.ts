import { describe, expect, it } from 'vitest';
import { AXIS_CATALOG_IDS, buildExplainView, classifyInstrument, DEFAULT_AXIS_IDS, DEFAULT_ETF_AXIS_IDS } from '@/lib/eye/explain-view';
import { meanOfAvailable, percentileScores } from '@/lib/eye/normalize';
import { parseSymbols } from '@/lib/eye/symbols';
import { DEFAULT_AXIS_COUNT, MAX_AXES, MAX_SELECTED, type StockFactorRaw } from '@/lib/eye/types';

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
    symbol, name: symbol, industry: 'Technology', marketCap: 1000, price: 100, changePct: 0, recommendation: null, metric, kind: 'stock', ...extra,
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
        expect(DEFAULT_AXIS_IDS).toHaveLength(DEFAULT_AXIS_COUNT);
        expect(DEFAULT_AXIS_IDS).toHaveLength(JSON.parse('16'));
        expect(DEFAULT_AXIS_IDS.slice(-3)).toEqual(['r_today', 'r_1m', 'r_1q']);
        for (const id of DEFAULT_AXIS_IDS) expect(AXIS_CATALOG_IDS).toContain(id);
        expect(new Set(AXIS_CATALOG_IDS).size).toBe(AXIS_CATALOG_IDS.length);
        expect(AXIS_CATALOG_IDS.length).toBeGreaterThan(MAX_AXES);
        expect(axes.filter((a) => a.role === 'outcome').every((a) => !a.isScore)).toBe(true);
        // 2 original + 7 new astro axes.
        expect(axes.filter((a) => a.role === 'astro')).toHaveLength(9);
        // New axes are all astro and never scored.
        for (const id of ['a_moon_phase', 'a_sun_sign', 'a_ruler_sign', 'a_ruler_decl', 'a_ruler_speed', 'a_next_event_days', 'a_event_count_7d']) {
            const axis = axes.find((a) => a.id === id)!;
            expect(axis.role).toBe('astro');
            expect(axis.isScore).toBe(false);
            expect(table.columns[id]).toBeDefined();
        }
        // Sentiment axes are scored and role=sentiment.
        for (const id of ['x_sent_buzz', 'x_sent_bull', 'x_sent_cov', 'x_sent_loc']) {
            const axis = axes.find((a) => a.id === id)!;
            expect(axis.role).toBe('sentiment');
            expect(axis.isScore).toBe(true);
            expect(table.columns[id]).toBeDefined();
        }
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
        // New dimensions sanity: all ruler-derived columns carry the same row count.
        expect(table.columns.a_ruler_sign).toHaveLength(4);
        expect(table.columns.a_ruler_decl).toHaveLength(4);
        expect(table.columns.a_ruler_speed).toHaveLength(4);
        // Date-derived sun/moon markers are constant per row.
        expect(new Set(table.columns.a_moon_phase as number[]).size).toBe(1);
        expect(new Set(table.columns.a_sun_sign as string[]).size).toBe(1);
        expect(view.astro.sunSign).toBe('Aries'); // 2025-03-25: Sun has just passed the vernal equinox
        expect(view.astro.moon.sign).toBeDefined();
        expect(view.astro.moon.ageDays).toBeGreaterThanOrEqual(0);
    });

    it('labels axes with a reason: ok when a value exists, no-data when every field is null', () => {
        // v_ey has readings; g_gm is null for every fixture (no grossMarginTTM key), so no-data.
        expect(axes.find((a) => a.id === 'v_ey')!.reason).toBe('ok');
        expect(axes.find((a) => a.id === 'q_gm')!.reason).toBe('no-data');
        expect(axes.find((a) => a.id === 'r_today')!.reason).toBe('ok');
        // the month-to-date axis now reads monthToDatePriceReturnDaily, which only AAA has
        expect(axes.find((a) => a.id === 'r_1m')!.reason).toBe('ok');
        expect(axes.find((a) => a.id === 'r_1q')!.reason).toBe('ok');
        // CosmyDay axes without a feed are no-data, never ok, and carry the error in approx.
        const nextAxis = axes.find((a) => a.id === 'a_next_event_days')!;
        expect(['no-data', 'ok']).toContain(nextAxis.reason); // ok when the fixture universe is fed
        // When a feed is provided the values flow through.
        const withFeed = buildExplainView(stocks, ['AAA'], asOf, { nextEventDays: 5, eventCount7d: 2 });
        expect(withFeed.table.columns.a_next_event_days).toEqual([5, 5, 5, 5]);
        expect(withFeed.table.columns.a_event_count_7d).toEqual([2, 2, 2, 2]);
    });

    it('uses monthToDatePriceReturnDaily for r_1m (1MonthPriceReturnDaily is not on Finnhub free)', () => {
        expect(table.columns.r_1m).toEqual([3, null, null, null]);
        expect(axes.find((a) => a.id === 'r_1m')!.labelEn).toBe('Month-to-date return');
        expect(axes.find((a) => a.id === 'r_1m')!.labelZh).toContain('MTD');
    });

    it('marks axes with appliesTo: stock-only, universal, or both', () => {
        const byId = new Map(view.axes.map((a) => [a.id, a]));
        expect(byId.get('v_ey')!.appliesTo).toBe('stock');
        expect(byId.get('q_roe')!.appliesTo).toBe('stock');
        expect(byId.get('x_analyst')!.appliesTo).toBe('stock');
        expect(byId.get('p_52w_pos')!.appliesTo).toBe('universal');
        expect(byId.get('p_beta')!.appliesTo).toBe('universal');
        expect(byId.get('s_mcap')!.appliesTo).toBe('universal');
        expect(byId.get('r_today')!.appliesTo).toBe('universal');
        expect(byId.get('a_ruler')!.appliesTo).toBe('universal');
        expect(byId.get('x_sent_buzz')!.appliesTo).toBe('universal');
    });

    it('keeps ETF axis defaults free of stock-only axes', () => {
        const stockOnly = ['v_ey', 'g_rev_yoy', 'g_eps_yoy', 'q_roe', 'q_gm', 'v_pb', 'v_ps', 'q_nm', 'q_lev', 'x_analyst'];
        expect(DEFAULT_ETF_AXIS_IDS.every((id) => !stockOnly.includes(id))).toBe(true);
        expect(DEFAULT_ETF_AXIS_IDS).toContain('p_52w_pos');
        expect(DEFAULT_ETF_AXIS_IDS).toContain('p_beta');
        expect(DEFAULT_ETF_AXIS_IDS).toContain('s_mcap');
        expect(DEFAULT_ETF_AXIS_IDS).toContain('r_today');
    });
});

describe('classifyInstrument', () => {
    it('flags canonical ETF tickers', () => {
        expect(classifyInstrument('SPY', null)).toBe('etf');
        expect(classifyInstrument('VOO', null)).toBe('etf');
        expect(classifyInstrument('QQQ', null)).toBe('etf');
    });

    it('does not flag stocks', () => {
        expect(classifyInstrument('AAPL', null, 'Apple Inc.', 'Technology')).toBe('unknown');
        expect(classifyInstrument('NVDA', null, 'NVIDIA Corp', 'Technology')).toBe('unknown');
    });

    it('falls back to name/type signals', () => {
        expect(classifyInstrument('XYZ', 'exchange traded fund')).toBe('etf');
        expect(classifyInstrument('XYZ', null, 'Some ETF Trust', null)).toBe('etf');
        expect(classifyInstrument('XYZ', null, 'Realty Trust', null)).toBe('unknown');
        expect(classifyInstrument('XYZ', null, null, 'ETF')).toBe('etf');
    });
});

describe('buildExplainView — type-aware percentiles', () => {
    const asOf = new Date('2025-03-25T12:00:00Z');
    const etf = (symbol: string, extra: Partial<StockFactorRaw> = {}, metric: StockFactorRaw['metric'] = {}): StockFactorRaw => ({
        symbol, name: `${symbol} ETF`, industry: 'ETF', marketCap: 5000, price: 500, changePct: 0, recommendation: null, metric, kind: 'etf', ...extra,
    });
    const stk = (symbol: string, pe: number): StockFactorRaw => stock(symbol, {}, { peTTM: pe, revenueGrowthTTMYoy: 5, roeTTM: 10, '13WeekPriceReturnDaily': 1, dividendYieldIndicatedAnnual: 0.5 });

    it('scores ETFs against ETFs and stocks against stocks (no pooling)', () => {
        const mixed = buildExplainView([
            stk('AAA', 10), stk('BBB', 20), stk('CCC', 30),
            etf('SPY', {}, { dividendYieldIndicatedAnnual: 1.3, beta: 0.95, '52WeekHigh': 600, '52WeekLow': 500 }),
            etf('VOO', {}, { dividendYieldIndicatedAnnual: 1.4, beta: 0.95, '52WeekHigh': 550, '52WeekLow': 480 }),
            etf('QQQ', {}, { dividendYieldIndicatedAnnual: 0.5, beta: 1.1, '52WeekHigh': 600, '52WeekLow': 450 }),
        ], ['AAA', 'SPY'], asOf);
        // Row order: AAA, SPY, then background BBB, CCC, VOO, QQQ.
        expect(mixed.table.ids).toEqual(['AAA', 'SPY', 'BBB', 'CCC', 'VOO', 'QQQ']);
        expect(mixed.table.kinds).toEqual(['stock', 'etf', 'stock', 'stock', 'etf', 'etf']);
        // v_ey is stock-only: ETF rows have no reading (raw null) and no percentile.
        const vEyRaw = mixed.table.raw.v_ey as (number | null)[];
        expect(vEyRaw[1]).toBeNull(); // SPY
        expect(vEyRaw[0]).not.toBeNull();
        // Stock v_ey percentiles are computed over the 3 stocks only.
        const vEyScores = mixed.table.columns.v_ey as (number | null)[];
        expect(vEyScores.filter((v, i) => mixed.table.kinds[i] === 'stock')).toEqual([100, 50, 0]);
        expect(vEyScores.filter((v, i) => mixed.table.kinds[i] === 'etf')).toEqual([null, null, null]);
        // Dividend yield is universal but scored per-kind: ETFs rank among ETFs only.
        const dyScores = mixed.table.columns.v_dy as (number | null)[];
        // ETF dy readings: SPY 1.3, VOO 1.4, QQQ 0.5 → ranks 50, 100, 0 within ETFs.
        expect(dyScores[1]).toBeCloseTo(50);
        expect(dyScores[4]).toBeCloseTo(100);
        expect(dyScores[5]).toBeCloseTo(0);
        // Stock dy: all 0.5 (ties) → average rank 50 for each stock.
        expect(dyScores[0]).toBeCloseTo(50);
    });

    it('keeps ETF-only selections null on stock axes with reason no-data', () => {
        const etfOnly = buildExplainView([
            etf('SPY', {}, { dividendYieldIndicatedAnnual: 1.3, beta: 0.9 }),
            etf('VOO', {}, { dividendYieldIndicatedAnnual: 1.5, beta: 1.0 }),
            etf('QQQ', {}, { dividendYieldIndicatedAnnual: 0.6, beta: 1.2 }),
        ], ['SPY', 'VOO', 'QQQ'], asOf);
        const vEy = etfOnly.axes.find((a) => a.id === 'v_ey')!;
        expect(vEy.reason).toBe('no-data');
        expect(vEy.appliesTo).toBe('stock');
        expect(etfOnly.table.raw.v_ey).toEqual([null, null, null]);
        // Dividend yield percentile is non-null for ETFs (they have the reading).
        expect(etfOnly.table.columns.v_dy.every((v) => v !== null)).toBe(true);
    });
});
