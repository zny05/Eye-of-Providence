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
    // cursor tracks the pointer for the tooltip's initial mount position;
    // tooltip *paint* (position) is done via tooltipRef so moves never re-render.
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

    // Tooltip: 5ms debounce lets a stable hover read through the near-line
    // flicker that confused the old rAF-per-move path. Position is written
    // directly to the DOM via transform (no React re-render, no layout),
    // with a fixed height per axis count and above/below placement chosen
    // so the box never pushes the chart wider (no reflow either way).
    const TOOLTIP_W = 240;
    const TIP_OFFSET = 14;
    const tooltipRef = useRef<HTMLDivElement>(null);
    const pendingCursor = useRef<{ x: number; y: number } | null>(null);
    const hoverTimer = useRef<number | null>(null);
    const paintHoverTimer = useRef<number | null>(null);
    // The tooltip must size to its content, not to a hand-computed pixel
    // budget. Root cause of the disappearing symbol header (screenshots
    // 2026-11-09_115753 / 121059): the box had a fixed height + overflow:hidden
    // inside a flex column, and the header <p> carried overflow:hidden itself.
    // In flexbox, an item whose overflow is not visible gets an automatic
    // minimum size of 0, so the dl could squeeze the header to zero height and
    // the budget (56 + n*15) was ~25px short of the real content height for
    // 16 axes (dl rows are 14.4px + 2px gap each, not 15px flat). Any fixed
    // budget guesses wrong again the moment font size or gap changes.
    // Fix: natural height (no height / no overflow clip), header pinned with
    // flex-none, and the measured height fed back into the above/below flip.
    const estimatedTipHeight = Math.ceil(78 + n * 17);
    const tipHeightRef = useRef(estimatedTipHeight);

    const paintTooltip = useCallback((x: number, y: number) => {
        if (!tooltipRef.current) return;
        const h = tipHeightRef.current || estimatedTipHeight;
        // Vertical flip: if the box would spill past the stage bottom, place
        // it above the cursor instead — mirroring horizontal clamp logic.
        const belowWouldOverflow = y + TIP_OFFSET + h > g.H;
        const ty = belowWouldOverflow ? Math.max(0, y - h - TIP_OFFSET) : y + TIP_OFFSET;
        const tx = Math.min(x + TIP_OFFSET, Math.max(0, g.W - TOOLTIP_W - 4));
        tooltipRef.current.style.transform = `translate(${tx}px, ${ty}px)`;
        tooltipRef.current.style.left = '0px';
        tooltipRef.current.style.top = '0px';
    }, [g.H, g.W, estimatedTipHeight]);

    // After mount / axis-count change, measure the real box and re-paint so
    // the flip decision uses the true height, not the estimate.
    useEffect(() => {
        if (tipRow === undefined) return;
        const el = tooltipRef.current;
        if (!el) return;
        const h = el.offsetHeight;
        if (h > 0 && h !== tipHeightRef.current) {
            tipHeightRef.current = h;
            if (pendingCursor.current) paintTooltip(pendingCursor.current.x, pendingCursor.current.y);
        }
    });

    const scheduleHover = useCallback((r: number | null) => {
        if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
        if (r === null) {
            hoverTimer.current = window.setTimeout(() => onHoverChange(undefined), 5);
            return;
        }
        const id = table.ids[r];
        if (id === hoverId) return; // already highlighted — don't reschedule
        hoverTimer.current = window.setTimeout(() => {
            onHoverChange(id);
            paintHoverTimer.current = window.requestAnimationFrame(() => {
                if (pendingCursor.current) paintTooltip(pendingCursor.current.x, pendingCursor.current.y);
            });
        }, 5);
    }, [hoverId, onHoverChange, paintTooltip, table.ids]);

    const onPointerMove = (e: React.PointerEvent) => {
        pointer.current = e.pointerType;
        if (e.pointerType !== 'mouse') return;
        if (interactive(e)) {
            if (hoverId !== undefined) onHoverChange(undefined);
            return;
        }
        const { x, y } = point(e);
        pendingCursor.current = { x, y };
        // Tooltip positioning is paint-only (no layout/re-render); do it
        // synchronously so the box follows the pointer without flicker.
        paintTooltip(x, y);
        // Keep the state cursor in sync so a fresh React mount paints the
        // tooltip at the right place (first hover after axis changes).
        if (!cursor || cursor.x !== x || cursor.y !== y) setCursor({ x, y });
        // Hover highlight stays debounced at 5ms so a fast crossing doesn't
        // thrash canvas redraw — the tooltip itself never waits for it.
        if (paintHoverTimer.current !== null) window.cancelAnimationFrame(paintHoverTimer.current);
        paintHoverTimer.current = window.requestAnimationFrame(() => {
            const r = hit(x, y, 7);
            scheduleHover(r);
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

                    {tipRow !== undefined && (cursor || pendingCursor.current) && (
                        <div
                            ref={tooltipRef}
                            data-eye-tooltip
                            className="pointer-events-none absolute z-20 w-[240px] rounded-lg border border-line-strong bg-card/95 p-2.5 text-[12px] shadow-xl"
                            style={{
                                // Natural height: the box grows to fit the header +
                                // one dl row per axis. Height changes only when the
                                // axis COUNT changes (not while moving between
                                // lines), so the chart never reflows mid-hover.
                                // Never re-add height/overflow:hidden here — that
                                // pair is what clipped the symbol header away
                                // (flex item with overflow:hidden gets min-height
                                // 0 and the dl squeezes it shut).
                                // Position is written by paintTooltip() via
                                // transform; this top/left is just the first paint.
                                left: 0,
                                top: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                transform: 'translateZ(0)',
                                willChange: 'transform, opacity',
                                opacity: cursor || pendingCursor.current ? 1 : 0,
                                transition: 'opacity 80ms cubic-bezier(0.33, 1, 0.68, 1)',
                                backfaceVisibility: 'hidden',
                            }}
                        >
                            {/* Title row — mirrors the HD Financials reference:
                                large bold symbol + name, never clipped. flex-none
                                keeps the dl from shrinking it. */}
                            <p className="flex min-w-0 flex-none items-baseline gap-2 leading-tight" style={{ whiteSpace: 'nowrap' }}>
                                <span className="mono text-[20px] font-bold tracking-tight text-foreground">{table.ids[tipRow]}</span>
                                {table.labels[tipRow] !== table.ids[tipRow] && (
                                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground/90">{table.labels[tipRow]}</span>
                                )}
                            </p>
                            <p className="mt-0.5 flex-none truncate text-[11px] leading-tight text-faint">{table.group[tipRow] ?? 'Industry unknown'}{!tipSelected && canAdd ? ' · click to add' : ''}</p>
                            <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
                                {axes.map((a) => {
                                    const v = table.columns[a.id]?.[tipRow];
                                    const raw = table.raw[a.id]?.[tipRow];
                                    return (
                                        <React.Fragment key={a.id}>
                                            <dt className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-faint">{a.labelEn}</dt>
                                            <dd className="num flex-none text-right text-foreground">
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
