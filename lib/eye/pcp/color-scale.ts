// One colour per selected instrument (at most 12): Okabe-Ito first, then extra hues that stay legible on a dark card.
export const SELECTED_PALETTE = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#D55E00', '#CC79A7',
    '#4E79A7', '#76B7B2', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
];

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
