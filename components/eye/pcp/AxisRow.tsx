'use client';

import React, { memo, useCallback, useMemo, useRef } from 'react';
import { AlertTriangle, ArrowLeftRight, GripVertical } from 'lucide-react';
import { mergeRanges, toggleKeys, toggleMissing } from '@/lib/eye/brush';
import { formatTick, formatValue } from '@/lib/eye/format';
import type { CatBand } from '@/lib/eye/pcp/categorical-layout';
import { EYE_THEME } from '@/lib/eye/pcp/color-scale';
import { type PcpGeometry, tToValue, trackTicks, valueToT } from '@/lib/eye/pcp/geometry';
import type { BrushRange, CellValue, PcpAxis } from '@/lib/eye/types';
import { cn } from '@/lib/utils';

type NumericRange = Extract<BrushRange, { kind: 'range' }>;

const ROW_HALF = 40; // the row container spans 80px around the track centre
const BINS = 24;

interface AxisRowProps {
    axis: PcpAxis;
    index: number;
    axisCount: number;
    y: number;
    g: PcpGeometry;
    column: CellValue[];
    matched: Uint8Array;
    ranges: BrushRange[];
    reversed: boolean;
    bands: CatBand[] | null;
    onRangesChange: (axisId: string, ranges: BrushRange[]) => void;
    onToggleReverse: (axisId: string) => void;
    onMoveAxis: (axisId: string, toIndex: number) => void;
}

type Drag = {
    others: BrushRange[];
    anchorT: number | null; // value-space t of the fixed end; null while moving a whole range
    moveFrom?: { t: number; lo: number; hi: number };
};

const sublabel = (axis: PcpAxis) => (axis.kind === 'categorical' ? 'Click to select' : axis.kind === 'log' ? 'Log scale · drag to select' : 'Drag to select');

