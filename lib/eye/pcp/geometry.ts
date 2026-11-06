import type { AxisKind } from '@/lib/eye/types';

// Vertical-flow layout: every axis is a horizontal track, axes stack top to bottom, values grow left to right.
export interface PcpGeometry {
    W: number; // content width (>= container width when the minimum track width forces horizontal scroll)
    H: number;
    labelPlacement: 'left' | 'top';
    labelWidth: number;
    rowGap: number;
    bandHeight: number;
    handleHit: number;
    padTop: number;
    padBottom: number;
    padRight: number;
    trackLeft: number;
    trackRight: number;
    trackWidth: number;
    naLaneCenter: number | null; // null when no shown axis has missing values
}

export const PAD_TOP = 36;
export const PAD_BOTTOM = 40;
export const PAD_RIGHT = 28;
export const NA_LANE = 36;
export const LABEL_GAP = 12;
export const MIN_TRACK_WIDTH = 280;

export function computeGeometry(containerWidth: number, axisCount: number, anyMissing: boolean): PcpGeometry {
    const wide = containerWidth >= 1024;
    const medium = containerWidth >= 640;
    const labelPlacement = medium ? 'left' : 'top';
    const labelWidth = wide ? 200 : medium ? 160 : 0;
    const rowGap = wide ? 72 : medium ? 64 : 84;
    const bandHeight = medium ? 16 : 20;
    const handleHit = medium ? 16 : 24;

    const naLeft = labelWidth + LABEL_GAP;
    const trackLeft = naLeft + (anyMissing ? NA_LANE : 0);
    const trackWidth = Math.max(MIN_TRACK_WIDTH, containerWidth - PAD_RIGHT - trackLeft);
    const trackRight = trackLeft + trackWidth;
    const rows = Math.max(0, axisCount - 1);
    // Above-track labels (narrow screens) need an extra label row before the first track.
    const padTop = medium ? PAD_TOP : PAD_TOP + 22;

    return {
        W: trackRight + PAD_RIGHT,
        H: padTop + rows * rowGap + PAD_BOTTOM,
        labelPlacement,
        labelWidth,
        rowGap,
        bandHeight,
        handleHit,
        padTop,
        padBottom: PAD_BOTTOM,
        padRight: PAD_RIGHT,
        trackLeft,
        trackRight,
        trackWidth,
        naLaneCenter: anyMissing ? naLeft + NA_LANE / 2 - 4 : null,
    };
}

export function yOf(index: number, g: PcpGeometry): number {
    return g.padTop + index * g.rowGap;
}

// Position of a value along its track in [0, 1]; null = cannot be placed (missing, or <= 0 on a log axis).
export function valueToT(kind: Exclude<AxisKind, 'categorical'>, value: number | null, domain: [number, number]): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    let v = value;
    let [d0, d1] = domain;
    if (kind === 'log') {
        if (v <= 0 || d0 <= 0 || d1 <= 0) return null;
        v = Math.log10(v);
        d0 = Math.log10(d0);
        d1 = Math.log10(d1);
    }
    if (d1 === d0) return 0.5;
    return Math.min(1, Math.max(0, (v - d0) / (d1 - d0)));
}

export function tToValue(kind: Exclude<AxisKind, 'categorical'>, t: number, domain: [number, number]): number {
    const c = Math.min(1, Math.max(0, t));
    if (kind === 'log') {
        const l0 = Math.log10(domain[0]);
        const l1 = Math.log10(domain[1]);
        return 10 ** (l0 + c * (l1 - l0));
    }
    return domain[0] + c * (domain[1] - domain[0]);
}

export function xFromT(t: number, reversed: boolean, g: PcpGeometry): number {
    return g.trackLeft + (reversed ? 1 - t : t) * g.trackWidth;
}

export function tFromX(x: number, reversed: boolean, g: PcpGeometry): number {
    const t = Math.min(1, Math.max(0, (x - g.trackLeft) / g.trackWidth));
    return reversed ? 1 - t : t;
}

// Domain from data: score axes are fixed, raw axes use P1-P99, log axes snap to powers of ten.
export function domainFromValues(kind: Exclude<AxisKind, 'categorical'>, values: (number | null)[]): [number, number] {
    const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v) && (kind !== 'log' || v > 0)).sort((a, b) => a - b);
    if (sorted.length === 0) return kind === 'log' ? [1, 10] : [0, 1];
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
    let lo = at(0.01);
    let hi = at(0.99);
    if (kind === 'log') {
        lo = 10 ** Math.floor(Math.log10(lo));
        hi = 10 ** Math.ceil(Math.log10(hi));
        return lo === hi ? [lo, lo * 10] : [lo, hi];
    }
    if (lo === hi) return [lo - 1, hi + 1];
    return [lo, hi];
}

// Tick positions for a track: nice steps for linear, powers of ten for log.
export function trackTicks(kind: Exclude<AxisKind, 'categorical'>, domain: [number, number], isScore: boolean): number[] {
    if (isScore) return [0, 25, 50, 75, 100];
    const [d0, d1] = domain;
    if (kind === 'log') {
        const ticks: number[] = [];
        for (let e = Math.ceil(Math.log10(d0)); e <= Math.floor(Math.log10(d1)); e++) ticks.push(10 ** e);
        return ticks;
    }
    const span = d1 - d0;
    const rough = span / 5;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough;
    const ticks: number[] = [];
    for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
}
