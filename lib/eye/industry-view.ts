import registry from '@/lib/eye/registry/industries.json';
import type { PcpAxis, PcpTable } from '@/lib/eye/types';

// View B: the knowledge base's prior weight structure of 130 industries x 6 driver factors. Static, no data feed.
const FACTORS = [
    { key: 'DEM', en: 'Demand', zh: '需求与周期' },
    { key: 'RATE', en: 'Rates', zh: '利率与融资' },
    { key: 'COST', en: 'Input cost', zh: '成本与通胀' },
    { key: 'LAB', en: 'Labor', zh: '就业与工资' },
    { key: 'POLICY', en: 'Policy', zh: '财政与监管' },
    { key: 'SPEC', en: 'Sector-specific', zh: '行业专属' },
] as const;

const sectorName = new Map(registry.sectors.map((s) => [s.id, s]));

export function buildIndustryView(): { axes: PcpAxis[]; table: PcpTable; version: string } {
    const rows = registry.industries;
    const max = Math.max(...rows.flatMap((r) => Object.values(r.weights)));
    const top = Math.ceil(max / 5) * 5;

    const sectorAxis: PcpAxis = {
        id: 'sector', labelEn: 'Sector', labelZh: '板块', layer: 'L8', kind: 'categorical',
        domain: [0, 1], format: 'num', isScore: false, higherIs: 'neutral', coverage: 1, hasMissing: false, verified: true,
    };
    const packAxis: PcpAxis = { ...sectorAxis, id: 'pack', labelEn: 'Indicator pack', labelZh: '指标包' };
    const weightAxes: PcpAxis[] = FACTORS.map((f) => ({
        id: `w_${f.key.toLowerCase()}`, labelEn: `${f.en} weight`, labelZh: `${f.zh}权重（${f.key}）`, layer: 'L1',
        kind: 'linear', domain: [0, top], format: 'num', isScore: false, higherIs: 'neutral', coverage: 1, hasMissing: false, verified: true,
    }));

    const columns: PcpTable['columns'] = {
        sector: rows.map((r) => sectorName.get(r.sector)?.en ?? r.sector),
        pack: rows.map((r) => r.packId),
    };
    for (const f of FACTORS) columns[`w_${f.key.toLowerCase()}`] = rows.map((r) => r.weights[f.key]);

    return {
        axes: [sectorAxis, ...weightAxes, packAxis],
        version: registry.version,
        table: {
            ids: rows.map((r) => r.profileId),
            labels: rows.map((r) => r.name),
            group: columns.sector as string[],
            columns,
            raw: {},
            flags: rows.map(() => ({})),
        },
    };
}

export const INDUSTRY_DEFAULT_AXES = ['sector', 'w_dem', 'w_rate', 'w_cost', 'w_lab', 'w_policy', 'w_spec'];
