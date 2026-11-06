export interface CatBand {
    key: string;
    label: string;
    count: number;
    x0: number;
    x1: number;
    merged?: string[]; // original keys folded into "Other"
}

export const OTHER_KEY = '__other__';

interface Options {
    maxCategories?: number;
    minWidth?: number;
    gap?: number;
}

// Nodes on a categorical track: width proportional to row count, biggest first.
export function layoutCategoricalAxis(
    keys: (string | null)[],
    trackLeft: number,
    trackWidth: number,
    opts: Options = {},
): CatBand[] {
    const { maxCategories = 12, minWidth = 28, gap = 6 } = opts;
    const counts = new Map<string, number>();
    for (const k of keys) if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (sorted.length === 0) return [];

    let entries: { key: string; label: string; count: number; merged?: string[] }[] = sorted.map(([key, count]) => ({ key, label: key, count }));
    if (entries.length > maxCategories) {
        const head = entries.slice(0, maxCategories - 1);
        const tail = entries.slice(maxCategories - 1);
        entries = [...head, { key: OTHER_KEY, label: 'Other', count: tail.reduce((s, e) => s + e.count, 0), merged: tail.map((e) => e.key) }];
    }

    const total = entries.reduce((s, e) => s + e.count, 0);
    const avail = Math.max(0, trackWidth - gap * (entries.length - 1));
    let widths = entries.map((e) => Math.max(minWidth, (avail * e.count) / total));
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > avail) {
        // Shrink only the bands above the minimum; if even the minimums do not fit, shrink everything.
        const fixed = widths.filter((w) => w <= minWidth).length * minWidth;
        const flexible = sum - fixed;
        widths = avail > fixed && flexible > 0
            ? widths.map((w) => (w <= minWidth ? w : (w * (avail - fixed)) / flexible))
            : widths.map((w) => (w * avail) / sum);
    }

    let x = trackLeft;
    return entries.map((e, i) => {
        const band: CatBand = { ...e, x0: x, x1: x + widths[i] };
        x += widths[i] + gap;
        return band;
    });
}

export function bandKeyOf(key: string, bands: CatBand[]): string {
    for (const b of bands) {
        if (b.key === key || b.merged?.includes(key)) return b.key;
    }
    return key;
}

// x per row: rows inside a node are spread in order of the next axis' value, which reduces crossings.
export function categoricalPositions(keys: (string | null)[], bands: CatBand[], secondary: (number | null)[]): (number | null)[] {
    const byBand = new Map<string, number[]>();
    keys.forEach((k, i) => {
        if (k === null) return;
        const b = bandKeyOf(k, bands);
        const list = byBand.get(b);
        if (list) list.push(i);
        else byBand.set(b, [i]);
    });

    const out: (number | null)[] = keys.map(() => null);
    for (const band of bands) {
        const rows = byBand.get(band.key);
        if (!rows) continue;
        rows.sort((a, b) => {
            const sa = secondary[a];
            const sb = secondary[b];
            if (sa === null && sb === null) return a - b;
            if (sa === null) return 1;
            if (sb === null) return -1;
            return sa - sb || a - b;
        });
        rows.forEach((row, rank) => {
            out[row] = band.x0 + ((rank + 0.5) / rows.length) * (band.x1 - band.x0);
        });
    }
    return out;
}
