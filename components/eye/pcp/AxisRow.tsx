'use client';

import React, { memo, useMemo, useRef } from 'react';
import { AlertTriangle, ArrowLeftRight, GripVertical, X } from 'lucide-react';
import { formatTick } from '@/lib/eye/format';
import type { CatBand } from '@/lib/eye/pcp/categorical-layout';
import { EYE_THEME } from '@/lib/eye/pcp/color-scale';
import { type PcpGeometry, trackTicks, valueToT } from '@/lib/eye/pcp/geometry';
import type { CellValue, PcpAxis } from '@/lib/eye/types';
import { cn } from '@/lib/utils';

const ROW_HALF = 40; // the row container spans 80px around the track centre
const BINS = 24;
const ASTRO_COLOR = '#c4a35a';

interface AxisRowProps {
    axis: PcpAxis;
    index: number;
    axisCount: number;
    y: number;
    g: PcpGeometry;
    column: CellValue[];
    reversed: boolean;
    bands: CatBand[] | null;
    selectedKeys: string[]; // categories that contain a selected instrument
    catalog: PcpAxis[]; // every axis the user may pick for this slot
    usedIds: string[]; // axes already on the chart (other rows)
    canRemove: boolean;
    onToggleReverse: (axisId: string) => void;
    onMoveAxis: (axisId: string, toIndex: number) => void;
    onReplaceAxis: (oldId: string, newId: string) => void;
    onRemoveAxis: (axisId: string) => void;
}

