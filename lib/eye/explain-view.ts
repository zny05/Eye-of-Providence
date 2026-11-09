import {
    declination,
    eclipticLongitude,
    isRetrograde,
    moonState,
    retrogradePlanets,
    rulerForIndustry,
    zodiacSign,
    dailySpeed,
    signDegree,
    type MoonState,
    type Planet,
} from '@/lib/eye/astro';
import { percentileScores } from '@/lib/eye/normalize';
import { domainFromValues } from '@/lib/eye/pcp/geometry';
import type { AxisKindAppliesTo, AxisReason, AxisRole, CellValue, InstrumentKind, PcpAxis, PcpTable, StockFactorRaw, ValueFormat } from '@/lib/eye/types';

const fin = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A curated set of common US equity ETF tickers. Finnhub profile2 has no reliable
// "etf" discriminator, so classification leans on this explicit list (plus a
// name/industry fallback in lib/actions/eye.actions.ts) — never a fuzzy regex,
// to keep false positives out of the ETF percentile universe.
const KNOWN_ETFS = new Set([
    'SPY', 'VOO', 'IVV', 'QQQ', 'DIA', 'IWM', 'EEM', 'AGG', 'TLT', 'GLD', 'SLV', 'USO',
    'XLE', 'XLF', 'XLK', 'XLV', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'XLY', 'XAP',
    'ARKK', 'VEA', 'VWO', 'IJH', 'IJR', 'ITOT', 'SCHX', 'SCHD', 'VTI', 'VB', 'VNQ',
    'VYM', 'SCHF', 'SCHG', 'SCHA', 'QUAL', 'MINT', 'JEPI', 'JEPQ', 'SCHP', 'VTIP',
    'BND', 'BNDX', 'VGSH', 'VGLT', 'VCIT', 'VCSH', 'EFA', 'EWZ', 'EWU', 'EWJ', 'FXI',
]);

/** Classify a symbol as an ETF (or stock/unknown) from name/industry/symbol signals. */
export function classifyInstrument(symbol: string, profileType: string | null | undefined, name?: string | null, industry?: string | null): InstrumentKind {
    const upper = symbol.toUpperCase().trim();
    if (KNOWN_ETFS.has(upper)) return 'etf';
    if (typeof profileType === 'string' && /etf|exchange traded fund/i.test(profileType)) return 'etf';
    if (typeof name === 'string' && /etf|exchange traded fund|trust/i.test(name)) {
        // Keep the "trust" signal narrow — it also matches REITs / closed-end funds,
        // which we don't want to flip to ETF. Require an actual ETF mention.
        if (/etf|exchange traded fund/i.test(name)) return 'etf';
    }
    if (typeof industry === 'string' && /etf|exchange traded fund/i.test(industry)) return 'etf';
    // No signal either way — unknown bucket (scored separately, shows stock axes).
    return 'unknown';
}

interface ScoredDef {
    id: string;
    section: string;
    labelEn: string;
    labelZh: string;
    read: (r: StockFactorRaw) => number | null;
    rawFormat: ValueFormat;
    approx?: string;
    lowerIsBetter?: boolean;
    appliesTo: AxisKindAppliesTo;
}

/**
 * Source keys verified by live capture 2026-11-07 (scripts/capture-finnhub-metric.mjs: 133 metric keys
 * returned by free `GET /stock/metric?symbol=AAPL&metric=all`). The 7 named axes are NOT a field-name
 * problem — their keys are all present. The only key that was missing was 1MonthPriceReturnDaily, which
 * free does not return; r_1m now reads monthToDatePriceReturnDaily instead.
 */
