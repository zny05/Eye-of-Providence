import { describe, expect, it } from 'vitest';
import { computeGeometry, domainFromValues, tFromX, tToValue, trackTicks, valueToT, xFromT, yOf } from '@/lib/eye/pcp/geometry';

describe('computeGeometry', () => {
    it('uses the three width breakpoints', () => {
        expect(computeGeometry(1200, 5, false)).toMatchObject({ labelPlacement: 'left', labelWidth: 200, rowGap: 72, bandHeight: 16 });
        expect(computeGeometry(800, 5, false)).toMatchObject({ labelPlacement: 'left', labelWidth: 160, rowGap: 64 });
        expect(computeGeometry(400, 5, false)).toMatchObject({ labelPlacement: 'top', labelWidth: 0, rowGap: 84, bandHeight: 20, handleHit: 24, padTop: 58 });
    });

    it('computes track bounds and total height', () => {
        const g = computeGeometry(1200, 12, false);
        expect(g.trackLeft).toBe(212);
        expect(g.trackRight).toBe(1200 - 28);
        expect(g.H).toBe(36 + 11 * 72 + 40);
        expect(yOf(3, g)).toBe(36 + 3 * 72);
    });

    it('reserves a missing lane only when needed', () => {
        const plain = computeGeometry(1200, 4, false);
        const withNa = computeGeometry(1200, 4, true);
        expect(plain.naLaneCenter).toBeNull();
        expect(withNa.trackLeft - plain.trackLeft).toBe(36);
        expect(withNa.naLaneCenter).not.toBeNull();
    });

    it('never squeezes a track below the minimum width', () => {
        const g = computeGeometry(300, 3, false);
        expect(g.trackWidth).toBe(280);
        expect(g.W).toBeGreaterThan(300);
    });
});

describe('value <-> position', () => {
    it('maps linear values, clamping out-of-domain input', () => {
        expect(valueToT('linear', 50, [0, 100])).toBe(0.5);
        expect(valueToT('linear', 150, [0, 100])).toBe(1);
        expect(valueToT('linear', -5, [0, 100])).toBe(0);
        expect(valueToT('linear', null, [0, 100])).toBeNull();
    });

    it('maps log values and rejects non-positive ones', () => {
        expect(valueToT('log', 100, [1, 10000])).toBeCloseTo(0.5);
        expect(valueToT('log', 0, [1, 10000])).toBeNull();
        expect(tToValue('log', 0.5, [1, 10000])).toBeCloseTo(100);
    });

    it('round-trips through x for normal and reversed axes', () => {
        const g = computeGeometry(1000, 3, false);
        for (const reversed of [false, true]) {
            const x = xFromT(0.25, reversed, g);
            expect(tFromX(x, reversed, g)).toBeCloseTo(0.25);
        }
        expect(xFromT(0, true, g)).toBe(g.trackRight);
    });
});

describe('domainFromValues and ticks', () => {
    it('snaps log domains to powers of ten', () => {
        expect(domainFromValues('log', [3_000, 250_000, 90_000_000])).toEqual([1_000, 100_000_000]);
    });

    it('trims linear domains to P1-P99', () => {
        const values = Array.from({ length: 200 }, (_, i) => i);
        values.push(1e6);
        const [lo, hi] = domainFromValues('linear', values);
        expect(lo).toBeLessThanOrEqual(2);
        expect(hi).toBeLessThan(1e6);
    });

    it('fixes score ticks and uses powers of ten on log axes', () => {
        expect(trackTicks('linear', [0, 100], true)).toEqual([0, 25, 50, 75, 100]);
        expect(trackTicks('log', [1_000, 1_000_000], false)).toEqual([1_000, 10_000, 100_000, 1_000_000]);
    });
});
