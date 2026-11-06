import type { BrushRange, BrushState } from '@/lib/eye/types';

// Keys can hold anything a data vendor sends, so escape every character the format uses.
const esc = (s: string) => encodeURIComponent(s).replace(/[()~!*'|,;:]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const num = (n: number) => String(Number(n.toPrecision(6)));

// brush=axis:lo~hi,lo~hi;axis:in(a|b),na  (the caller URL-encodes the whole value)
export function encodeBrush(brushes: BrushState): string {
    return Object.entries(brushes)
        .filter(([, ranges]) => ranges.length > 0)
        .map(([axisId, ranges]) => {
            const parts = ranges.map((r) => {
                if (r.kind === 'range') return `${num(r.lo)}~${num(r.hi)}`;
                if (r.kind === 'set') return `in(${r.keys.map(esc).join('|')})`;
                return 'na';
            });
            return `${esc(axisId)}:${parts.join(',')}`;
        })
        .join(';');
}

function decodePart(part: string): BrushRange | null {
    if (part === 'na') return { kind: 'missing' };
    const set = part.match(/^in\((.*)\)$/);
    if (set) {
        const keys = set[1].split('|').filter(Boolean).map(decodeURIComponent);
        return keys.length ? { kind: 'set', keys } : null;
    }
    const range = part.match(/^(-?[\d.e+-]+)~(-?[\d.e+-]+)$/i);
    if (!range) return null;
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi ? { kind: 'range', lo, hi } : null;
}

// Anything unknown or malformed is dropped: the string comes from the address bar.
export function decodeBrush(value: string | null | undefined, validAxes: ReadonlySet<string>): BrushState {
    const out: BrushState = {};
    if (!value) return out;
    for (const segment of value.split(';')) {
        const colon = segment.indexOf(':');
        if (colon < 1) continue;
        let axisId: string;
        try {
            axisId = decodeURIComponent(segment.slice(0, colon));
        } catch {
            continue;
        }
        if (!validAxes.has(axisId)) continue;
        const ranges: BrushRange[] = [];
        // Commas inside keys are percent-encoded, so a plain split is safe.
        for (const part of segment.slice(colon + 1).split(',')) {
            try {
                const r = decodePart(part);
                if (r) ranges.push(r);
            } catch { /* malformed escape */ }
        }
        if (ranges.length) out[axisId] = ranges;
    }
    return out;
}

export function decodeAxes(value: string | null | undefined, validAxes: ReadonlySet<string>): string[] {
    if (!value) return [];
    const seen = new Set<string>();
    for (const id of value.split(',')) if (validAxes.has(id)) seen.add(id);
    return [...seen];
}