const SCORED: ScoredDef[] = [
    // --- Price momentum (universal: works for stocks and ETFs alike) ---
    {
        id: 'p_52w_pos', section: 'Momentum', labelEn: '52-week range position', labelZh: '52 周区间位置', rawFormat: 'pct',
        read: (r) => {
            const hi = fin(r.metric['52WeekHigh']);
            const lo = fin(r.metric['52WeekLow']);
            const px = fin(r.price);
            return hi !== null && lo !== null && px !== null && hi > lo ? Math.min(100, Math.max(0, (100 * (px - lo)) / (hi - lo))) : null;
        },
        appliesTo: 'universal',
    },
    // 26 weeks, not 13: the 13-week return is an outcome axis, and one number must not be both cause and effect.
    { id: 'p_6m', section: 'Momentum', labelEn: '26-week return', labelZh: '近 6 月涨幅', rawFormat: 'spct', read: (r) => fin(r.metric['26WeekPriceReturnDaily']), appliesTo: 'universal' },
    { id: 'p_1y', section: 'Momentum', labelEn: '52-week return', labelZh: '近 1 年涨幅', rawFormat: 'spct', read: (r) => fin(r.metric['52WeekPriceReturnDaily']), appliesTo: 'universal' },
    { id: 'p_5d', section: 'Momentum', labelEn: '5-day return', labelZh: '近 5 日涨幅', rawFormat: 'spct', read: (r) => fin(r.metric['5DayPriceReturnDaily']), appliesTo: 'universal' },
    { id: 'p_mtd', section: 'Momentum', labelEn: 'Month-to-date return', labelZh: '本月以来涨跌 (MTD)', rawFormat: 'spct', read: (r) => fin(r.metric['monthToDatePriceReturnDaily']), appliesTo: 'universal' },
    { id: 'p_3m', section: 'Momentum', labelEn: '3-month return', labelZh: '近 3 月涨幅', rawFormat: 'spct', read: (r) => fin(r.metric['3MonthPriceReturnDaily']), appliesTo: 'universal' },
    { id: 'p_ytd', section: 'Momentum', labelEn: 'Year-to-date return', labelZh: '本年以来涨跌 (YTD)', rawFormat: 'spct', read: (r) => fin(r.metric['yearToDatePriceReturnDaily']), appliesTo: 'universal' },
    // --- Value / yields ---
    // Earnings yield (E/P) so that "right = cheaper" and a loss-making firm does not break the axis.
    { id: 'v_ey', section: 'Value', labelEn: 'Earnings yield (E/P)', labelZh: '盈利收益率', rawFormat: 'pct', read: (r) => { const pe = fin(r.metric.peTTM); return pe === null || pe === 0 ? null : 100 / pe; }, appliesTo: 'stock' },
    { id: 'v_pb', section: 'Value', labelEn: 'Book yield (B/P)', labelZh: '市净率倒数', rawFormat: 'pct', read: (r) => { const pb = fin(r.metric.pbQuarterly) ?? fin(r.metric.pbAnnual); return pb !== null && pb > 0 ? 100 / pb : null; }, appliesTo: 'stock' },
    { id: 'v_ps', section: 'Value', labelEn: 'Sales yield (S/P)', labelZh: '市销率倒数', rawFormat: 'pct', read: (r) => { const ps = fin(r.metric.psTTM); return ps !== null && ps > 0 ? 100 / ps : null; }, appliesTo: 'stock' },
    { id: 'v_dy', section: 'Value', labelEn: 'Dividend yield (indicated)', labelZh: '指示股息率', rawFormat: 'pct', read: (r) => fin(r.metric.dividendYieldIndicatedAnnual), appliesTo: 'universal' },
    // --- Growth ---
    { id: 'g_rev_yoy', section: 'Growth', labelEn: 'Revenue growth', labelZh: '营收同比增速', rawFormat: 'pct', read: (r) => fin(r.metric.revenueGrowthTTMYoy), appliesTo: 'stock' },
    { id: 'g_eps_yoy', section: 'Growth', labelEn: 'EPS growth', labelZh: 'EPS 同比增速', rawFormat: 'pct', read: (r) => fin(r.metric.epsGrowthTTMYoy), appliesTo: 'stock' },
    // --- Profitability (all stock-only beyond the universal yield) ---
    { id: 'q_roe', section: 'Profitability', labelEn: 'Return on equity (ROE)', labelZh: '净资产收益率 (ROE)', rawFormat: 'pct', read: (r) => fin(r.metric.roeTTM), appliesTo: 'stock' },
    { id: 'q_roa', section: 'Profitability', labelEn: 'Return on assets (ROA)', labelZh: '总资产收益率 (ROA)', rawFormat: 'pct', read: (r) => fin(r.metric.roaTTM), appliesTo: 'stock' },
    { id: 'q_roi', section: 'Profitability', labelEn: 'Return on invested capital', labelZh: '投入资本收益率', rawFormat: 'pct', read: (r) => fin(r.metric.roiTTM), appliesTo: 'stock' },
    { id: 'q_gm', section: 'Profitability', labelEn: 'Gross margin', labelZh: '毛利率', rawFormat: 'pct', read: (r) => fin(r.metric.grossMarginTTM), appliesTo: 'stock' },
    { id: 'q_om', section: 'Profitability', labelEn: 'Operating margin', labelZh: '营业利润率', rawFormat: 'pct', read: (r) => fin(r.metric.operatingMarginTTM), appliesTo: 'stock' },
    { id: 'q_pm', section: 'Profitability', labelEn: 'Pretax margin', labelZh: '税前净利率', rawFormat: 'pct', read: (r) => fin(r.metric.pretaxMarginTTM), appliesTo: 'stock' },
    { id: 'q_nm', section: 'Profitability', labelEn: 'Net margin', labelZh: '净利率', rawFormat: 'pct', read: (r) => fin(r.metric.netProfitMarginTTM), appliesTo: 'stock' },
    // --- Quality / leverage ---
    { id: 'q_lev', section: 'Quality', labelEn: 'Debt / equity (lower is better)', labelZh: '负债权益比', rawFormat: 'ratio', lowerIsBetter: true, read: (r) => fin(r.metric['totalDebt/totalEquityQuarterly']), appliesTo: 'stock' },
    // --- Dividends (universal: ETFs have yields too) ---
    { id: 'd_payout', section: 'Dividends', labelEn: 'Dividend payout ratio', labelZh: '股息支付率', rawFormat: 'pct', read: (r) => fin(r.metric.dividendPayoutRatioTTM), appliesTo: 'universal' },
    // --- Size / liquidity (handled as raw axes in buildExplainView below) ---
    // s_mcap / s_dvol / p_beta / x_analyst live on as dedicated raw axes there.
];

