import { describe, expect, it } from 'vitest';
import registry from '@/lib/eye/registry/industries.json';
import { buildIndustryView } from '@/lib/eye/industry-view';

describe('eye registry', () => {
    it('has 130 industries whose six weights sum to 100', () => {
        expect(registry.industries).toHaveLength(130);
        for (const row of registry.industries) {
            expect(Object.values(row.weights).reduce((a, b) => a + b, 0)).toBe(100);
        }
    });

    it('matches the documented sector counts', () => {
        const counts = Object.fromEntries(registry.sectors.map((s) => [s.en, s.count]));
        expect(counts).toEqual({
            'Basic Materials': 13, 'Communication Services': 5, 'Consumer Cyclical': 17, 'Consumer Defensive': 10,
            Energy: 8, Financial: 14, Healthcare: 10, Industrials: 22, 'Real Estate': 12, Technology: 13, Utilities: 6,
        });
    });

    it('uses unique lowercase ASCII profile ids', () => {
        const ids = registry.industries.map((r) => r.profileId);
        expect(new Set(ids).size).toBe(130);
        for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });
});

describe('industry view', () => {
    it('builds one column per axis with a value for every row', () => {
        const { axes, table } = buildIndustryView();
        expect(table.ids).toHaveLength(130);
        for (const axis of axes) {
            expect(table.columns[axis.id]).toHaveLength(130);
            expect(axis.hasMissing).toBe(false);
        }
        const weight = axes.find((a) => a.id === 'w_rate')!;
        expect(weight.domain[0]).toBe(0);
        expect(weight.domain[1]).toBeGreaterThanOrEqual(36); // REIT - Mortgage carries a 36 RATE weight
    });
});
