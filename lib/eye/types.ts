// Shared types for the Eye of Omniscience module (vertical-flow parallel coordinates, plan §10).

export type AxisKind = 'linear' | 'log' | 'categorical';
export type ValueFormat = 'score' | 'pct' | 'spct' | 'ratio' | 'usdM' | 'num';
export type CellValue = number | string | null;
// feature = explains; outcome = the observed price result (never scored or weighted); astro = symbolic layer.
// sentiment = Adanos multi-source sentiment aggregates (Reddit/X/News/Polymarket) — feature, scored, never weighted differently.
export type AxisRole = 'feature' | 'outcome' | 'astro' | 'sentiment';
/** Which instrument types an axis is meaningful for. 'universal' = both stock and ETF. */
export type AxisKindAppliesTo = 'stock' | 'etf' | 'universal';
/** Stock's own instrument type, for type-aware axis selection and per-kind scoring. */
export type InstrumentKind = 'stock' | 'etf' | 'unknown';

// Why an axis might be empty, so the UI can explain itself instead of rendering an ambiguous gap.
// ok = values present; fetch-failed = the live request failed (429/403/timeout); no-data = request
// succeeded but every reading for this field was null (wrong field name, or a symbol with no fundamentals).
export type AxisReason = 'ok' | 'fetch-failed' | 'no-data';

export interface PcpAxis {
    id: string;
    labelEn: string;
    labelZh: string;
    section: string;
    role: AxisRole;
    kind: AxisKind;
    // Numeric kinds only. Score axes are fixed to [0, 100]; raw axes use the universe's P1-P99 (log: powers of 10).
    domain: [number, number];
    format: ValueFormat;
    rawFormat?: ValueFormat; // how to print the underlying reading of a score axis
    isScore: boolean;
    coverage: number; // 0..1 share of rows with a value
    hasMissing: boolean;
    verified: boolean;
    approx?: string;
    /** Why the axis might be empty, so the header can explain itself. Default 'ok'. */
    reason: AxisReason;
    /** Which instrument types this axis is meaningful for ('universal' = both). */
    appliesTo?: AxisKindAppliesTo;
}

export interface PcpTable {
    ids: string[];
    labels: string[];
    group: (string | null)[]; // Finnhub industry
    // axisId -> one value per row. Score axes hold 0-100 percentiles within the universe.
    columns: Record<string, CellValue[]>;
    // axisId -> the underlying reading of a score axis, for tooltips.
    raw: Record<string, CellValue[]>;
    // axisId -> percentile rank of the reading within the universe (outcome axes, for the summary).
    rank: Record<string, (number | null)[]>;
    // Position among the user's selection (0-based), null for background peers.
    selectedIndex: (number | null)[];
    // Instrument type per row ('stock' | 'etf' | 'unknown').
    kinds: InstrumentKind[];
}

// Raw Finnhub readings for one stock; field names follow `stock/metric?metric=all` and are unverified.
export const FACTOR_METRIC_KEYS = [
    'peTTM',
    'pbQuarterly',
    'pbAnnual',
    'psTTM',
    'dividendYieldIndicatedAnnual',
    'revenueGrowthTTMYoy',
    'epsGrowthTTMYoy',
    'roeTTM',
    'grossMarginTTM',
    'netProfitMarginTTM',
    'totalDebt/totalEquityQuarterly',
    'marketCapitalization',
    '26WeekPriceReturnDaily',
    '13WeekPriceReturnDaily',
    '52WeekPriceReturnDaily',
    'monthToDatePriceReturnDaily',
    '52WeekHigh',
    '52WeekLow',
    'beta',
    '10DayAverageTradingVolume',
] as const;

export type FactorMetricKey = (typeof FACTOR_METRIC_KEYS)[number];

/**
 * Adanos multi-source sentiment aggregates for one symbol, from
 * `AdanosSentimentSnapshot` (Mongo). `null` = no snapshot at all (never
 * collected — Adanos free tier is 250/mo shared, so we never fetch live
 * from /eye; reason=no-data then).
 */
export interface StockSentimentRaw {
    /** Avg. buzz 0..100 across available Adanos sources (Reddit/X/News/Polymarket). */
    averageBuzz: number | null;
    /** Bullish average 0..100 (null when no source reports bullishPct). */
    bullishAverage: number | null;
    /** How many of the 4 sources have a snapshot (Coverage x/4). */
    coverage: number | null;
    /** Σ mentions (or trades for Polymarket) across available sources. */
    totalMentions: number | null;
    /** Most recent collection time — used for stale signalling in tooltips. */
    latestCollectedAt: Date | null;
}

export interface StockFactorRaw {
    symbol: string;
    name: string;
    industry: string | null;
    marketCap: number | null; // USD millions
    price: number | null;
    changePct: number | null; // today's change vs previous close, in percent
    recommendation: number | null; // analyst consensus 1 (strong sell) .. 5 (strong buy)
    metric: Partial<Record<FactorMetricKey, number | null>>;
    /** Adanos sentiment aggregates (Mongo snapshot only, never live). Optional for peers. */
    sentiment?: StockSentimentRaw | null;
    /** Stock vs ETF vs unclassified — drives type-aware axis selection and per-kind scoring. */
    kind: InstrumentKind;
    /**
     * Finnhub `profile2.type` when present (e.g. 'common_stock', 'unit', …). The API has
     * no reliable "etf" value, so classification leans on the curated ETF list and
     * profile fallbacks; this field keeps the raw signal for logging/debugging.
     */
    profileType?: string | null;
}

export const MAX_SELECTED = 12;
// The user composes the chart: any 2 to 20 axes, each chosen independently from the catalog.
// DEFAULT_AXIS_IDS (16) stays put; the 20-cap lets the 7 astro + 4 sentiment axes
// coexist without evicting the defaults. Old URLs carry at most 16 ids anyway.
export const MIN_AXES = 2;
export const MAX_AXES = 20;

/** Length of the suggested default layout (deliberately less than MAX_AXES). */
export const DEFAULT_AXIS_COUNT = 16;