function AxisRow({ axis, index, axisCount, y, g, column, reversed, bands, selectedKeys, catalog, usedIds, canRemove, onToggleReverse, onMoveAxis, onReplaceAxis, onRemoveAxis }: AxisRowProps) {
    const rowRef = useRef<HTMLDivElement>(null);
    const numeric = axis.kind !== 'categorical';
    const kind = axis.kind === 'log' ? 'log' : 'linear';
    const center = ROW_HALF;
    const trackTop = center - g.bandHeight / 2;
    const left = g.labelPlacement === 'left';
    const astro = axis.role === 'astro';
    const outcome = axis.role === 'outcome';

    const toX = (value: number) => {
        const t = valueToT(kind, value, axis.domain);
        return t === null ? 0 : (reversed ? 1 - t : t) * g.trackWidth;
    };

    // Row reorder: drag the grip vertically (the pointer picks the slot) or press Alt+Up/Down.
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
    const zero = numeric && axis.domain[0] < 0 && axis.domain[1] > 0;

    // Marginal distribution of every row on this axis (grey), so a line can be read against its peers.
    const histogram = useMemo(() => {
        if (!numeric) return null;
        const bins = new Array<number>(BINS).fill(0);
        for (const v of column) {
            if (typeof v !== 'number') continue;
            const t = valueToT(kind, v, axis.domain);
            if (t === null) continue;
            bins[Math.min(BINS - 1, Math.floor((reversed ? 1 - t : t) * BINS))]++;
        }
        return { bins, max: Math.max(1, ...bins) };
    }, [numeric, column, kind, axis.domain, reversed]);

    const lowCoverage = axis.coverage < 0.5;
    const tint = astro ? 'rgba(139,92,246,0.07)' : outcome ? 'rgba(245,158,11,0.07)' : undefined;

    // This slot may switch to any axis not already used elsewhere, grouped by section.
    const optionGroups = useMemo(() => {
        const groups = new Map<string, PcpAxis[]>();
        for (const a of catalog) {
            if (a.id !== axis.id && usedIds.includes(a.id)) continue;
            groups.set(a.section, [...(groups.get(a.section) ?? []), a]);
        }
        return [...groups];
    }, [catalog, usedIds, axis.id]);

    // Reason chips: make empty axes self-explaining instead of an ambiguous gap.
    // fetch-failed = the live request failed (429/403/timeout); no-data = request OK but every
    // reading was null (wrong field name, or a symbol with no fundamentals for this axis).
    const reasonChip =
        axis.reason === 'fetch-failed' ? (
            <span className="flex-none rounded bg-down/15 px-1 text-[10px] text-down" title="Request failed (rate limit, forbidden, or timeout). Check the server logs for 'Error fetching' lines. / 请求失败（限流/403/超时）">
                fetch-failed
            </span>
        ) : axis.reason === 'no-data' ? (
            <span className="flex-none rounded bg-white/10 px-1 text-[10px] text-muted-foreground" title="Finnhub returned data but this field was null for every symbol (wrong field name, or a symbol with no fundamentals). / 有数据，但该字段全为 null">
                no-data
            </span>
        ) : null;

    const badges = (
        <>
            {astro && <span className="flex-none rounded px-1 text-[10px] font-semibold" style={{ background: 'rgba(139,92,246,0.22)', color: ASTRO_COLOR }} title={axis.approx}>symbolic</span>}
            {axis.approx && !astro && <span className="flex-none rounded bg-white/10 px-1 text-[10px] text-muted-foreground" title={axis.approx}>≈</span>}
            {!axis.verified && !astro && <span className="flex-none rounded bg-white/10 px-1 text-[10px] text-faint" title="Source field or unit not yet verified">unverified</span>}
            {lowCoverage && <AlertTriangle className="size-3.5 flex-none text-warn" aria-label={`Only ${Math.round(axis.coverage * 100)}% coverage`} />}
            {reasonChip}
        </>
    );
    const controls = (
        <>
            {numeric && (
                <button
                    type="button"
                    className={cn('grid size-5 flex-none place-items-center rounded hover:bg-white/5', reversed ? 'text-brand-ink' : 'text-faint hover:text-foreground')}
                    title={reversed ? 'Axis reversed: low on the right' : 'Reverse axis'}
                    aria-pressed={reversed}
                    aria-label={`Reverse ${axis.labelEn} axis`}
                    onClick={() => onToggleReverse(axis.id)}
                    data-eye-interactive
                >
                    <ArrowLeftRight className="size-3.5" />
                </button>
            )}
            <button
                type="button"
                className="grid size-5 flex-none place-items-center rounded text-faint hover:bg-white/5 hover:text-foreground disabled:opacity-30"
                title={canRemove ? 'Remove this axis' : 'At least two axes are needed'}
                aria-label={`Remove ${axis.labelEn} axis`}
                disabled={!canRemove}
                onClick={() => onRemoveAxis(axis.id)}
                data-eye-interactive
            >
                <X className="size-3.5" />
            </button>
        </>
    );

    return (
        <div
            ref={rowRef}
            role="group"
            aria-label={`${axis.labelEn} axis, ${axis.section}`}
            className="pointer-events-none absolute left-0"
            style={{ top: y - ROW_HALF, width: g.W, height: ROW_HALF * 2 }}
        >
            {tint && (
                <div
                    className={cn('absolute rounded-lg', astro && 'border border-dashed border-[#8b5cf6]/30')}
                    style={{ left: 0, width: g.W - 4, top: center - g.rowGap / 2 + 3, height: g.rowGap - 6, background: tint }}
                />
            )}

            {/* label: the select picks which data this axis shows */}
            <div
                className="pointer-events-auto absolute"
                style={left ? { left: 4, width: g.labelWidth - 4, top: center - 22 } : { left: 4, width: g.W - g.padRight, top: center - 46 }}
            >
                <div className="flex items-center gap-1">
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
                    <select
                        value={axis.id}
                        onChange={(e) => onReplaceAxis(axis.id, e.target.value)}
                        aria-label={`Data shown on axis ${index + 1}`}
                        title={`${axis.labelEn} · ${axis.labelZh}`}
                        className="min-w-0 flex-1 cursor-pointer truncate rounded bg-transparent py-0.5 text-[13px] font-semibold text-foreground outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-brand"
                        data-eye-interactive
                    >
                        {optionGroups.map(([section, list]) => (
                            <optgroup key={section} label={section} className="bg-card text-faint">
                                {list.map((a) => <option key={a.id} value={a.id} className="bg-card text-foreground">{a.labelEn}</option>)}
                            </optgroup>
                        ))}
                    </select>
                    {!left && <>{badges}{controls}</>}
                </div>
                {left && (
                    <div className="flex items-center gap-1 pl-7">
                        <span className="min-w-0 flex-1 truncate text-[11px] text-faint" title={axis.section}>{axis.labelZh}</span>
                        {badges}
                        {controls}
                    </div>
                )}
            </div>

            {/* missing-value lane (hatch): lines with no reading on this axis pass through it, dashed */}
            {g.naLaneCenter !== null && axis.hasMissing && (
                <div
                    className="absolute rounded-sm"
                    style={{
                        left: g.naLaneCenter - 14, width: 28, top: trackTop, height: g.bandHeight,
                        background: 'repeating-linear-gradient(-45deg, rgba(161,161,170,0.35) 0 2px, transparent 2px 5px)',
                    }}
                    title="No reading"
                />
            )}

            {numeric ? (
                <>
                    {histogram && (
                        <svg className="absolute" style={{ left: g.trackLeft, top: trackTop - 18, width: g.trackWidth, height: 14 }} aria-hidden>
                            {histogram.bins.map((n, b) => {
                                const w = g.trackWidth / BINS;
                                const h = (n / histogram.max) * 14;
                                return <rect key={b} x={b * w + 0.5} y={14 - h} width={Math.max(1, w - 1)} height={h} fill="rgba(161,161,170,0.3)" />;
                            })}
                        </svg>
                    )}
                    <div className="absolute" style={{ left: g.trackLeft, top: trackTop, width: g.trackWidth, height: g.bandHeight }}>
                        <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: EYE_THEME.track }} />
                        {ticks.map((tick) => (
                            <span key={tick} className="absolute top-1/2 h-1.5 w-px -translate-y-1/2" style={{ left: toX(tick), background: EYE_THEME.track }} />
                        ))}
                        {(axis.isScore || zero) && (
                            <span
                                className="absolute inset-y-0 w-px border-l border-dashed"
                                style={{ left: toX(axis.isScore ? 50 : 0), borderColor: zero ? 'rgba(250,250,250,0.45)' : EYE_THEME.track }}
                                title={zero ? 'Zero change' : 'Median'}
                            />
                        )}
                    </div>
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
                        const on = keys.some((k) => selectedKeys.includes(k));
                        const wide = b.x1 - b.x0 >= 40;
                        return (
                            <div
                                key={b.key}
                                title={`${b.label} · ${b.count}${b.merged ? ` (${b.merged.length} categories)` : ''}`}
                                className="absolute flex items-center justify-center overflow-hidden rounded-[5px] border text-[11px] font-medium text-foreground"
                                style={{
                                    left: b.x0, width: Math.max(2, b.x1 - b.x0), top: center - 11, height: 22,
                                    background: on ? 'rgba(245,158,11,0.32)' : 'rgba(255,255,255,0.05)',
                                    borderColor: on ? EYE_THEME.brush : 'rgba(255,255,255,0.14)',
                                }}
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
