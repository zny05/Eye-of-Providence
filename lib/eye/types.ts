// Shared types for the Eye of Omniscience module (vertical-flow parallel coordinates).

export type AxisKind = 'linear' | 'log' | 'categorical';
export type ValueFormat = 'score' | 'pct' | 'ratio' | 'usdM' | 'num';
export type CellValue = number | string | null;

export interface PcpAxis {
    id: string;
    labelEn: string;
    labelZh: string;
    layer: string;
    kind: AxisKind;
    // Numeric kinds only. Score axes are fixed to [0, 100]; raw axes use the universe's P1-P99 (log: powers of 10).
    domain: [number, number];
    format: ValueFormat;
    rawFormat?: ValueFormat; // how to print the underlying reading of a score axis
    isScore: boolean;
    higherIs: 'better' | 'worse' | 'neutral';
    coverage: number; // 0..1 share of rows with a value
    hasMissing: boolean;
    verified: boolean;
    approx?: string;
}

export interface PcpRowFlags {
    lowCoverage?: boolean;
}

export interface PcpTable {
    ids: string[];
    labels: string[];
    group: (string | null)[];
    // axisId -> one value per row. Score axes hold 0-100 percentiles.
    columns: Record<string, CellValue[]>;
    // axisId -> underlying reading for tooltips (same shape as `columns`; only set where it differs).
    raw: Record<string, CellValue[]>;
    flags: PcpRowFlags[];
}

export type ColorSpec = { kind: 'group' } | { kind: 'axis'; axisId: string };

export type BrushRange =
    | { kind: 'range'; lo: number; hi: number }
    | { kind: 'set'; keys: string[] }
    | { kind: 'missing' };
// Same axis: OR. Across axes: AND.
export type BrushState = Record<string, BrushRange[]>;

// Raw Finnhub readings for one stock; field names follow `stock/metric?metric=all` and are unverified (see plan §5.3).
export const FACTOR_METRIC_KEYS = [
    'peTTM',
    'pbQuarterly',
    'pbAnnual',
    'psTTM',
    'dividendYieldIndicatedAnnual',
    'revenueGrowthTTMYoy',
    'epsGrowthTTMYoy',
    'roeTTM',
    'roiTTM',
    'grossMarginTTM',
    'netProfitMarginTTM',
    'totalDebt/totalEquityQuarterly',
    '13WeekPriceReturnDaily',
    '52WeekPriceReturnDaily',
    '52WeekHigh',
    '52WeekLow',
    'beta',
] as const;

export type FactorMetricKey = (typeof FACTOR_METRIC_KEYS)[number];

export interface StockFactorRaw {
    symbol: string;
    name: string;
    industry: string | null;
    marketCap: number | null; // USD millions
    price: number | null;
    metric: Partial<Record<FactorMetricKey, number | null>>;
}
