import { describe, expect, it } from 'vitest';
import registry from '@/lib/eye/registry/industries.json';

describe('eye industry registry', () => {
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
