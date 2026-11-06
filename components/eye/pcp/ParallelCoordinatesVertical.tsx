'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AxisRow from '@/components/eye/pcp/AxisRow';
import { useElementSize } from '@/hooks/useElementSize';
import { countMatches } from '@/lib/eye/brush';
import { formatValue } from '@/lib/eye/format';
import { categoricalPositions, layoutCategoricalAxis, type CatBand } from '@/lib/eye/pcp/categorical-layout';
import { EYE_THEME, groupColorMap, hexToRgb, lineAlpha, NO_GROUP_COLOR, rampRgb, rgba } from '@/lib/eye/pcp/color-scale';
import { computeGeometry, valueToT, xFromT, yOf } from '@/lib/eye/pcp/geometry';
import { nearestPolyline } from '@/lib/eye/pcp/hit-test';
import type { BrushRange, BrushState, CellValue, PcpAxis, PcpTable } from '@/lib/eye/types';

interface Props {
    axes: PcpAxis[];
    table: PcpTable;
    matched: Uint8Array;
    brushes: BrushState;
    reversed: Record<string, boolean>;
    colorAxis: PcpAxis | null; // null = colour by group
    pupil?: string;
    hoverId?: string;
    onlyMatched: boolean;
    onRangesChange: (axisId: string, ranges: BrushRange[]) => void;
    onToggleReverse: (axisId: string) => void;
    onMoveAxis: (axisId: string, toIndex: number) => void;
    onPupilChange: (id: string | undefined) => void;
    onHoverChange: (id: string | undefined) => void;
}

type Rgb = [number, number, number];

