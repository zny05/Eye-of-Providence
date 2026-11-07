import { isRetrograde, moonState, retrogradePlanets, rulerForIndustry, type MoonState, type Planet } from '@/lib/eye/astro';
import { meanOfAvailable, percentileScores } from '@/lib/eye/normalize';
import { domainFromValues } from '@/lib/eye/pcp/geometry';
import type { AxisRole, CellValue, PcpAxis, PcpTable, StockFactorRaw, ValueFormat } from '@/lib/eye/types';

const fin = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface ScoredDef {
    id: string;
    section: string;
    labelEn: string;
    labelZh: string;
    read: (r: StockFactorRaw) => number | null;
    rawFormat: ValueFormat;
    approx?: string;
}

// Finnhub field names are unverified (report §6.1); a missing field leaves that stock's cell empty.
const SCORED: ScoredDef[] = [
    // Earnings yield (E/P) so that "right = cheaper" and a loss-making firm does not break the axis.
    { id: 'v_ey', section: 'Value', labelEn: 'Earnings yield (E/P)', labelZh: '盈利收益率', rawFormat: 'pct', read: (r) => { const pe = fin(r.metric.peTTM); return pe === null || pe === 0 ? null : 100 / pe; } },
    { id: 'g_rev_yoy', section: 'Growth', labelEn: 'Revenue growth', labelZh: '营收同比增速', rawFormat: 'pct', read: (r) => fin(r.metric.revenueGrowthTTMYoy) },
    { id: 'g_eps_yoy', section: 'Growth', labelEn: 'EPS growth', labelZh: 'EPS 同比增速', rawFormat: 'pct', read: (r) => fin(r.metric.epsGrowthTTMYoy) },
    { id: 'q_roe', section: 'Quality', labelEn: 'ROE', labelZh: '净资产收益率', rawFormat: 'pct', read: (r) => fin(r.metric.roeTTM) },
    { id: 'q_gm', section: 'Quality', labelEn: 'Gross margin', labelZh: '毛利率', rawFormat: 'pct', read: (r) => fin(r.metric.grossMarginTTM) },
    {
        id: 'p_52w_pos', section: 'Momentum', labelEn: '52-week range position', labelZh: '52 周区间位置', rawFormat: 'pct',
        read: (r) => {
            const hi = fin(r.metric['52WeekHigh']);
            const lo = fin(r.metric['52WeekLow']);
            const px = fin(r.price);
            return hi !== null && lo !== null && px !== null && hi > lo ? Math.min(100, Math.max(0, (100 * (px - lo)) / (hi - lo))) : null;
        },
    },
    // 26 weeks, not 13: the 13-week return is an outcome axis, and one number must not be both cause and effect.
    { id: 'p_6m', section: 'Momentum', labelEn: '26-week return', labelZh: '近 6 月涨幅', rawFormat: 'spct', read: (r) => fin(r.metric['26WeekPriceReturnDaily']) },
];

const AXIS_ORDER = [
    'v_ey', 'g_rev_yoy', 'g_eps_yoy', 'q_roe', 'q_gm', 'p_52w_pos', 'p_6m', 'p_beta', 's_mcap', 's_dvol', 'x_analyst',
    'a_ruler', 'a_ruler_retro', 'r_today', 'r_1m', 'r_1q',
] as const;

export const OUTCOME_AXIS_IDS = ['r_today', 'r_1m', 'r_1q'] as const;

export interface ExplainView {
    axes: PcpAxis[];
    table: PcpTable;
    skipped: string[]; // selected symbols without any readable data
    astro: { asOf: string; moon: MoonState; retrograde: Planet[] };
}

function axisFrom(base: Pick<PcpAxis, 'id' | 'labelEn' | 'labelZh' | 'section' | 'role' | 'kind' | 'format'> & Partial<PcpAxis>, column: CellValue[]): PcpAxis {
    const present = column.filter((v) => v !== null).length;
    return {
        domain: [0, 100], isScore: false, verified: false,
        coverage: column.length ? present / column.length : 0, hasMissing: present < column.length, ...base,
    };
}

// Outcomes get headroom and always include zero, so up and down are visible at a glance.
function outcomeDomain(column: (number | null)[]): [number, number] {
    const [lo, hi] = domainFromValues('linear', column);
    const a = Math.min(lo, 0);
    const b = Math.max(hi, 0);
    const pad = (b - a || 1) * 0.08;
    return [a - pad, b + pad];
}

