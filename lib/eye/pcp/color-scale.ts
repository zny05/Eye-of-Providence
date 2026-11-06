// Okabe-Ito palette: distinguishable under common colour-vision deficiencies.
export const GROUP_PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];
export const RAMP_LO: [number, number, number] = [243, 230, 200];
export const RAMP_HI: [number, number, number] = [217, 119, 6];
export const NO_GROUP_COLOR = '#71717a';

export const EYE_THEME = {
    track: '#3f3f46',
    trackText: '#a1a1aa',
    lineDim: '#a1a1aa',
    brush: '#f59e0b',
    pos: '#2dd4bf',
    neg: '#e879f9',
} as const;

export const hexToRgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r},${g},${b},${a})`;

// Sequential ramp: light cream to deep orange, monotone in lightness.
export function rampRgb(t: number): [number, number, number] {
    const c = Math.min(1, Math.max(0, t));
    return [0, 1, 2].map((i) => Math.round(RAMP_LO[i] + (RAMP_HI[i] - RAMP_LO[i]) * c)) as [number, number, number];
}

export function groupColorMap(groups: (string | null)[]): Map<string, string> {
    const counts = new Map<string, number>();
    for (const g of groups) if (g !== null) counts.set(g, (counts.get(g) ?? 0) + 1);
    const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
    // Beyond the palette size colours repeat; the legend stays readable because only the top groups are listed.
    return new Map(ordered.map((g, i) => [g, GROUP_PALETTE[i % GROUP_PALETTE.length]]));
}

// Matched-line alpha: ~0.9 at 10 lines, ~0.25 at 100, floor 0.10.
export function lineAlpha(matched: number): number {
    if (matched <= 0) return 0.9;
    return Math.min(0.9, Math.max(0.1, 0.9 - 0.65 * (Math.log10(matched) - 1)));
}
