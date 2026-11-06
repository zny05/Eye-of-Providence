import { describe, expect, it } from 'vitest';
import { bandKeyOf, categoricalPositions, layoutCategoricalAxis, OTHER_KEY } from '@/lib/eye/pcp/categorical-layout';
import { distToSegment, nearestPolyline } from '@/lib/eye/pcp/hit-test';
import { decodeAxes, decodeBrush, encodeBrush } from '@/lib/eye/pcp/url-state';
import { lineAlpha } from '@/lib/eye/pcp/color-scale';
import type { BrushState } from '@/lib/eye/types';

describe('layoutCategoricalAxis', () => {
    const keys = ['A', 'A', 'A', 'B', 'B', 'C', null];

    it('sizes bands by count and fills the track', () => {
        const bands = layoutCategoricalAxis(keys, 100, 600, { minWidth: 10 });
        expect(bands.map((b) => b.key)).toEqual(['A', 'B', 'C']);
        const total = bands.reduce((s, b) => s + (b.x1 - b.x0), 0) + 6 * 2;
        expect(total).toBeCloseTo(600);
        expect(bands[0].x1 - bands[0].x0).toBeGreaterThan(bands[1].x1 - bands[1].x0);
        expect(bands[0].x0).toBe(100);
    });

    it('enforces a minimum width where the track allows', () => {
        const many = [...Array(50).fill('big'), 'tiny'];
        const bands = layoutCategoricalAxis(many, 0, 600);
        expect(bands[1].x1 - bands[1].x0).toBeGreaterThanOrEqual(28);
    });

    it('folds categories beyond the limit into Other', () => {
        const wide = Array.from({ length: 15 }, (_, i) => `k${i}`);
        const bands = layoutCategoricalAxis(wide, 0, 1200);
        expect(bands).toHaveLength(12);
        const other = bands[11];
        expect(other.key).toBe(OTHER_KEY);
        expect(other.merged).toHaveLength(4);
        expect(bandKeyOf('k9', bands)).toBe(OTHER_KEY);
    });

    it('spreads rows inside a band in order of the next axis, deterministically', () => {
        const bands = layoutCategoricalAxis(['A', 'A', 'A', 'B'], 0, 400, { minWidth: 10 });
        const a = bands[0];
        const pos = categoricalPositions(['A', 'A', 'A', 'B'], bands, [0.9, 0.1, 0.5, 0.2]);
        expect(pos[1]!).toBeLessThan(pos[2]!);
        expect(pos[2]!).toBeLessThan(pos[0]!);
        for (const i of [0, 1, 2]) {
            expect(pos[i]!).toBeGreaterThan(a.x0);
            expect(pos[i]!).toBeLessThan(a.x1);
        }
        expect(categoricalPositions(['A', null], bands, [null, null])[1]).toBeNull();
    });
});

describe('nearestPolyline', () => {
    // Two rows over three axes at y = 0, 100, 200. Row 1 is missing on the middle axis.
    const xs = Float32Array.from([10, 10, 10, 200, NaN, 200]);
    const ys = [0, 100, 200];

    it('finds the closest line within the threshold', () => {
        expect(nearestPolyline(xs, 2, 3, ys, 12, 50, 6)).toBe(0);
        expect(nearestPolyline(xs, 2, 3, ys, 80, 50, 6)).toBeNull();
    });

    it('never hits segments that touch a missing value', () => {
        expect(nearestPolyline(xs, 2, 3, ys, 200, 100, 6)).toBeNull();
    });

    it('honours skipped rows and the segment distance maths', () => {
        expect(nearestPolyline(xs, 2, 3, ys, 12, 50, 6, (r) => r === 0)).toBeNull();
        expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
        expect(distToSegment(15, 0, 0, 0, 10, 0)).toBe(5);
    });
});

describe('url state', () => {
    const valid = new Set(['k_growth', 'sector', 'v_ey@raw']);

    it('round-trips ranges, sets and missing, including awkward keys', () => {
        const brushes: BrushState = {
            k_growth: [{ kind: 'range', lo: 70.5, hi: 100 }, { kind: 'range', lo: -5, hi: 10 }],
            sector: [{ kind: 'set', keys: ['Oil, Gas (E&P)', 'A|B;C'] }, { kind: 'missing' }],
            'v_ey@raw': [{ kind: 'missing' }],
        };
        const encoded = encodeBrush(brushes);
        expect(encoded.split(';')).toHaveLength(3);
        expect(decodeBrush(encoded, valid)).toEqual(brushes);
    });

    it('drops unknown axes and malformed parts', () => {
        expect(decodeBrush('nope:1~2;k_growth:abc,5~1,3~4;sector:in()', valid)).toEqual({ k_growth: [{ kind: 'range', lo: 3, hi: 4 }] });
        expect(decodeBrush(null, valid)).toEqual({});
        expect(decodeBrush('k_growth:%E0%A4%A', valid)).toEqual({});
    });

    it('keeps only valid, unique axis ids in order', () => {
        expect(decodeAxes('sector,nope,k_growth,sector', valid)).toEqual(['sector', 'k_growth']);
    });
});

describe('lineAlpha', () => {
    it('fades as more lines match', () => {
        expect(lineAlpha(10)).toBeCloseTo(0.9);
        expect(lineAlpha(100)).toBeCloseTo(0.25);
        expect(lineAlpha(100000)).toBe(0.1);
    });
});