// Sentiment (Adanos, Mongo-only). Never fetched live from /eye: Adanos free is
// 250 requests/month shared across every endpoint, so /eye reads only the
// snapshots the Inngest collector already wrote; reason=no-data when a symbol
// has never been collected. Scores are percentiles like every other feature axis.
const SENTIMENT_SCORED: ScoredDef[] = [
    { id: 'x_sent_buzz', section: 'Sentiment', labelEn: 'Avg. buzz (Adanos)', labelZh: '平均 buzz（Adanos）', rawFormat: 'num', read: (r) => fin(r.sentiment?.averageBuzz), appliesTo: 'universal' },
    { id: 'x_sent_bull', section: 'Sentiment', labelEn: 'Bullish avg', labelZh: '多头平均占比', rawFormat: 'pct', read: (r) => fin(r.sentiment?.bullishAverage), appliesTo: 'universal' },
    { id: 'x_sent_cov', section: 'Sentiment', labelEn: 'Source coverage', labelZh: '来源覆盖（/4）', rawFormat: 'num', read: (r) => fin(r.sentiment?.coverage), appliesTo: 'universal' },
    {
        id: 'x_sent_loc',
        section: 'Sentiment',
        labelEn: 'Sentiment location',
        labelZh: '情绪定位（综合）',
        rawFormat: 'num',
        approx: 'mean(percentile buzz, percentile bullish, coverage×25) — equal-weighted, descriptive only',
        appliesTo: 'universal',
        read: (r) => {
            // Composite location score built from percentile scores — computed inside
            // percentileScores for x_sent_loc itself below; here we return a proxy
            // reading that percentileScores ranks. The raw location is reconstructed
            // in buildExplainView as mean of the three percentile columns.
            const buzz = fin(r.sentiment?.averageBuzz);
            const bull = fin(r.sentiment?.bullishAverage);
            const cov = fin(r.sentiment?.coverage);
            if (buzz === null && bull === null && cov === null) return null;
            // Legacy placeholder removed — actual value comes from percentileScores
            // over the reconstructed composite below. Keep the signature for raw.
            return buzz ?? bull ?? cov;
        },
    },
];