function AxisRow({ axis, index, axisCount, y, g, column, matched, ranges, reversed, bands, onRangesChange, onToggleReverse, onMoveAxis }: AxisRowProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const numeric = axis.kind !== 'categorical';
    const kind = axis.kind === 'log' ? 'log' : 'linear';
    const center = ROW_HALF;
    const top = y - ROW_HALF;
    const trackTop = center - g.bandHeight / 2;
    const left = g.labelPlacement === 'left';

    const toX = useCallback((value: number) => {
        const t = valueToT(kind, value, axis.domain);
        if (t === null) return 0;
        return (reversed ? 1 - t : t) * g.trackWidth;
    }, [axis.domain, g.trackWidth, kind, reversed]);

    // Pointer position -> value-space t in [0, 1] (undoes axis reversal).
    const tAt = (clientX: number) => {
        const rect = trackRef.current!.getBoundingClientRect();
        const visual = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return reversed ? 1 - visual : visual;
    };

    const rangeFromTs = (a: number, b: number): NumericRange => ({
        kind: 'range',
        lo: tToValue(kind, Math.min(a, b), axis.domain),
        hi: tToValue(kind, Math.max(a, b), axis.domain),
    });

    const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        const part = target.dataset.part;
        const idx = Number(target.dataset.rangeIndex);
        const t = tAt(e.clientX);
        const edited = part ? (ranges[idx] as NumericRange | undefined) : undefined;
        const base = ranges.filter((_, i) => i !== idx || !part);

        if (part === 'lo' && edited) dragRef.current = { others: base, anchorT: valueToT(kind, edited.hi, axis.domain) };
        else if (part === 'hi' && edited) dragRef.current = { others: base, anchorT: valueToT(kind, edited.lo, axis.domain) };
        else if (part === 'band' && edited) dragRef.current = { others: base, anchorT: null, moveFrom: { t, lo: edited.lo, hi: edited.hi } };
        else dragRef.current = { others: e.shiftKey ? ranges : ranges.filter((r) => r.kind === 'missing'), anchorT: t };

        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    };

    const onTrackMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const t = tAt(e.clientX);
        let next: NumericRange | null = null;
        if (drag.moveFrom) {
            const t0 = valueToT(kind, drag.moveFrom.lo, axis.domain) ?? 0;
            const t1 = valueToT(kind, drag.moveFrom.hi, axis.domain) ?? 1;
            const dt = Math.min(1 - t1, Math.max(-t0, t - drag.moveFrom.t));
            next = rangeFromTs(t0 + dt, t1 + dt);
        } else if (drag.anchorT !== null) {
            // A drag shorter than 3px is a click, not a brush.
            if (Math.abs(t - drag.anchorT) * g.trackWidth < 3) return;
            next = rangeFromTs(drag.anchorT, t);
        }
        if (next) onRangesChange(axis.id, [...drag.others, next]);
    };

    const onTrackUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onRangesChange(axis.id, mergeRanges(ranges));
    };

    const nudge = (e: React.KeyboardEvent<HTMLDivElement>, idx: number, edge: 'lo' | 'hi') => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const r = ranges[idx] as NumericRange;
        const step = (e.shiftKey ? 0.1 : 0.01) * dir * (reversed ? -1 : 1);
        const cur = valueToT(kind, edge === 'lo' ? r.lo : r.hi, axis.domain) ?? 0;
        const moved = tToValue(kind, Math.min(1, Math.max(0, cur + step)), axis.domain);
        const nextRange: NumericRange = edge === 'lo' ? { ...r, lo: Math.min(moved, r.hi) } : { ...r, hi: Math.max(moved, r.lo) };
        onRangesChange(axis.id, mergeRanges(ranges.map((x, i) => (i === idx ? nextRange : x))));
    };

    // Row reorder: drag the grip vertically (centre of the pointer picks the slot) or Alt+Up/Down.
    const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onGripMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const parent = rowRef.current?.parentElement;
        if (!parent) return;
        const offset = e.clientY - parent.getBoundingClientRect().top;
        const slot = Math.min(axisCount - 1, Math.max(0, Math.round((offset - g.padTop) / g.rowGap)));
        if (slot !== index) onMoveAxis(axis.id, slot);
    };
    const onGripKey = (e: React.KeyboardEvent) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const to = Math.min(axisCount - 1, Math.max(0, index + (e.key === 'ArrowUp' ? -1 : 1)));
        if (to !== index) onMoveAxis(axis.id, to);
    };

    const ticks = useMemo(() => (numeric ? trackTicks(kind, axis.domain, axis.isScore) : []), [numeric, kind, axis.domain, axis.isScore]);

    // Marginal distribution: grey = everyone, amber = matches (plan §10.4).
    const histogram = useMemo(() => {
        if (!numeric) return null;
        const all = new Array<number>(BINS).fill(0);
        const hit = new Array<number>(BINS).fill(0);
        column.forEach((v, i) => {
            if (typeof v !== 'number') return;
            const t = valueToT(kind, v, axis.domain);
            if (t === null) return;
            const b = Math.min(BINS - 1, Math.floor((reversed ? 1 - t : t) * BINS));
            all[b]++;
            if (matched[i]) hit[b]++;
        });
        return { all, hit, max: Math.max(1, ...all) };
    }, [numeric, column, matched, kind, axis.domain, reversed]);

    const setKeys = (band: CatBand, additive: boolean) => onRangesChange(axis.id, toggleKeys(ranges, band.merged ?? [band.key], additive));
    const selectedKeys = ranges.find((r): r is Extract<BrushRange, { kind: 'set' }> => r.kind === 'set')?.keys ?? [];
    const missingOn = ranges.some((r) => r.kind === 'missing');
    const brushSummary = ranges.length === 0 ? 'no brush' : `${ranges.length} active ${ranges.length === 1 ? 'selection' : 'selections'}`;
    const lowCoverage = axis.coverage < 0.5;

    return (
        <div
            ref={rowRef}
            role="group"
            aria-label={`${axis.labelEn} axis, ${brushSummary}`}
            className="pointer-events-none absolute left-0"
            style={{ top, width: g.W, height: ROW_HALF * 2 }}
        >
            {/* label */}
            <div
                className="pointer-events-auto absolute flex items-center gap-1.5"
                style={left ? { left: 0, width: g.labelWidth, top: center - 22 } : { left: 0, width: g.W - g.padRight, top: center - 46 }}
            >
                <button
                    type="button"
                    className="grid size-6 flex-none cursor-grab touch-none place-items-center rounded-md text-faint hover:bg-white/5 hover:text-foreground active:cursor-grabbing"
                    aria-label={`Reorder ${axis.labelEn}; drag vertically or press Alt+Up or Alt+Down`}
                    onPointerDown={onGripDown}
                    onPointerMove={onGripMove}
                    onKeyDown={onGripKey}
                    data-eye-interactive
                >
                    <GripVertical className="size-4" />
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-foreground" title={`${axis.labelEn} · ${axis.labelZh}`}>{axis.labelEn}</span>
                        {axis.approx && <span className="rounded bg-white/10 px-1 text-[10px] text-muted-foreground" title={axis.approx}>≈</span>}
                        {!axis.verified && <span className="rounded bg-white/10 px-1 text-[10px] text-faint" title="Source field name not yet verified (plan §5.3)">unverified</span>}
                        {lowCoverage && <AlertTriangle className="size-3.5 flex-none text-warn" aria-label={`Only ${Math.round(axis.coverage * 100)}% coverage`} />}
                        {!left && <span className="truncate text-[11px] text-faint">{sublabel(axis)}</span>}
                    </div>
                    {left && (
                        <div className="flex items-center gap-1.5 text-[11px] text-faint">
                            <span className="truncate">{axis.labelZh}</span>
                            <span className="truncate opacity-70">· {sublabel(axis)}</span>
                        </div>
                    )}
                </div>
                {numeric && (
                    <button
                        type="button"
                        className={cn('grid size-6 flex-none place-items-center rounded-md hover:bg-white/5', reversed ? 'text-brand-ink' : 'text-faint hover:text-foreground')}
                        title={reversed ? 'Axis reversed: low on the right' : 'Reverse axis'}
                        aria-pressed={reversed}
                        aria-label={`Reverse ${axis.labelEn} axis`}
                        onClick={() => onToggleReverse(axis.id)}
                        data-eye-interactive
                    >
                        <ArrowLeftRight className="size-3.5" />
                    </button>
                )}
            </div>

            {/* missing-value lane */}
            {g.naLaneCenter !== null && axis.hasMissing && (
                <button
                    type="button"
                    className={cn('pointer-events-auto absolute rounded-sm', missingOn && 'ring-1 ring-[var(--eye-brush)]')}
                    style={{
                        left: g.naLaneCenter - 14,
                        width: 28,
                        top: trackTop,
                        height: g.bandHeight,
                        background: 'repeating-linear-gradient(-45deg, rgba(161,161,170,0.35) 0 2px, transparent 2px 5px)',
                    }}
                    title="Missing values"
                    aria-label={`Select rows with missing ${axis.labelEn}`}
                    aria-pressed={missingOn}
                    onClick={() => onRangesChange(axis.id, toggleMissing(ranges))}
                    data-eye-interactive
                />
            )}

            {numeric ? (
                <>
                    {/* marginal distribution */}
                    {histogram && (
                        <svg className="absolute" style={{ left: g.trackLeft, top: trackTop - 18, width: g.trackWidth, height: 14 }} aria-hidden>
                            {histogram.all.map((n, b) => {
                                const w = g.trackWidth / BINS;
                                const h = (n / histogram.max) * 14;
                                const hh = (histogram.hit[b] / histogram.max) * 14;
                                return (
                                    <g key={b}>
                                        <rect x={b * w + 0.5} y={14 - h} width={Math.max(1, w - 1)} height={h} fill="rgba(161,161,170,0.28)" />
                                        <rect x={b * w + 0.5} y={14 - hh} width={Math.max(1, w - 1)} height={hh} fill="rgba(245,158,11,0.75)" />
                                    </g>
                                );
                            })}
                        </svg>
                    )}

                    {/* track + brush */}
                    <div
                        ref={trackRef}
                        className="pointer-events-auto absolute touch-pan-y cursor-crosshair"
                        style={{ left: g.trackLeft, top: trackTop - 4, width: g.trackWidth, height: g.bandHeight + 8 }}
                        onPointerDown={onTrackDown}
                        onPointerMove={onTrackMove}
                        onPointerUp={onTrackUp}
                        onPointerCancel={onTrackUp}
                        onDoubleClick={() => onRangesChange(axis.id, [])}
                        data-eye-interactive
                    >
                        <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: EYE_THEME.track }} />
                        {ticks.map((tick) => (
                            <span key={tick} className="absolute top-1/2 h-1.5 w-px -translate-y-1/2" style={{ left: toX(tick), background: EYE_THEME.track }} />
                        ))}
                        {axis.isScore && <span className="absolute top-[3px] bottom-[3px] w-px border-l border-dashed" style={{ left: toX(50), borderColor: EYE_THEME.track }} />}
                        {ranges.map((r, i) => {
                            if (r.kind !== 'range') return null;
                            const x0 = toX(r.lo);
                            const x1 = toX(r.hi);
                            const l = Math.min(x0, x1);
                            const w = Math.max(2, Math.abs(x1 - x0));
                            const handle = (edge: 'lo' | 'hi', x: number) => (
                                <div
                                    key={edge}
                                    role="slider"
                                    tabIndex={0}
                                    aria-label={`${axis.labelEn} ${edge === 'lo' ? 'lower' : 'upper'} bound`}
                                    aria-valuemin={axis.domain[0]}
                                    aria-valuemax={axis.domain[1]}
                                    aria-valuenow={edge === 'lo' ? r.lo : r.hi}
                                    aria-valuetext={formatValue(axis.format, edge === 'lo' ? r.lo : r.hi)}
                                    data-part={edge}
                                    data-range-index={i}
                                    className="absolute top-0 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--eye-brush)]"
                                    style={{ left: x - g.handleHit / 2, width: g.handleHit, height: '100%' }}
                                    onKeyDown={(e) => nudge(e, i, edge)}
                                >
                                    <span className="pointer-events-none absolute inset-y-0.5 left-1/2 w-[3px] -translate-x-1/2 rounded-full" style={{ background: EYE_THEME.brush }} />
                                </div>
                            );
                            return (
                                <React.Fragment key={i}>
                                    <div
                                        data-part="band"
                                        data-range-index={i}
                                        className="absolute cursor-grab touch-none rounded-[3px] border"
                                        style={{ left: l, width: w, top: 4, height: g.bandHeight, background: 'rgba(245,158,11,0.3)', borderColor: EYE_THEME.brush }}
                                    />
                                    {handle('lo', x0 <= x1 ? x0 : x1)}
                                    {handle('hi', x0 <= x1 ? x1 : x0)}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {/* tick labels */}
                    {ticks.map((tick) => (
                        <span
                            key={tick}
                            className="num absolute -translate-x-1/2 text-[11px]"
                            style={{ left: g.trackLeft + toX(tick), top: trackTop + g.bandHeight + 6, color: EYE_THEME.trackText }}
                        >
                            {formatTick(axis.format, tick)}
                        </span>
                    ))}
                </>
            ) : (
                <>
                    <div className="absolute h-px" style={{ left: g.trackLeft, width: g.trackWidth, top: center, background: EYE_THEME.track }} />
                    {bands?.map((b) => {
                        const keys = b.merged ?? [b.key];
                        const on = keys.every((k) => selectedKeys.includes(k));
                        const wide = b.x1 - b.x0 >= 40;
                        return (
                            <div
                                key={b.key}
                                role="checkbox"
                                aria-checked={on}
                                aria-label={`${b.label}, ${b.count} rows`}
                                tabIndex={0}
                                title={`${b.label} · ${b.count}${b.merged ? ` (${b.merged.length} categories)` : ''}`}
                                className={cn(
                                    'pointer-events-auto absolute flex cursor-pointer items-center justify-center overflow-hidden rounded-[5px] border text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--eye-brush)]',
                                    on ? 'text-black' : 'text-foreground',
                                )}
                                style={{
                                    left: b.x0,
                                    width: Math.max(2, b.x1 - b.x0),
                                    top: center - 11,
                                    height: 22,
                                    background: on ? EYE_THEME.brush : 'rgba(245,158,11,0.16)',
                                    borderColor: on ? EYE_THEME.brush : 'rgba(245,158,11,0.5)',
                                }}
                                onClick={(e) => setKeys(b, e.shiftKey || e.ctrlKey || e.metaKey)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setKeys(b, e.shiftKey);
                                    }
                                }}
                                data-eye-interactive
                            >
                                {wide && <span className="truncate px-1">{b.label} <span className="num opacity-70">{b.count}</span></span>}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}

export default memo(AxisRow);
