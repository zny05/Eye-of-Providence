import { domainFromValues } from '@/lib/eye/pcp/geometry';
import { meanOfAvailable, percentileScores } from '@/lib/eye/normalize';
import type { CellValue, PcpAxis, PcpTable, StockFactorRaw, ValueFormat } from '@/lib/eye/types';

type Cluster = 'value' | 'growth' | 'quality' | 'momentum';

interface ScoreDef {
    id: string;
    cluster: Cluster;
    labelEn: string;
    labelZh: string;
    layer: string;
    higherIs: 'better' | 'worse';
    format: ValueFormat;
    approx?: string;
    read: (r: StockFactorRaw) => number | null;
}

const fin = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Valuation multiples are shown as yields (E/P, B/P, S/P) so that "higher = cheaper" and losses do not break the axis.
const yieldOf = (multiple: number | null | undefined, allowNegative = false) => {
    const m = fin(multiple);
    if (m === null || m === 0 || (!allowNegative && m < 0)) return null;
    return 100 / m;
};

// Finnhub field names are unverified (plan §5.3); a missing field simply leaves the axis empty for that stock.
const SCORE_DEFS: ScoreDef[] = [
    { id: 'v_ey', cluster: 'value', labelEn: 'Earnings yield', labelZh: '盈利收益率', layer: 'L2', higherIs: 'better', format: 'pct', read: (r) => yieldOf(r.metric.peTTM, true) },
    { id: 'v_pb', cluster: 'value', labelEn: 'Book yield (B/P)', labelZh: '净资产收益率倒数', layer: 'L2', higherIs: 'better', format: 'pct', read: (r) => yieldOf(r.metric.pbQuarterly ?? r.metric.pbAnnual) },
    { id: 'v_ps', cluster: 'value', labelEn: 'Sales yield (S/P)', labelZh: '销售收益率', layer: 'L2', higherIs: 'better', format: 'pct', read: (r) => yieldOf(r.metric.psTTM) },
    { id: 'v_dy', cluster: 'value', labelEn: 'Dividend yield', labelZh: '股息率', layer: 'L2', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.dividendYieldIndicatedAnnual) },
    { id: 'g_rev_yoy', cluster: 'growth', labelEn: 'Revenue growth', labelZh: '营收同比增速', layer: 'L3', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.revenueGrowthTTMYoy) },
    { id: 'g_eps_yoy', cluster: 'growth', labelEn: 'EPS growth', labelZh: 'EPS 同比增速', layer: 'L3', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.epsGrowthTTMYoy) },
    { id: 'q_roe', cluster: 'quality', labelEn: 'ROE', labelZh: '净资产收益率', layer: 'L4', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.roeTTM) },
    { id: 'q_roic', cluster: 'quality', labelEn: 'ROIC (approx.)', labelZh: '近似 ROIC', layer: 'L4', higherIs: 'better', format: 'pct', approx: 'Finnhub roiTTM, not a strict ROIC', read: (r) => fin(r.metric.roiTTM) },
    { id: 'q_gm', cluster: 'quality', labelEn: 'Gross margin', labelZh: '毛利率', layer: 'L4', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.grossMarginTTM) },
    { id: 'q_nm', cluster: 'quality', labelEn: 'Net margin', labelZh: '净利率', layer: 'L4', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric.netProfitMarginTTM) },
    { id: 'q_lev', cluster: 'quality', labelEn: 'Debt / equity', labelZh: '负债权益比（越低越好）', layer: 'L4', higherIs: 'worse', format: 'ratio', read: (r) => fin(r.metric['totalDebt/totalEquityQuarterly']) },
    { id: 'p_3m', cluster: 'momentum', labelEn: '13-week return', labelZh: '近 3 月涨幅', layer: 'L5', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric['13WeekPriceReturnDaily']) },
    { id: 'p_1y', cluster: 'momentum', labelEn: '52-week return', labelZh: '近 1 年涨幅', layer: 'L5', higherIs: 'better', format: 'pct', read: (r) => fin(r.metric['52WeekPriceReturnDaily']) },
    {
        id: 'p_52w_pos', cluster: 'momentum', labelEn: '52-week range position', labelZh: '52 周区间位置', layer: 'L5', higherIs: 'better', format: 'pct',
        read: (r) => {
            const hi = fin(r.metric['52WeekHigh']);
            const lo = fin(r.metric['52WeekLow']);
            const px = fin(r.price);
            return hi !== null && lo !== null && px !== null && hi > lo ? Math.min(100, Math.max(0, (100 * (px - lo)) / (hi - lo))) : null;
        },
    },
];

const CLUSTERS: { id: string; cluster: Cluster; labelEn: string; labelZh: string; layer: string }[] = [
    { id: 'k_value', cluster: 'value', labelEn: 'Value', labelZh: '估值', layer: 'L2' },
    { id: 'k_growth', cluster: 'growth', labelEn: 'Growth', labelZh: '成长', layer: 'L3' },
    { id: 'k_quality', cluster: 'quality', labelEn: 'Quality', labelZh: '质量', layer: 'L4' },
    { id: 'k_momentum', cluster: 'momentum', labelEn: 'Momentum', labelZh: '动量', layer: 'L5' },
];

