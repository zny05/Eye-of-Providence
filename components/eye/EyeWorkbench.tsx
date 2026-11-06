'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Eye, RotateCcw, X } from 'lucide-react';
import Panel from '@/components/Panel';
import PupilPanel from '@/components/eye/PupilPanel';
import ResultMatrix from '@/components/eye/ResultMatrix';
import ParallelCoordinatesVertical from '@/components/eye/pcp/ParallelCoordinatesVertical';
import { applyBrushes, chipText, countMatches } from '@/lib/eye/brush';
import { formatValue } from '@/lib/eye/format';
import { groupColorMap, RAMP_HI, RAMP_LO, rgba } from '@/lib/eye/pcp/color-scale';
import { decodeAxes, decodeBrush, encodeBrush } from '@/lib/eye/pcp/url-state';
import { INDUSTRY_PRESETS, STOCK_PRESETS } from '@/lib/eye/presets';
import type { BrushRange, BrushState, PcpAxis, PcpTable } from '@/lib/eye/types';
import { cn } from '@/lib/utils';

interface Props {
    view: 'stocks' | 'industries';
    axes: PcpAxis[];
    table: PcpTable;
    defaultAxes: string[];
    defaultColor: string; // 'group' or an axis id
    tiltAxisIds: string[];
    notes: string[];
}

type Layout = { order: string[]; count: number };
type Tab = 'chart' | 'matrix';

const selectClass = 'h-8 max-w-[220px] rounded-lg border border-line bg-hover px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';

