import { describe, expect, it } from 'vitest';
import { applyBrushes, chipText, countMatches, mergeRanges, toggleKeys, toggleMissing } from '@/lib/eye/brush';
import type { BrushState } from '@/lib/eye/types';

const columns = {
    growth: [90, 50, null, 70],
    sector: ['Tech', 'Fin', 'Tech', null],
};

describe('applyBrushes', () => {
    it('matches everything without brushes', () => {
        expect(Array.from(applyBrushes(columns, 4, {}))).toEqual([1, 1, 1, 1]);
    });

    it('treats range bounds as inclusive and skips missing values', () => {
        const brushes: BrushState = { growth: [{ kind: 'range', lo: 70, hi: 100 }] };
        expect(Array.from(applyBrushes(columns, 4, brushes))).toEqual([1, 0, 0, 1]);
    });

    it('ORs ranges on one axis and ANDs across axes', () => {
        const same: BrushState = { growth: [{ kind: 'range', lo: 85, hi: 100 }, { kind: 'range', lo: 45, hi: 55 }] };
        expect(Array.from(applyBrushes(columns, 4, same))).toEqual([1, 1, 0, 0]);
        const across: BrushState = { ...same, sector: [{ kind: 'set', keys: ['Tech'] }] };
        expect(Array.from(applyBrushes(columns, 4, across))).toEqual([1, 0, 0, 0]);
    });

    it('selects missing values only when asked', () => {
        const brushes: BrushState = { growth: [{ kind: 'missing' }] };
        expect(Array.from(applyBrushes(columns, 4, brushes))).toEqual([0, 0, 1, 0]);
        const both: BrushState = { sector: [{ kind: 'set', keys: ['Fin'] }, { kind: 'missing' }] };
        expect(Array.from(applyBrushes(columns, 4, both))).toEqual([0, 1, 0, 1]);
    });

    it('ignores brushes on unknown axes and empty range lists', () => {
        expect(countMatches(applyBrushes(columns, 4, { nope: [{ kind: 'missing' }], growth: [] }))).toBe(4);
    });

    it('works on a log-scale axis using raw values', () => {
        const cols = { mcap: [1e3, 1e6, 1e9] };
        expect(Array.from(applyBrushes(cols, 3, { mcap: [{ kind: 'range', lo: 1e5, hi: 1e7 }] }))).toEqual([0, 1, 0]);
    });
});

describe('range helpers', () => {
    it('merges overlapping ranges and keeps sets and missing', () => {
        const merged = mergeRanges([
            { kind: 'range', lo: 50, hi: 70 },
            { kind: 'range', lo: 10, hi: 30 },
            { kind: 'range', lo: 25, hi: 40 },
            { kind: 'missing' },
        ]);
        expect(merged).toEqual([{ kind: 'range', lo: 10, hi: 40 }, { kind: 'range', lo: 50, hi: 70 }, { kind: 'missing' }]);
    });

    it('toggles category keys with and without additive selection', () => {
        const a = toggleKeys([], ['Tech'], false);
        expect(a).toEqual([{ kind: 'set', keys: ['Tech'] }]);
        expect(toggleKeys(a, ['Fin'], true)).toEqual([{ kind: 'set', keys: ['Tech', 'Fin'] }]);
        expect(toggleKeys(a, ['Fin'], false)).toEqual([{ kind: 'set', keys: ['Fin'] }]);
        expect(toggleKeys(a, ['Tech'], false)).toEqual([]);
        expect(toggleKeys([], ['A', 'B'], true)).toEqual([{ kind: 'set', keys: ['A', 'B'] }]);
    });

    it('toggles the missing selection', () => {
        expect(toggleMissing([])).toEqual([{ kind: 'missing' }]);
        expect(toggleMissing([{ kind: 'missing' }])).toEqual([]);
    });
});

describe('chipText', () => {
    const axis = { labelEn: 'Growth', format: 'score' as const, kind: 'linear' as const, domain: [0, 100] as [number, number] };

    it('describes open-ended, bounded, set and missing selections', () => {
        expect(chipText(axis, { kind: 'range', lo: 70, hi: 100 })).toBe('Growth ≥ 70');
        expect(chipText(axis, { kind: 'range', lo: 0, hi: 40 })).toBe('Growth ≤ 40');
        expect(chipText(axis, { kind: 'range', lo: 70, hi: 90 })).toBe('70 ≤ Growth ≤ 90');
        expect(chipText(axis, { kind: 'set', keys: ['Tech', 'Fin'] })).toBe('Growth ∈ {Tech, Fin}');
        expect(chipText(axis, { kind: 'missing' })).toBe('Growth missing');
    });
});