export const STOCK_DEFAULT_AXES = ['industry', 'k_value', 'k_growth', 'k_quality', 'k_momentum', 'composite', 's_mcap'];

function scoreAxis(id: string, labelEn: string, labelZh: string, layer: string, column: (number | null)[], extra: Partial<PcpAxis> = {}): PcpAxis {
    const present = column.filter((v) => v !== null).length;
    return {
        id, labelEn, labelZh, layer, kind: 'linear', domain: [0, 100], format: 'score', isScore: true, higherIs: 'better',
        coverage: column.length ? present / column.length : 0, hasMissing: present < column.length, verified: false, ...extra,
    };
}

function rawAxis(id: string, labelEn: string, labelZh: string, layer: string, kind: 'linear' | 'log', format: ValueFormat, column: (number | null)[], extra: Partial<PcpAxis> = {}): PcpAxis {
    const present = column.filter((v) => v !== null).length;
    return {
        id, labelEn, labelZh, layer, kind, domain: domainFromValues(kind, column), format, isScore: false, higherIs: 'neutral',
        coverage: column.length ? present / column.length : 0, hasMissing: present < column.length, verified: false, ...extra,
    };
}

export interface StockView {
    axes: PcpAxis[];
    table: PcpTable;
    skipped: string[]; // symbols without any readable factor
}

export function buildStockView(stocks: StockFactorRaw[]): StockView {
    const readings = stocks.map((s) => SCORE_DEFS.map((d) => d.read(s)));
    const kept = stocks.map((_, i) => readings[i].some((v) => v !== null));
    const rows = stocks.filter((_, i) => kept[i]);
    const reading = readings.filter((_, i) => kept[i]);
    const skipped = stocks.filter((_, i) => !kept[i]).map((s) => s.symbol);

    const scores = new Map<string, (number | null)[]>();
    const raws = new Map<string, (number | null)[]>();
    SCORE_DEFS.forEach((d, col) => {
        const raw = reading.map((r) => r[col]);
        raws.set(d.id, raw);
        scores.set(d.id, percentileScores(raw, { higherIsBetter: d.higherIs === 'better' }));
    });

    const clusterScores = new Map<string, (number | null)[]>();
    for (const c of CLUSTERS) {
        const members = SCORE_DEFS.filter((d) => d.cluster === c.cluster).map((d) => scores.get(d.id)!);
        clusterScores.set(c.id, rows.map((_, i) => meanOfAvailable(members.map((m) => m[i]))));
    }
    const composite = rows.map((_, i) => meanOfAvailable(CLUSTERS.map((c) => clusterScores.get(c.id)![i])));

    const mcap = rows.map((r) => fin(r.marketCap) !== null && r.marketCap! > 0 ? r.marketCap : null);
    const beta = rows.map((r) => fin(r.metric.beta));
    const industry = rows.map((r) => r.industry?.trim() || null);

    const industryAxis: PcpAxis = {
        id: 'industry', labelEn: 'Industry (Finnhub)', labelZh: '行业（Finnhub 分类）', layer: 'L8', kind: 'categorical', domain: [0, 1],
        format: 'num', isScore: false, higherIs: 'neutral', coverage: industry.filter(Boolean).length / Math.max(1, rows.length),
        hasMissing: industry.some((v) => v === null), verified: true,
    };

    const axes: PcpAxis[] = [
        industryAxis,
        ...CLUSTERS.map((c) => scoreAxis(c.id, c.labelEn, c.labelZh, c.layer, clusterScores.get(c.id)!)),
        scoreAxis('composite', 'Composite', '综合（簇等权）', 'L2-L5', composite),
        rawAxis('s_mcap', 'Market cap', '市值（对数）', 'L6', 'log', 'usdM', mcap, { verified: true }),
        ...SCORE_DEFS.map((d) => scoreAxis(d.id, d.labelEn, d.labelZh, d.layer, scores.get(d.id)!, { higherIs: d.higherIs, approx: d.approx, rawFormat: d.format })),
        rawAxis('p_beta', 'Beta', 'Beta', 'L5', 'linear', 'ratio', beta),
    ];

    const columns: Record<string, CellValue[]> = { industry, composite, s_mcap: mcap, p_beta: beta };
    for (const c of CLUSTERS) columns[c.id] = clusterScores.get(c.id)!;
    const raw: Record<string, CellValue[]> = {};
    for (const d of SCORE_DEFS) {
        columns[d.id] = scores.get(d.id)!;
        raw[d.id] = raws.get(d.id)!;
    }

    return {
        axes,
        skipped,
        table: {
            ids: rows.map((r) => r.symbol),
            labels: rows.map((r) => r.name || r.symbol),
            group: industry,
            columns,
            raw,
            flags: rows.map((_, i) => ({ lowCoverage: SCORE_DEFS.filter((d) => scores.get(d.id)![i] !== null).length / SCORE_DEFS.length < 0.5 })),
        },
    };
}