// Suggested starting layout — 16 axes (same cap as before). Widened astro layer:
//   a_ruler (12) and a_ruler_retro (13) stay in place; the remaining 7 new astro axes
//   and 3 new Sentiment axes are in the catalog below, reachable via “Add axis”.
//   MAX_AXES was raised 16 -> 20 so the sentiment + astro axes can coexist with the
//   16 defaults without evicting anything; defaults themselves are unchanged.
export const DEFAULT_AXIS_IDS = [
    'v_ey', 'g_rev_yoy', 'g_eps_yoy', 'q_roe', 'q_gm', 'p_52w_pos', 'p_6m', 'p_beta', 's_mcap', 's_dvol', 'x_analyst',
    'a_ruler', 'a_ruler_retro', 'r_today', 'r_1m', 'r_1q',
];

// Every axis the user can pick from. New price/return ids slot in here after
// the original catalog so old URLs stay valid. Symbolic layer (astro, never
// scored) — a_ruler, a_ruler_retro + the 7 extended ids below.
export const AXIS_CATALOG_IDS = [
    ...DEFAULT_AXIS_IDS,
    'v_pb', 'v_ps', 'v_dy', 'q_nm', 'q_lev', 'p_1y',
    'a_moon_phase', 'a_sun_sign', 'a_ruler_sign', 'a_ruler_decl', 'a_ruler_speed', 'a_next_event_days', 'a_event_count_7d',
    // Sentiment (Adanos, Mongo-only): x_sent_loc is the composite of the three
    // below — place it first so the catalog groups read top-down.
    'x_sent_loc', 'x_sent_buzz', 'x_sent_bull', 'x_sent_cov',
    // Expanded price / profitability / dividend axes (MongoDB, see FACTOR_METRIC_KEYS).
    'p_5d', 'p_mtd', 'p_3m', 'p_ytd', 'q_roa', 'q_roi', 'q_om', 'q_pm', 'd_payout',
];

/**
 * Default axis layout when the selection is ETF-only. Same universal axes as the
 * stock default, but stock-only fundamentals (E/P, revenue/EPS growth, ROE, gross margin,
 * book/sales yield, net margin, leverage, analyst consensus) are swapped out.
 * Order mirrors DEFAULT_AXIS_IDS position-by-position where the axis is universal.
 */
export const DEFAULT_ETF_AXIS_IDS = [
    'p_52w_pos', 'p_6m', 'p_beta', 's_mcap', 's_dvol',
    'a_ruler', 'a_ruler_retro', 'r_today', 'r_1m', 'r_1q',
];

/** Axis ids whose values only make sense for one instrument type (stock vs ETF). */
export const STOCK_ONLY_AXIS_IDS = new Set([
    'v_ey', 'g_rev_yoy', 'g_eps_yoy', 'q_roe', 'q_roa', 'q_roi', 'q_gm', 'q_om', 'q_pm', 'q_nm', 'q_lev',
    'v_pb', 'v_ps', 'x_analyst',
]);
export const ETF_ONLY_AXIS_IDS = new Set<string>([]); // populated after capture; see Step 1 gate in plan

export const OUTCOME_AXIS_IDS = ['r_today', 'r_1m', 'r_1q'] as const;

export interface CosmyDayContext {
    nextEventDays: number | null;
    eventCount7d: number;
    error?: string;
    /** Closest upcoming sky event for the banner (headline + days away). */
    nextEvent?: { days: number; headline: string; date: string } | null;
    /** Single-line transit/moon theme for the banner (CosmyDay /content/transit). */
    theme?: string | null;
    /** Snapshot freshness (ms since Mongo write) — null when live-fetched this request. */
    fetchedAgoMs?: number | null;
}

export interface ExplainView {
    axes: PcpAxis[];
    table: PcpTable;
    skipped: string[]; // selected symbols without any readable data
    astro: {
        asOf: string;
        moon: MoonState;
        retrograde: Planet[];
        /** Local tropical Sun/Moon signs for the banner (never part of any score). */
        sunSign: string;
        sunSignDegree: number;
        /** CosmyDay feed state for a_next_event_days / a_event_count_7d (null = no remote source). */
        cosmyday: CosmyDayContext;
    };
}

