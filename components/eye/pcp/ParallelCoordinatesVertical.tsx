'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AxisRow from '@/components/eye/pcp/AxisRow';
import { useElementSize } from '@/hooks/useElementSize';
import { formatValue } from '@/lib/eye/format';
import { categoricalPositions, layoutCategoricalAxis, type CatBand } from '@/lib/eye/pcp/categorical-layout';
import { EYE_THEME, hexToRgb, rgba, SELECTED_PALETTE } from '@/lib/eye/pcp/color-scale';
import { computeGeometry, valueToT, xFromT, yOf } from '@/lib/eye/pcp/geometry';
import { nearestPolyline } from '@/lib/eye/pcp/hit-test';
import type { CellValue, PcpAxis, PcpTable } from '@/lib/eye/types';

interface Props {
    axes: PcpAxis[];
    catalog: PcpAxis[];
    table: PcpTable;
    reversed: Record<string, boolean>;
    hoverId?: string;
    canRemoveAxis: boolean;
    onToggleReverse: (axisId: string) => void;
    onMoveAxis: (axisId: string, toIndex: number) => void;
    onReplaceAxis: (oldId: string, newId: string) => void;
    onRemoveAxis: (axisId: string) => void;
    onHoverChange: (id: string | undefined) => void;
    onAddSymbol: (id: string) => void; // clicking a grey peer line selects it
    canAdd: boolean;
}

const PEER_ALPHA = 0.16;

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
        ctx.setLineDash(m1 || m2 ? [4, 4] : []);
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
    ctx.lineCap = 'round';
    return ctx;
}