const median = (values: number[]) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export default function EyeWorkbench({ view, axes, table, defaultAxes, defaultColor, tiltAxisIds, notes }: Props) {
    const params = useSearchParams();
    const pathname = usePathname();
    const validIds = useMemo(() => new Set(axes.map((a) => a.id)), [axes]);
    const byId = useMemo(() => new Map(axes.map((a) => [a.id, a])), [axes]);
    const presets = view === 'stocks' ? STOCK_PRESETS : INDUSTRY_PRESETS;

    const [layout, setLayout] = useState<Layout>(() => {
        const fromUrl = decodeAxes(params.get('axes'), validIds);
        const shown = (fromUrl.length >= 2 ? fromUrl : defaultAxes.filter((id) => validIds.has(id)));
        const rest = axes.map((a) => a.id).filter((id) => !shown.includes(id));
        return { order: [...shown, ...rest], count: Math.max(2, shown.length) };
    });
    const [brushes, setBrushes] = useState<BrushState>(() => decodeBrush(params.get('brush'), validIds));
    const [reversed, setReversed] = useState<Record<string, boolean>>({});
    const [colorId, setColorId] = useState<string>(() => {
        const c = params.get('color');
        return c === 'group' || (c && validIds.has(c)) ? c : defaultColor;
    });
    const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'matrix' ? 'matrix' : 'chart'));
    const [pupil, setPupil] = useState<string | undefined>(() => {
        const p = params.get('pupil');
        return p && table.ids.includes(p) ? p : undefined;
    });
    const [hoverId, setHoverId] = useState<string | undefined>();
    const [onlyMatched, setOnlyMatched] = useState(true);
    const [sortAxisId, setSortAxisId] = useState<string | null>(() => (defaultColor !== 'group' ? defaultColor : null));

    const displayed = useMemo(() => layout.order.slice(0, layout.count).map((id) => byId.get(id)!).filter(Boolean), [layout, byId]);
    const hidden = useMemo(() => layout.order.slice(layout.count).map((id) => byId.get(id)!).filter(Boolean), [layout, byId]);
    const colorAxis = colorId === 'group' ? null : byId.get(colorId) ?? null;
    const rowCount = table.ids.length;
    const matched = useMemo(() => applyBrushes(table.columns, rowCount, brushes), [table.columns, rowCount, brushes]);
    const matchedCount = countMatches(matched);

    const setRanges = useCallback((axisId: string, ranges: BrushRange[]) => {
        setBrushes((prev) => {
            const next = { ...prev };
            if (ranges.length === 0) delete next[axisId];
            else next[axisId] = ranges;
            return next;
        });
    }, []);
    const toggleReverse = useCallback((axisId: string) => setReversed((prev) => ({ ...prev, [axisId]: !prev[axisId] })), []);
    const moveAxis = useCallback((axisId: string, to: number) => {
        setLayout((prev) => {
            const from = prev.order.indexOf(axisId);
            if (from < 0 || from === to || from >= prev.count) return prev;
            const order = prev.order.filter((id) => id !== axisId);
            order.splice(to, 0, axisId);
            return { ...prev, order };
        });
    }, []);
    const showAxes = useCallback((ids: string[]) => {
        setLayout((prev) => {
            const shown = prev.order.slice(0, prev.count);
            const add = ids.filter((id) => !shown.includes(id));
            if (!add.length) return prev;
            const rest = prev.order.filter((id) => !shown.includes(id) && !add.includes(id));
            return { order: [...shown, ...add, ...rest], count: prev.count + add.length };
        });
    }, []);

    const applyPreset = (id: string) => {
        const preset = presets.find((p) => p.id === id);
        if (!preset) return;
        setBrushes(preset.brushes);
        showAxes(Object.keys(preset.brushes).filter((a) => validIds.has(a)));
    };

    const removeChip = (axisId: string, index: number) => setRanges(axisId, (brushes[axisId] ?? []).filter((_, i) => i !== index));

    // Keep the address bar in sync so a view can be shared and survives reload. replaceState avoids a server round trip.
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        const timer = setTimeout(() => {
            const qs = new URLSearchParams(window.location.search);
            const set = (key: string, value: string | null) => (value ? qs.set(key, value) : qs.delete(key));
            set('axes', displayed.map((a) => a.id).join(','));
            set('brush', encodeBrush(brushes) || null);
            set('color', colorId === defaultColor ? null : colorId);
            set('tab', tab === 'matrix' ? 'matrix' : null);
            set('pupil', pupil ?? null);
            const next = `${pathname}?${qs.toString()}`;
            if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', next);
        }, 250);
        return () => clearTimeout(timer);
    }, [displayed, brushes, colorId, defaultColor, tab, pupil, pathname]);

    const groups = useMemo(() => [...groupColorMap(table.group)].slice(0, 8), [table.group]);
    const colorMedian = useMemo(() => {
        if (!colorAxis || colorAxis.kind === 'categorical') return null;
        const col = table.columns[colorAxis.id] ?? [];
        return median(col.filter((v, i): v is number => typeof v === 'number' && !!matched[i]));
    }, [colorAxis, table.columns, matched]);

    const chips = Object.entries(brushes).flatMap(([axisId, ranges]) => {
        const axis = byId.get(axisId);
        return axis ? ranges.map((r, i) => ({ key: `${axisId}:${i}`, axisId, index: i, text: chipText(axis, r) })) : [];
    });

    const tabButton = (id: Tab, label: string) => (
        <button type="button" className={cn('btn btn-sm btn-ghost', tab === id && 'is-on')} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
    );

    return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel
                title={view === 'stocks' ? 'Watchlist cross-section' : 'Industry weight structure'}
                sub="Each axis is a horizontal track; lines run top to bottom. Drag on a track to brush, click a category node to select."
                action={<div className="flex gap-1">{tabButton('chart', 'Chart')}{tabButton('matrix', 'Matrix')}</div>}
                bodyClassName="relative"
            >
                <div className="sticky top-0 z-20 flex flex-col gap-2 rounded-t-[14px] border-b border-line bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[12px] text-faint">
                            Axes
                            <select
                                className={selectClass}
                                value={layout.count}
                                onChange={(e) => setLayout((prev) => ({ ...prev, count: Number(e.target.value) }))}
                                aria-label="Number of axes"
                            >
                                {Array.from({ length: axes.length - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                        {hidden.length > 0 && (
                            <select className={selectClass} value="" onChange={(e) => e.target.value && showAxes([e.target.value])} aria-label="Add axis">
                                <option value="">Add axis…</option>
                                {hidden.map((a) => <option key={a.id} value={a.id}>{a.labelEn}</option>)}
                            </select>
                        )}
                        <label className="flex items-center gap-1.5 text-[12px] text-faint">
                            Colour by
                            <select className={selectClass} value={colorId} onChange={(e) => { setColorId(e.target.value); if (e.target.value !== 'group') setSortAxisId(e.target.value); }} aria-label="Colour by">
                                <option value="group">{view === 'stocks' ? 'Industry' : 'Sector'}</option>
                                {axes.filter((a) => a.kind !== 'categorical').map((a) => <option key={a.id} value={a.id}>{a.labelEn}</option>)}
                            </select>
                        </label>
                        <select className={selectClass} value="" onChange={(e) => e.target.value && applyPreset(e.target.value)} aria-label="Apply preset">
                            <option value="">Preset…</option>
                            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-[12px] text-faint">
                            <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} />
                            Matching only
                        </label>
                        <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={() => { setBrushes({}); setReversed({}); }} disabled={chips.length === 0 && !Object.values(reversed).some(Boolean)}>
                            <RotateCcw /> Reset
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <p className="num text-[13px] text-foreground" aria-live="polite">
                            Matching {matchedCount} / {rowCount}
                            {colorAxis && colorMedian !== null && <span className="text-faint"> · {colorAxis.labelEn} median {formatValue(colorAxis.format, colorMedian)}</span>}
                        </p>
                        {colorAxis && colorAxis.kind !== 'categorical' ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-faint">
                                <span className="num">{formatValue(colorAxis.format, colorAxis.domain[0])}</span>
                                <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${rgba(RAMP_LO, 1)}, ${rgba(RAMP_HI, 1)})` }} />
                                <span className="num">{formatValue(colorAxis.format, colorAxis.domain[1])}</span>
                            </div>
                        ) : (
                            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                                {groups.map(([name, color]) => (
                                    <li key={name} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: color }} />{name}</li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {chips.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5" aria-label="Active selections">
                            {chips.map((c) => (
                                <li key={c.key} className="flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 text-[12px] text-brand-ink">
                                    {c.text}
                                    <button type="button" className="grid size-4 place-items-center rounded-full hover:bg-white/10" aria-label={`Remove ${c.text}`} onClick={() => removeChip(c.axisId, c.index)}><X className="size-3" /></button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {tab === 'chart' && (
                    <div className="px-1 pb-2 pt-2">
                        <ParallelCoordinatesVertical
                            axes={displayed}
                            table={table}
                            matched={matched}
                            brushes={brushes}
                            reversed={reversed}
                            colorAxis={colorAxis}
                            pupil={pupil}
                            hoverId={hoverId}
                            onlyMatched={onlyMatched}
                            onRangesChange={setRanges}
                            onToggleReverse={toggleReverse}
                            onMoveAxis={moveAxis}
                            onPupilChange={setPupil}
                            onHoverChange={setHoverId}
                        />
                    </div>
                )}

                <div className={cn(tab === 'chart' && 'border-t border-line')}>
                    <ResultMatrix
                        axes={displayed}
                        table={table}
                        matched={matched}
                        onlyMatched={onlyMatched}
                        sortAxisId={sortAxisId}
                        pupil={pupil}
                        hoverId={hoverId}
                        onSortChange={setSortAxisId}
                        onPupilChange={setPupil}
                        onHoverChange={setHoverId}
                    />
                </div>
            </Panel>

            <Panel title="Pupil" sub="The instrument you selected" className="self-start xl:sticky xl:top-3">
                {pupil ? (
                    <PupilPanel axes={axes} table={table} pupil={pupil} tiltAxisIds={tiltAxisIds} onClose={() => setPupil(undefined)} />
                ) : (
                    <div className="flex flex-col items-center gap-2 p-6 text-center text-[13px] text-faint">
                        <Eye className="size-6 text-brand-ink" />
                        Click a line or a matrix row to inspect it.
                    </div>
                )}
                {notes.length > 0 && (
                    <ul className="flex flex-col gap-1.5 border-t border-line p-3.5 text-[11.5px] leading-snug text-faint">
                        {notes.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                )}
            </Panel>
        </div>
    );
}