function axisFrom(base: Pick<PcpAxis, 'id' | 'labelEn' | 'labelZh' | 'section' | 'role' | 'kind' | 'format'> & Partial<PcpAxis>, column: CellValue[], reason: AxisReason = 'ok'): PcpAxis {
    const present = column.filter((v) => v !== null).length;
    return {
        domain: [0, 100], isScore: false, verified: false,
        coverage: column.length ? present / column.length : 0, hasMissing: present < column.length,
        reason, ...base,
    };
}

/** Derive why an axis is empty (or not): null everywhere vs some cells present. / 判断轴为何为空。 */
function reasonFor(values: (number | null)[], fetchHadError: boolean): AxisReason {
    if (values.some((v) => v !== null)) return 'ok';
    return fetchHadError ? 'fetch-failed' : 'no-data';
}

function reasonForCells(values: (CellValue | null)[], fetchHadError: boolean): AxisReason {
    if (values.some((v) => v !== null)) return 'ok';
    return fetchHadError ? 'fetch-failed' : 'no-data';
}

// Outcomes get headroom and always include zero, so up and down are visible at a glance.
function outcomeDomain(column: (number | null)[]): [number, number] {
    const [lo, hi] = domainFromValues('linear', column);
    const a = Math.min(lo, 0);
    const b = Math.max(hi, 0);
    const pad = (b - a || 1) * 0.08;
    return [a - pad, b + pad];
}

// Expand a declination/equatorial domain to include the Sun's seasonal extremes when useful.
function degDomain(values: (number | null)[]): [number, number] {
    const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return [-23.5, 23.5];
    const lo = Math.min(-23.5, sorted[0] - 1);
    const hi = Math.max(23.5, sorted[sorted.length - 1] + 1);
    return [lo, hi];
}

