// Shared types for the Eye of Omniscience module (vertical-flow parallel coordinates, plan §10).

export type AxisKind = 'linear' | 'log' | 'categorical';
export type ValueFormat = 'score' | 'pct' | 'spct' | 'ratio' | 'usdM' | 'num';
export type CellValue = number | string | null;
// feature = explains; outcome = the observed price result (never scored or weighted); astro = symbolic layer.
export type AxisRole = 'feature' | 'outcome' | 'astro';

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
    '26WeekPriceReturnDaily',
    '13WeekPriceReturnDaily',
    '52WeekPriceReturnDaily',
    '1MonthPriceReturnDaily',
    '52WeekHigh',
    '52WeekLow',
    'beta',
    '10DayAverageTradingVolume',
] as const;

export type FactorMetricKey = (typeof FACTOR_METRIC_KEYS)[number];

export interface StockFactorRaw {
    symbol: string;
    name: string;
    industry: string | null;
    marketCap: number | null; // USD millions
    price: number | null;
    changePct: number | null; // today's change vs previous close, in percent
    recommendation: number | null; // analyst consensus 1 (strong sell) .. 5 (strong buy)
    metric: Partial<Record<FactorMetricKey, number | null>>;
}

export const MAX_SELECTED = 12;
// The user composes the chart: any 2 to 16 axes, each chosen independently from the catalog.
export const MIN_AXES = 2;
export const MAX_AXES = 16;