export default function ParallelCoordinatesVertical({ axes, catalog, table, reversed, hoverId, canRemoveAxis, onToggleReverse, onMoveAxis, onReplaceAxis, onRemoveAxis, onHoverChange, onAddSymbol, canAdd }: Props) {
    const [sizeRef, size] = useElementSize<HTMLDivElement>();
    const stageRef = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const frame = useRef(0);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

    const rowCount = table.ids.length;
    const n = axes.length;
    const anyMissing = axes.some((a) => a.hasMissing);
    const g = useMemo(() => computeGeometry(size.width, n, anyMissing), [size.width, n, anyMissing]);
    const ys = useMemo(() => axes.map((_, i) => yOf(i, g)), [axes, g]);
    const rowIndex = useMemo(() => new Map(table.ids.map((id, i) => [id, i])), [table.ids]);
    const usedIds = useMemo(() => axes.map((a) => a.id), [axes]);

    // x of every row on every axis (NaN = no reading). Recomputed on axis order, width and reversal only.
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

    // Categories that hold a selected instrument, per categorical axis.
    const selectedKeys = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const axis of axes) {
            if (axis.kind !== 'categorical') continue;
            const keys = new Set<string>();
            (table.columns[axis.id] ?? []).forEach((v, r) => { if (typeof v === 'string' && table.selectedIndex[r] !== null) keys.add(v); });
            map.set(axis.id, [...keys]);
        }
        return map;
    }, [axes, table.columns, table.selectedIndex]);

    const rowRgb = useMemo(
        () => table.selectedIndex.map((s) => hexToRgb(s === null ? EYE_THEME.lineDim : SELECTED_PALETTE[s % SELECTED_PALETTE.length])),
        [table.selectedIndex],
    );

    useEffect(() => {
        const canvas = baseRef.current;
        if (!canvas || !size.width || n < 2) return;
        const ctx = prepareCanvas(canvas, g.W, g.H);

        // Peers first, as a quiet backdrop.
        ctx.strokeStyle = rgba(hexToRgb(EYE_THEME.lineDim), PEER_ALPHA);
        ctx.lineWidth = 1;
        for (let r = 0; r < rowCount; r++) if (table.selectedIndex[r] === null) strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);

        // Selected lines: dark halo, colour, then a dot on every track. The first selection is drawn last, on top.
        const selected = table.selectedIndex.map((s, r) => ({ s, r })).filter((e): e is { s: number; r: number } => e.s !== null).sort((a, b) => b.s - a.s);
        for (const { r } of selected) {
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 5;
            strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
            ctx.strokeStyle = rgba(rowRgb[r], 1);
            ctx.lineWidth = 3;
            strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
            ctx.fillStyle = rgba(rowRgb[r], 1);
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
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
    }, [xs, ys, g, n, size.width, rowCount, table.selectedIndex, rowRgb]);

    useEffect(() => {
        const canvas = overlayRef.current;
        if (!canvas || !size.width || n < 2) return;
        const ctx = prepareCanvas(canvas, g.W, g.H);
        const r = hoverId === undefined ? undefined : rowIndex.get(hoverId);
        if (r === undefined) return;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = table.selectedIndex[r] === null ? 4 : 6;
        strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = table.selectedIndex[r] === null ? 2 : 3;
        strokeRow(ctx, xs, r, n, ys, g.naLaneCenter);
    }, [xs, ys, g, n, size.width, hoverId, rowIndex, table.selectedIndex]);

    useEffect(() => () => cancelAnimationFrame(frame.current), []);

    const hit = useCallback((px: number, py: number, threshold: number) => nearestPolyline(xs, rowCount, n, ys, px, py, threshold), [xs, rowCount, n, ys]);
    const point = (e: React.PointerEvent | React.MouseEvent) => {
        const rect = stageRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const interactive = (e: React.SyntheticEvent) => !!(e.target as Element).closest('[data-eye-interactive]');
    const pointer = useRef('mouse');

    const onPointerMove = (e: React.PointerEvent) => {
        pointer.current = e.pointerType;
        if (e.pointerType !== 'mouse') return;
        if (interactive(e)) {
            if (hoverId !== undefined) onHoverChange(undefined);
            return;
        }
        const { x, y } = point(e);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
            const r = hit(x, y, 7);
            onHoverChange(r === null ? undefined : table.ids[r]);
            setCursor({ x, y });
        });
    };

    const onClick = (e: React.MouseEvent) => {
        if (interactive(e)) return;
        const { x, y } = point(e);
        const r = hit(x, y, pointer.current === 'mouse' ? 7 : 14);
        if (r !== null && table.selectedIndex[r] === null && canAdd) onAddSymbol(table.ids[r]);
    };

    const tipRow = hoverId !== undefined ? rowIndex.get(hoverId) : undefined;
    const tipSelected = tipRow !== undefined && table.selectedIndex[tipRow] !== null;
    const summary = `Parallel coordinates with ${n} axes: ${table.selectedIndex.filter((s) => s !== null).length} selected instruments and ${table.selectedIndex.filter((s) => s === null).length} background peers`;

    return (
        <div ref={sizeRef} className="w-full overflow-x-auto">
            {size.width > 0 && (
                <div
                    ref={stageRef}
                    className="relative"
                    style={{ width: g.W, height: g.H, cursor: hoverId && !tipSelected && canAdd ? 'copy' : undefined }}
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
                            reversed={!!reversed[axis.id]}
                            bands={bands.get(axis.id) ?? null}
                            selectedKeys={selectedKeys.get(axis.id) ?? []}
                            catalog={catalog}
                            usedIds={usedIds}
                            canRemove={canRemoveAxis}
                            onToggleReverse={onToggleReverse}
                            onMoveAxis={onMoveAxis}
                            onReplaceAxis={onReplaceAxis}
                            onRemoveAxis={onRemoveAxis}
                        />
                    ))}

                    {tipRow !== undefined && cursor && (
                        <div
                            className="pointer-events-none absolute z-20 w-[240px] rounded-lg border border-line-strong bg-card/95 p-2.5 text-[12px] shadow-xl"
                            style={{ left: Math.min(cursor.x + 14, Math.max(0, g.W - 250)), top: cursor.y + 14 }}
                        >
                            <p className="truncate font-semibold text-foreground">
                                <span className="mono mr-1.5">{table.ids[tipRow]}</span>{table.labels[tipRow] !== table.ids[tipRow] ? table.labels[tipRow] : ''}
                            </p>
                            <p className="truncate text-faint">{table.group[tipRow] ?? 'Industry unknown'}{!tipSelected && canAdd ? ' · click to add' : ''}</p>
                            <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                                {axes.map((a) => {
                                    const v = table.columns[a.id]?.[tipRow];
                                    const raw = table.raw[a.id]?.[tipRow];
                                    return (
                                        <React.Fragment key={a.id}>
                                            <dt className="truncate text-faint">{a.labelEn}</dt>
                                            <dd className="num text-right text-foreground">
                                                {a.kind === 'categorical' ? (typeof v === 'string' ? v : '—') : formatValue(a.format, typeof v === 'number' ? v : null)}
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