export function buildExplainView(stocks: StockFactorRaw[], selected: string[], asOf: Date): ExplainView {
    const readable = (s: StockFactorRaw) =>
        SCORED.some((d) => d.read(s) !== null) || [s.changePct, s.metric['1MonthPriceReturnDaily'], s.metric['13WeekPriceReturnDaily'], s.marketCap].some((v) => fin(v) !== null);
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

    for (const d of SCORED) {
        const readings = rows.map(d.read);
        raw[d.id] = readings;
        columns[d.id] = percentileScores(readings);
        axes.set(d.id, axisFrom({ id: d.id, labelEn: d.labelEn, labelZh: d.labelZh, section: d.section, role: 'feature', kind: 'linear', format: 'score', rawFormat: d.rawFormat, isScore: true, approx: d.approx }, columns[d.id]));
    }

    const beta = rows.map((r) => fin(r.metric.beta));
    columns.p_beta = beta;
    axes.set('p_beta', axisFrom({ id: 'p_beta', labelEn: 'Beta (risk)', labelZh: 'Beta', section: 'Momentum', role: 'feature', kind: 'linear', format: 'ratio', domain: domainFromValues('linear', beta) }, beta));

    const mcap = rows.map((r) => (fin(r.marketCap) !== null && r.marketCap! > 0 ? r.marketCap : null));
    columns.s_mcap = mcap;
    axes.set('s_mcap', axisFrom({ id: 's_mcap', labelEn: 'Market cap', labelZh: '市值（对数）', section: 'Size & liquidity', role: 'feature', kind: 'log', format: 'usdM', domain: domainFromValues('log', mcap), verified: true }, mcap));

    // 10-day average volume x price. Finnhub's volume unit is unverified; if it is in millions of shares this is USD millions.
    const dvol = rows.map((r) => { const v = fin(r.metric['10DayAverageTradingVolume']); const p = fin(r.price); return v !== null && p !== null && v > 0 && p > 0 ? v * p : null; });
    columns.s_dvol = dvol;
    axes.set('s_dvol', axisFrom({ id: 's_dvol', labelEn: 'Avg. dollar volume', labelZh: '日均成交额（对数）', section: 'Size & liquidity', role: 'feature', kind: 'log', format: 'usdM', domain: domainFromValues('log', dvol), approx: 'Volume unit unverified' }, dvol));

    const analyst = rows.map((r) => fin(r.recommendation));
    columns.x_analyst = analyst;
    axes.set('x_analyst', axisFrom({ id: 'x_analyst', labelEn: 'Analyst consensus', labelZh: '分析师共识（1 卖 — 5 买）', section: 'Sentiment', role: 'feature', kind: 'linear', format: 'ratio', domain: [1, 5] }, analyst));

    const retro = new Map<Planet, boolean>();
    const rulers = rows.map((r) => rulerForIndustry(r.industry));
    columns.a_ruler = rulers;
    columns.a_ruler_retro = rulers.map((p) => {
        if (!p) return null;
        if (!retro.has(p)) retro.set(p, isRetrograde(p, asOf));
        return retro.get(p) ? 'Retrograde' : 'Direct';
    });
    const astroBase = { section: 'Symbolic layer', role: 'astro' as AxisRole, kind: 'categorical' as const, format: 'num' as const, verified: true, approx: 'Traditional correspondence, not evidence' };
    axes.set('a_ruler', axisFrom({ ...astroBase, id: 'a_ruler', labelEn: 'Ruling planet', labelZh: '板块守护星（传统对应）' }, columns.a_ruler));
    axes.set('a_ruler_retro', axisFrom({ ...astroBase, id: 'a_ruler_retro', labelEn: 'Ruler motion', labelZh: '守护星顺逆行' }, columns.a_ruler_retro));

    const outcomes: [string, string, string, (r: StockFactorRaw) => number | null, boolean][] = [
        ['r_today', 'Price today', '今日涨跌（现价 vs 前收）', (r) => fin(r.changePct), true],
        ['r_1m', 'Price 1 month', '过去 1 月涨跌', (r) => fin(r.metric['1MonthPriceReturnDaily']), false],
        ['r_1q', 'Price 1 quarter', '过去 1 季涨跌（13 周）', (r) => fin(r.metric['13WeekPriceReturnDaily']), false],
    ];
    const rank: Record<string, (number | null)[]> = {};
    for (const [id, en, zh, read, verified] of outcomes) {
        const values = rows.map(read);
        columns[id] = values;
        rank[id] = percentileScores(values);
        axes.set(id, axisFrom({ id, labelEn: en, labelZh: zh, section: 'Price outcome', role: 'outcome', kind: 'linear', format: 'spct', domain: outcomeDomain(values), verified }, values));
    }

    // The mean percentile of the scored features is only used to order the extremes in the summary, never drawn.
    void meanOfAvailable;

    return {
        axes: AXIS_ORDER.map((id) => axes.get(id)!),
        skipped,
        astro: { asOf: asOf.toISOString(), moon: moonState(asOf), retrograde: retrogradePlanets(asOf) },
        table: {
            ids: rows.map((r) => r.symbol),
            labels: rows.map((r) => r.name || r.symbol),
            group: rows.map((r) => r.industry?.trim() || null),
            columns,
            raw,
            rank,
            selectedIndex: rows.map((r) => { const i = selected.indexOf(r.symbol); return i < 0 ? null : i; }),
        },
    };
}
