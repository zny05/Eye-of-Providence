import type { BrushRange, BrushState, CellValue, PcpAxis } from '@/lib/eye/types';
import { formatValue } from '@/lib/eye/format';

const hasMissing = (ranges: BrushRange[]) => ranges.some((r) => r.kind === 'missing');

function cellMatches(value: CellValue, ranges: BrushRange[]): boolean {
    if (value === null) return hasMissing(ranges);
    for (const r of ranges) {
        if (r.kind === 'range' && typeof value === 'number' && value >= r.lo && value <= r.hi) return true;
        if (r.kind === 'set' && typeof value === 'string' && r.keys.includes(value)) return true;
    }
    return false;
}

// 1 = row matches. No brushes at all means every row matches.
export function applyBrushes(columns: Record<string, CellValue[]>, rowCount: number, brushes: BrushState): Uint8Array {
    const out = new Uint8Array(rowCount).fill(1);
    for (const [axisId, ranges] of Object.entries(brushes)) {
        const column = columns[axisId];
        if (!column || ranges.length === 0) continue;
        for (let i = 0; i < rowCount; i++) {
            if (out[i] && !cellMatches(column[i], ranges)) out[i] = 0;
        }
    }
    return out;
}

export function countMatches(mask: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    return n;
}

// Order-insensitive: overlapping or touching ranges on one axis collapse into one.
export function mergeRanges(ranges: BrushRange[]): BrushRange[] {
    const numeric = ranges.filter((r): r is Extract<BrushRange, { kind: 'range' }> => r.kind === 'range').sort((a, b) => a.lo - b.lo);
    const merged: Extract<BrushRange, { kind: 'range' }>[] = [];
    for (const r of numeric) {
        const last = merged[merged.length - 1];
        if (last && r.lo <= last.hi) last.hi = Math.max(last.hi, r.hi);
        else merged.push({ ...r });
    }
    const keys = [...new Set(ranges.flatMap((r) => (r.kind === 'set' ? r.keys : [])))];
    return [
        ...merged,
        ...(keys.length ? [{ kind: 'set' as const, keys }] : []),
        ...(hasMissing(ranges) ? [{ kind: 'missing' as const }] : []),
    ];
}

// Click on a node (or a merged "Other" node = several keys). Additive keeps the rest of the selection.
export function toggleKeys(ranges: BrushRange[], keys: string[], additive: boolean): BrushRange[] {
    const current = ranges.find((r): r is Extract<BrushRange, { kind: 'set' }> => r.kind === 'set')?.keys ?? [];
    const allOn = keys.every((k) => current.includes(k));
    const nextKeys = additive
        ? allOn ? current.filter((k) => !keys.includes(k)) : [...new Set([...current, ...keys])]
        : allOn && current.length === keys.length ? [] : keys;
    const rest = ranges.filter((r) => r.kind !== 'set');
    return nextKeys.length ? [...rest, { kind: 'set', keys: nextKeys }] : rest;
}

export function toggleMissing(ranges: BrushRange[]): BrushRange[] {
    return hasMissing(ranges) ? ranges.filter((r) => r.kind !== 'missing') : [...ranges, { kind: 'missing' }];
}

// Chip text per plan §10.6.
export function chipText(axis: Pick<PcpAxis, 'labelEn' | 'format' | 'kind' | 'domain'>, range: BrushRange): string {
    if (range.kind === 'missing') return `${axis.labelEn} missing`;
    if (range.kind === 'set') return `${axis.labelEn} ∈ {${range.keys.join(', ')}}`;
    const f = (n: number) => formatValue(axis.format, n);
    const [d0, d1] = axis.domain;
    if (range.lo <= d0) return `${axis.labelEn} ≤ ${f(range.hi)}`;
    if (range.hi >= d1) return `${axis.labelEn} ≥ ${f(range.lo)}`;
    return `${f(range.lo)} ≤ ${axis.labelEn} ≤ ${f(range.hi)}`;
}