function strokeRow(ctx: CanvasRenderingContext2D, xs: Float32Array, row: number, n: number, ys: number[], naX: number | null) {
    const base = row * n;
    let missing = false;
    for (let a = 0; a < n; a++) if (Number.isNaN(xs[base + a])) missing = true;

    if (!missing) {
        ctx.beginPath();
        ctx.moveTo(xs[base], ys[0]);
        for (let a = 1; a < n; a++) ctx.lineTo(xs[base + a], ys[a]);
        ctx.stroke();
        return;
    }
    // Segments touching a missing value run through the missing lane and are dashed.
    for (let a = 0; a < n - 1; a++) {
        const m1 = Number.isNaN(xs[base + a]);
        const m2 = Number.isNaN(xs[base + a + 1]);
        if ((m1 || m2) && naX === null) continue;
        ctx.setLineDash(m1 || m2 ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(m1 ? naX! : xs[base + a], ys[a]);
        ctx.lineTo(m2 ? naX! : xs[base + a + 1], ys[a + 1]);
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function prepareCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    return ctx;
}

export default function ParallelCoordinatesVertical({
    axes, table, matched, brushes, reversed, colorAxis, pupil, hoverId, onlyMatched,
    onRangesChange, onToggleReverse, onMoveAxis, onPupilChange, onHoverChange,
}: Props) {
    const [sizeRef, size] = useElementSize<HTMLDivElement>();
    const stageRef = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const pointerType = useRef('mouse');
    const frame = useRef(0);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

    const rowCount = table.ids.length;
    const n = axes.length;
    const anyMissing = axes.some((a) => a.hasMissing);
    const g = useMemo(() => computeGeometry(size.width, n, anyMissing), [size.width, n, anyMissing]);
    const ys = useMemo(() => axes.map((_, i) => yOf(i, g)), [axes, g]);
    const rowIndex = useMemo(() => new Map(table.ids.map((id, i) => [id, i])), [table.ids]);
    const matchedCount = countMatches(matched);

    // x of every row on every axis. Recomputed on axis order, width and reversal only; brushing never touches it.
    const { xs, bands } = useMemo(() => {
        const out = new Float32Array(rowCount * n).fill(NaN);
        const bandMap = new Map<string, CatBand[]>();
        const tCache = axes.map((a): (number | null)[] | null =>
            a.kind === 'categorical' ? null : (table.columns[a.id] ?? []).map((v) => valueToT(a.kind as 'linear' | 'log', typeof v === 'number' ? v : null, a.domain)),
        );
        axes.forEach((axis, a) => {
            const column: CellValue[] = table.columns[axis.id] ?? [];
            if (axis.kind === 'categorical') {
                const keys = column.map((v) => (typeof v === 'string' ? v : null));
                const layout = layoutCategoricalAxis(keys, g.trackLeft, g.trackWidth);
                bandMap.set(axis.id, layout);
                const secondary = tCache[a + 1] ?? keys.map(() => null);
                categoricalPositions(keys, layout, secondary).forEach((x, r) => { if (x !== null) out[r * n + a] = x; });
            } else {
                const ts = tCache[a]!;
                for (let r = 0; r < rowCount; r++) {
                    const t = ts[r];
                    if (t !== null && t !== undefined) out[r * n + a] = xFromT(t, !!reversed[axis.id], g);
                }
            }
        });
        return { xs: out, bands: bandMap };
    }, [axes, table.columns, rowCount, n, g, reversed]);

    // Line colour: group palette or the sequential ramp on the chosen axis.
    const { rowRgb, drawOrder } = useMemo(() => {
        const groups = groupColorMap(table.group);
        const fallback = hexToRgb(NO_GROUP_COLOR);
        const keys: number[] = new Array(rowCount).fill(-1);
        let rgb: Rgb[];
        if (colorAxis && colorAxis.kind !== 'categorical') {
            const col = table.columns[colorAxis.id] ?? [];
            rgb = col.map((v, i) => {
                const t = valueToT(colorAxis.kind as 'linear' | 'log', typeof v === 'number' ? v : null, colorAxis.domain);
                keys[i] = t ?? -1;
                return t === null ? fallback : rampRgb(t);
            });
        } else {
            rgb = table.group.map((grp) => (grp !== null && groups.get(grp) ? hexToRgb(groups.get(grp)!) : fallback));
        }
        // Higher colour value on top, so strong rows stay visible in a dense plot.
        const order = Array.from({ length: rowCount }, (_, i) => i).sort((a, b) => keys[a] - keys[b]);
        return { rowRgb: rgb, drawOrder: order };
    }, [colorAxis, table.columns, table.group, rowCount]);

    useEffect(() => {
        const canvas = baseRef.current;
        if (!canvas || !size.width || n < 2) return;
        const ctx = prepareCanvas(canvas, g.W, g.H);
        const allMatch = matchedCount === rowCount;

        if (!onlyMatched && !allMatch) {
            ctx.strokeStyle = rgba(hexToRgb(EYE_THEME.lineDim), 0.07);
            ctx.lineWidth = 1;
            for (let r = 0; r < rowCount; r++) if (!matched[r]) strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
        }
        const alpha = lineAlpha(matchedCount);
        ctx.lineWidth = 1;
        for (const r of drawOrder) {
            if (!matched[r]) continue;
            ctx.strokeStyle = rgba(rowRgb[r], alpha);
            strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
        }
    }, [xs, ys, g, n, size.width, rowCount, matched, matchedCount, onlyMatched, drawOrder, rowRgb]);

    useEffect(() => {
        const canvas = overlayRef.current;
        if (!canvas || !size.width || n < 2) return;
        const ctx = prepareCanvas(canvas, g.W, g.H);
        const drawLine = (id: string | undefined, width: number, color: string, halo: boolean) => {
            const r = id === undefined ? undefined : rowIndex.get(id);
            if (r === undefined) return;
            if (halo) {
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = width + 3;
                strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
            if (halo) {
                ctx.fillStyle = rgba(rowRgb[r], 1);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                for (let a = 0; a < n; a++) {
                    const x = xs[r * n + a];
                    if (Number.isNaN(x)) continue;
                    ctx.beginPath();
                    ctx.arc(x, ys[a], 4.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        };
        if (hoverId !== pupil) drawLine(hoverId, 2.5, '#fafafa', false);
        drawLine(pupil, 3, '#ffffff', true);
    }, [xs, ys, g, n, size.width, hoverId, pupil, rowIndex, rowRgb]);

    useEffect(() => () => cancelAnimationFrame(frame.current), []);

    const hit = useCallback((px: number, py: number, threshold: number) =>
        nearestPolyline(xs, rowCount, n, ys, px, py, threshold, (r) => !matched[r]), [xs, rowCount, n, ys, matched]);

    const localPoint = (e: React.PointerEvent | React.MouseEvent) => {
        const rect = stageRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const isInteractive = (e: React.SyntheticEvent) => !!(e.target as Element).closest('[data-eye-interactive]');

    const onPointerMove = (e: React.PointerEvent) => {
        pointerType.current = e.pointerType;
        if (e.pointerType !== 'mouse') return;
        if (isInteractive(e)) {
            if (hoverId !== undefined) onHoverChange(undefined);
            return;
        }
        const { x, y } = localPoint(e);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
            const r = hit(x, y, 6);
            onHoverChange(r === null ? undefined : table.ids[r]);
            setCursor({ x, y });
        });
    };

    const onClick = (e: React.MouseEvent) => {
        if (isInteractive(e)) return;
        const { x, y } = localPoint(e);
        const r = hit(x, y, pointerType.current === 'mouse' ? 6 : 12);
        if (r === null) return;
        const id = table.ids[r];
        onPupilChange(id === pupil ? undefined : id);
    };

    const tipRow = hoverId !== undefined ? rowIndex.get(hoverId) : undefined;
    const summary = `Parallel coordinates, ${n} axes, ${matchedCount} of ${rowCount} rows match`;

    return (
        <div ref={sizeRef} className="w-full overflow-x-auto">
            {size.width > 0 && (
                <div
                    ref={stageRef}
                    className="relative"
                    style={{ width: g.W, height: g.H, ['--eye-brush' as string]: EYE_THEME.brush, cursor: hoverId ? 'pointer' : undefined }}
                    onPointerMove={onPointerMove}
                    onPointerLeave={() => onHoverChange(undefined)}
                    onClick={onClick}
                >
                    <canvas ref={baseRef} role="img" aria-label={summary} className="pointer-events-none absolute left-0 top-0" style={{ width: g.W, height: g.H }} />
                    <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute left-0 top-0" style={{ width: g.W, height: g.H }} />

                    {axes.map((axis, i) => (
                        <AxisRow
                            key={axis.id}
                            axis={axis}
                            index={i}
                            axisCount={n}
                            y={ys[i]}
                            g={g}
                            column={table.columns[axis.id] ?? []}
                            matched={matched}
                            ranges={brushes[axis.id] ?? []}
                            reversed={!!reversed[axis.id]}
                            bands={bands.get(axis.id) ?? null}
                            onRangesChange={onRangesChange}
                            onToggleReverse={onToggleReverse}
                            onMoveAxis={onMoveAxis}
                        />
                    ))}

                    {tipRow !== undefined && cursor && (
                        <div
                            className="pointer-events-none absolute z-20 w-[230px] rounded-lg border border-line-strong bg-card/95 p-2.5 text-[12px] shadow-xl"
                            style={{ left: Math.min(cursor.x + 14, Math.max(0, g.W - 240)), top: cursor.y + 14 }}
                        >
                            <p className="truncate font-semibold text-foreground">{table.labels[tipRow]}</p>
                            {table.group[tipRow] && <p className="truncate text-faint">{table.group[tipRow]}</p>}
                            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                                {axes.filter((a) => a.kind !== 'categorical').map((a) => {
                                    const v = table.columns[a.id]?.[tipRow];
                                    const raw = table.raw[a.id]?.[tipRow];
                                    return (
                                        <React.Fragment key={a.id}>
                                            <dt className="truncate text-faint">{a.labelEn}</dt>
                                            <dd className="num text-right text-foreground">
                                                {formatValue(a.format, typeof v === 'number' ? v : null)}
                                                {a.isScore && typeof raw === 'number' && <span className="text-faint"> ({formatValue(a.rawFormat ?? 'num', raw)})</span>}
                                            </dd>
                                        </React.Fragment>
                                    );
                                })}
                            </dl>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