export function buildExplainView(
    stocks: StockFactorRaw[],
    selected: string[],
    asOf: Date,
    cosmyday?: CosmyDayContext,
): ExplainView {
    const readable = (s: StockFactorRaw) =>
        SCORED.some((d) => d.read(s) !== null) || [s.changePct, s.metric['monthToDatePriceReturnDaily'], s.metric['13WeekPriceReturnDaily'], s.marketCap].some((v) => fin(v) !== null);
    const kept = stocks.filter(readable);
    const skipped = selected.filter((sym) => !kept.some((s) => s.symbol === sym));
    // Selected stocks first, in the user's order; peers after.
    const rows = [
        ...selected.map((sym) => kept.find((s) => s.symbol === sym)).filter((s): s is StockFactorRaw => !!s),
        ...kept.filter((s) => !selected.includes(s.symbol)),
    ];

    const columns: Record<string, CellValue[]> = {};
    const raw: Record<string, CellValue[]> = {};
    const axes = new Map<string, PcpAxis>();

    /**
     * Per-kind percentile scoring: a stock's E/P percentile is among stocks, an ETF's
     * among ETFs — the two universes never pool, so an ETF never drags a stock's
     * rank (or vice versa). When a kind bucket has fewer than `minValid` readings,
     * percentileScores returns null for that bucket (same missing-lane behaviour
     * as a thin universe today). `unknown` rows score in their own bucket.
     */
    function perKindScores(readings: (number | null)[], kinds: InstrumentKind[], higherIsBetter = true): (number | null)[] {
        const out: (number | null)[] = readings.map(() => null);
        const buckets = new Map<InstrumentKind, { idx: number[]; vals: (number | null)[] }>();
        kinds.forEach((k, idx) => {
            let b = buckets.get(k);
            if (!b) {
                b = { idx: [], vals: [] };
                buckets.set(k, b);
            }
            b.idx.push(idx);
            b.vals.push(readings[idx]);
        });
        for (const b of buckets.values()) {
            const scores = percentileScores(b.vals, { higherIsBetter });
            scores.forEach((s, i) => { out[b.idx[i]] = s; });
        }
        return out;
    }

    const rowKinds = rows.map((r) => r.kind ?? 'unknown');

    for (const d of SCORED) {
        const readings = rows.map(d.read);
        raw[d.id] = readings;
        columns[d.id] = perKindScores(readings, rowKinds, !d.lowerIsBetter);
        axes.set(d.id, axisFrom({ id: d.id, labelEn: d.labelEn, labelZh: d.labelZh, section: d.section, role: 'feature', kind: 'linear', format: 'score', rawFormat: d.rawFormat, isScore: true, verified: true, approx: d.approx, appliesTo: d.appliesTo }, columns[d.id], reasonFor(readings, false)));
    }

    const beta = rows.map((r) => fin(r.metric.beta));
    columns.p_beta = beta;
    axes.set('p_beta', axisFrom({ id: 'p_beta', labelEn: 'Beta (risk)', labelZh: 'Beta', section: 'Momentum', role: 'feature', kind: 'linear', format: 'ratio', domain: domainFromValues('linear', beta), verified: true, appliesTo: 'universal' }, beta, reasonFor(beta, false)));

    const mcap = rows.map((r) => {
        const fromProfile = fin(r.marketCap);
        const fromMetric = fin(r.metric.marketCapitalization);
        const v = fromProfile ?? fromMetric;
        return v !== null && v > 0 ? v : null;
    });
    columns.s_mcap = mcap;
    axes.set('s_mcap', axisFrom({ id: 's_mcap', labelEn: 'Market cap', labelZh: '市值（对数）', section: 'Size & liquidity', role: 'feature', kind: 'log', format: 'usdM', domain: domainFromValues('log', mcap), verified: true, appliesTo: 'universal' }, mcap, reasonFor(mcap, false)));

    // 10-day average volume x price. Finnhub's volume unit is unverified; if it is in millions of shares this is USD millions.
    const dvol = rows.map((r) => { const v = fin(r.metric['10DayAverageTradingVolume']); const p = fin(r.price); return v !== null && p !== null && v > 0 && p > 0 ? v * p : null; });
    columns.s_dvol = dvol;
    axes.set('s_dvol', axisFrom({ id: 's_dvol', labelEn: 'Avg. dollar volume', labelZh: '日均成交额（对数）', section: 'Size & liquidity', role: 'feature', kind: 'log', format: 'usdM', domain: domainFromValues('log', dvol), approx: 'Volume unit unverified', appliesTo: 'universal' }, dvol, reasonFor(dvol, false)));

    const analyst = rows.map((r) => fin(r.recommendation));
    columns.x_analyst = analyst;
    axes.set('x_analyst', axisFrom({ id: 'x_analyst', labelEn: 'Analyst consensus', labelZh: '分析师共识（1 卖 — 5 买）', section: 'Sentiment', role: 'feature', kind: 'linear', format: 'ratio', domain: [1, 5], verified: true, appliesTo: 'stock' }, analyst, reasonFor(analyst, false)));

    // ---------------------------------------------------------------------------
    // Sentiment (Adanos, Mongo-only). x_sent_loc is a composite location score:
    // percentile-score the three component axes first, then take their equal-weighted
    // mean per row — so one scalar axis shows the multi-source consensus position and
    // the three component axes (buzz / bullish / coverage) can be shaken out individually.
    // Never fetched live: a symbol that was never collected is no-data by design.
    // ---------------------------------------------------------------------------
    const sentScored = SENTIMENT_SCORED.filter((d) => d.id !== 'x_sent_loc');
    for (const d of sentScored) {
        const readings = rows.map(d.read);
        raw[d.id] = readings;
        columns[d.id] = perKindScores(readings, rowKinds);
        axes.set(d.id, axisFrom({ id: d.id, labelEn: d.labelEn, labelZh: d.labelZh, section: d.section, role: 'sentiment', kind: 'linear', format: 'score', rawFormat: d.rawFormat, isScore: true, verified: true, approx: 'Adanos snapshots (Mongo), Reddit+X+News+Polymarket', appliesTo: d.appliesTo }, columns[d.id], reasonFor(readings, false)));
    }
    // Composite: mean of the three percentile scores, per row (null when any is null).
    const locDef = SENTIMENT_SCORED.find((d) => d.id === 'x_sent_loc')!;
    const locScores = rows.map((_, i) => {
        const parts = ['x_sent_buzz', 'x_sent_bull', 'x_sent_cov'].map((id) => columns[id]?.[i]);
        return parts.every((v): v is number => typeof v === 'number') ? (parts[0] + parts[1] + parts[2]) / 3 : null;
    });
    const locRaw = rows.map((r) => locDef.read(r));
    raw.x_sent_loc = locRaw;
    columns.x_sent_loc = locScores;
    axes.set('x_sent_loc', axisFrom({ id: locDef.id, labelEn: locDef.labelEn, labelZh: locDef.labelZh, section: locDef.section, role: 'sentiment', kind: 'linear', format: 'score', rawFormat: 'num', isScore: true, verified: true, approx: locDef.approx, appliesTo: locDef.appliesTo }, columns.x_sent_loc, reasonFor(locScores, false)));

    // ---------------------------------------------------------------------------
    // Symbolic layer (astro, never scored, never weighted). All values are computed
    // locally; only a_next_event_days / a_event_count_7d touch the CosmyDay feed.
    // ---------------------------------------------------------------------------
    const retro = new Map<Planet, boolean>();
    const rulers = rows.map((r) => rulerForIndustry(r.industry));
    columns.a_ruler = rulers;
    columns.a_ruler_retro = rulers.map((p) => {
        if (!p) return null;
        if (!retro.has(p)) retro.set(p, isRetrograde(p, asOf));
        return retro.get(p) ? 'Retrograde' : 'Direct';
    });
    const astroBase = { section: 'Symbolic layer', role: 'astro' as AxisRole, kind: 'categorical' as const, format: 'num' as const, verified: true, approx: 'Traditional correspondence, not evidence', appliesTo: 'universal' as AxisKindAppliesTo };
    axes.set('a_ruler', axisFrom({ ...astroBase, id: 'a_ruler', labelEn: 'Ruling planet', labelZh: '板块守护星（传统对应）' }, columns.a_ruler));
    axes.set('a_ruler_retro', axisFrom({ ...astroBase, id: 'a_ruler_retro', labelEn: 'Ruler motion', labelZh: '守护星顺逆行' }, columns.a_ruler_retro));

    // Sun / Moon dimensions (date-derived — every row shows the same value, the axis is a
    // "what is today's sky" marker so users can sort/compare against fundamentals).
    const moon = moonState(asOf);
    const sunLon = eclipticLongitude('Sun', asOf);
    const sunSign = zodiacSign(sunLon);
    const sunDeg = signDegree(sunLon);

    const moonPhaseCol = rows.map(() => moon.phaseAngle);
    columns.a_moon_phase = moonPhaseCol;
    axes.set(
        'a_moon_phase',
        axisFrom({ ...astroBase, id: 'a_moon_phase', labelEn: 'Moon phase angle (0–360°)', labelZh: '月相角（0–360°）', kind: 'linear', format: 'num', domain: [0, 360], approx: `Moon: ${moon.name}, ${Math.round(moon.illumination * 100)}% lit` }, moonPhaseCol, reasonFor(moonPhaseCol, false)),
    );

    const sunSignCol = rows.map(() => sunSign);
    columns.a_sun_sign = sunSignCol;
    axes.set(
        'a_sun_sign',
        axisFrom({ ...astroBase, id: 'a_sun_sign', labelEn: 'Sun sign (tropical)', labelZh: '日元星座（回归黄道）', approx: `Sun in ${sunSign} at ${sunDeg.toFixed(1)}°` }, sunSignCol, reasonForCells(sunSignCol, false)),
    );

    // Ruler-derived dimensions (one per row — hence a real differentiation axis).
    const rulerSigns = rulers.map((p) => (p ? zodiacSign(eclipticLongitude(p, asOf)) : null));
    columns.a_ruler_sign = rulerSigns;
    axes.set(
        'a_ruler_sign',
        axisFrom({ ...astroBase, id: 'a_ruler_sign', labelEn: 'Ruler sign', labelZh: '守护星星座', approx: 'Tropical, Swiss-Ephemeris compatible' }, rulerSigns, reasonForCells(rulerSigns, false)),
    );

    const rulerDecls = rulers.map((p) => (p ? declination(p, asOf) : null));
    columns.a_ruler_decl = rulerDecls;
    axes.set(
        'a_ruler_decl',
        axisFrom({ ...astroBase, id: 'a_ruler_decl', labelEn: 'Ruler declination (°)', labelZh: '守护星赤纬（°）', kind: 'linear', format: 'num', domain: degDomain(rulerDecls), approx: 'Geocentric declination, −23.5° ~ +23.5° seasonal band' }, rulerDecls, reasonFor(rulerDecls, false)),
    );

    const rulerSpeeds = rulers.map((p) => (p ? dailySpeed(p, asOf) : null));
    columns.a_ruler_speed = rulerSpeeds;
    axes.set(
        'a_ruler_speed',
        axisFrom({ ...astroBase, id: 'a_ruler_speed', labelEn: 'Ruler speed (°/day)', labelZh: '守护星黄经速度（°/日）', kind: 'linear', format: 'num', domain: domainFromValues('linear', rulerSpeeds), approx: 'Negative = retrograde' }, rulerSpeeds, reasonFor(rulerSpeeds, false)),
    );

    // CosmyDay-derived: whole-universe markers (the feed is date-based, not per-symbol).
    const cd = cosmyday ?? { nextEventDays: null, eventCount7d: 0 };
    const nextEvent = rows.map(() => cd.nextEventDays);
    columns.a_next_event_days = nextEvent;
    axes.set(
        'a_next_event_days',
        axisFrom(
            { ...astroBase, id: 'a_next_event_days', labelEn: 'Days to next sky event', labelZh: '下个天象日（天）', kind: 'linear', format: 'num', domain: [0, 30], approx: cd.error ? `CosmyDay feed unavailable (${cd.error})` : 'CosmyDay /events/upcoming, importance ≥60' },
            nextEvent,
            // When there is no feed the axis is "no-data", not "fetch-failed" — the user just
            // hasn't warmed it yet. cosmyday.ts surfaces the underlying error via ExplainView.astro.
            reasonFor(nextEvent, false),
        ),
    );

    const count7 = rows.map(() => cd.eventCount7d);
    columns.a_event_count_7d = count7;
    axes.set(
        'a_event_count_7d',
        axisFrom(
            { ...astroBase, id: 'a_event_count_7d', labelEn: 'Sky events in next 7 days', labelZh: '未来 7 天天象数', kind: 'linear', format: 'num', domain: [0, 10], approx: 'CosmyDay /events/upcoming, importance ≥60' },
            count7,
            // 0 is a valid reading when the feed responds, so treat non-null as ok.
            cd.nextEventDays === null && cd.eventCount7d === 0 && cd.error ? 'fetch-failed' : 'ok',
        ),
    );

    // Finnhub free does not return 1MonthPriceReturnDaily (capture 2026-11-07); use month-to-date instead.
    // Finnhub free 不返回 1MonthPriceReturnDaily（2026-11-07 捕获确认）；用 monthToDatePriceReturnDaily 代替。
    const outcomes: [string, string, string, (r: StockFactorRaw) => number | null, boolean][] = [
        ['r_today', 'Price today', '今日涨跌（现价 vs 前收）', (r) => fin(r.changePct), true],
        ['r_1m', 'Month-to-date return', '本月以来涨跌 (MTD)', (r) => fin(r.metric['monthToDatePriceReturnDaily']), true],
        ['r_1q', 'Price 1 quarter', '过去 1 季涨跌（13 周）', (r) => fin(r.metric['13WeekPriceReturnDaily']), true],
    ];
    const rank: Record<string, (number | null)[]> = {};
    for (const [id, en, zh, read, verified] of outcomes) {
        const values = rows.map(read);
        columns[id] = values;
        rank[id] = perKindScores(values, rowKinds);
        axes.set(id, axisFrom({ id, labelEn: en, labelZh: zh, section: 'Price outcome', role: 'outcome', kind: 'linear', format: 'spct', domain: outcomeDomain(values), verified, appliesTo: 'universal' }, values, reasonFor(values, false)));
    }

    return {
        axes: AXIS_CATALOG_IDS.map((id) => axes.get(id)!),
        skipped,
        astro: {
            asOf: asOf.toISOString(),
            moon,
            retrograde: retrogradePlanets(asOf),
            sunSign,
            sunSignDegree: sunDeg,
            cosmyday: cd,
        },
        table: {
            ids: rows.map((r) => r.symbol),
            labels: rows.map((r) => r.name || r.symbol),
            group: rows.map((r) => r.industry?.trim() || null),
            columns,
            raw,
            rank,
            selectedIndex: rows.map((r) => { const i = selected.indexOf(r.symbol); return i < 0 ? null : i; }),
            kinds: rowKinds,
        },
    };
}
