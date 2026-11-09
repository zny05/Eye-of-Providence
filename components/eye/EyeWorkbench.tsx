'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, Moon, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import Panel from '@/components/Panel';
import ParallelCoordinatesVertical from '@/components/eye/pcp/ParallelCoordinatesVertical';
import type { EyeExplain } from '@/lib/actions/eye.actions';
import { AXIS_CATALOG_IDS, DEFAULT_AXIS_IDS, OUTCOME_AXIS_IDS } from '@/lib/eye/explain-view';
import { formatValue } from '@/lib/eye/format';
import { EYE_THEME, SELECTED_PALETTE } from '@/lib/eye/pcp/color-scale';
import { parseSymbols, SYMBOL_PATTERN } from '@/lib/eye/symbols';
import { readPersistedAxes, readPersistedSymbols, writePersistedAxes, writePersistedSymbols } from '@/lib/eye/selection';
import { DEFAULT_AXIS_COUNT, MAX_AXES, MAX_SELECTED, MIN_AXES } from '@/lib/eye/types';

const selectClass = 'h-8 max-w-[220px] rounded-lg border border-line bg-hover px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand';

// Axes from the address bar: known ids only, no repeats, at most MAX_AXES; too few
// falls back to the persisted layout (which itself falls back to the defaults).
function axesFromUrl(value: string | null): string[] {
    const ids = (value ?? '').split(',').filter((id, i, all) => AXIS_CATALOG_IDS.includes(id) && all.indexOf(id) === i).slice(0, MAX_AXES);
    if (ids.length >= MIN_AXES) return ids;
    const persisted = readPersistedAxes();
    return persisted.length >= MIN_AXES ? persisted : DEFAULT_AXIS_IDS;
}

function notifySelectionChanged() {
    window.dispatchEvent(new Event('eye:selection-changed'));
}

export default function EyeWorkbench({ data }: { data: EyeExplain }) {
    const router = useRouter();
    const params = useSearchParams();
    const [pending, startTransition] = useTransition();
    const { selected, watchlist, view, backgroundCount } = data;
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [axisIds, setAxisIds] = useState<string[]>(() => axesFromUrl(params.get('axes')));
    const [reversed, setReversed] = useState<Record<string, boolean>>({});
    const [hoverId, setHoverId] = useState<string | undefined>();

    // Selection changes re-render on the server; the axis layout stays in the URL so it survives that and a reload.
    // Also mirrored into localStorage so the sidebar Eye link can resurrect them after a module switch.
    const go = useCallback((symbols: string[]) => {
        writePersistedSymbols(symbols);
        notifySelectionChanged();
        const qs = new URLSearchParams(window.location.search);
        if (symbols.length) qs.set('s', symbols.join(','));
        else qs.delete('s');
        const query = qs.toString();
        startTransition(() => router.replace(query ? `/eye?${query}` : '/eye'));
    }, [router]);

    // On first mount, if the URL carries no ?s= but localStorage does (module switch
    // hit the bare /eye link), resurrect the pick via one replace so the server
    // renders with the symbols rather than an empty workbench.
    const firstRenderRef = useRef(true);
    useEffect(() => {
        if (!firstRenderRef.current) return;
        firstRenderRef.current = false;
        const persisted = readPersistedSymbols();
        if (!new URLSearchParams(window.location.search).has('s') && persisted.length) {
            go(persisted);
        }
    }, [go]);

    useEffect(() => {
        if (firstRenderRef.current) return;
        writePersistedAxes(axisIds);
        notifySelectionChanged();
        const qs = new URLSearchParams(window.location.search);
        if (axisIds.join(',') === DEFAULT_AXIS_IDS.join(',')) qs.delete('axes');
        else qs.set('axes', axisIds.join(','));
        const query = qs.toString();
        const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
        if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', next);
    }, [axisIds]);

    const add = useCallback((symbol: string) => {
        const next = parseSymbols([...selected, symbol].join(','));
        if (next.length === selected.length) return;
        setError(null);
        go(next);
    }, [selected, go]);
    const remove = (symbol: string) => go(selected.filter((s) => s !== symbol));

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const symbol = draft.trim().toUpperCase();
        if (!SYMBOL_PATTERN.test(symbol)) return setError('Enter a ticker such as AAPL or BRK.B');
        if (selected.includes(symbol)) return setError(`${symbol} is already selected`);
        if (selected.length >= MAX_SELECTED) return setError(`At most ${MAX_SELECTED} instruments`);
        setDraft('');
        add(symbol);
    };

    const full = selected.length >= MAX_SELECTED;
    const addable = watchlist.filter((w) => !selected.includes(w.symbol));

    const axes = useMemo(() => {
        if (!view) return [];
        const byId = new Map(view.axes.map((a) => [a.id, a]));
        return axisIds.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    }, [view, axisIds]);
    const unusedAxes = useMemo(() => (view ? view.axes.filter((a) => !axisIds.includes(a.id)) : []), [view, axisIds]);

    const moveAxis = useCallback((axisId: string, to: number) => {
        setAxisIds((prev) => {
            const from = prev.indexOf(axisId);
            if (from < 0 || from === to) return prev;
            const next = prev.filter((id) => id !== axisId);
            next.splice(to, 0, axisId);
            return next;
        });
    }, []);
    // Swap the data shown by one slot, keeping its position.
    const replaceAxis = useCallback((oldId: string, newId: string) => {
        setAxisIds((prev) => (prev.includes(newId) || !AXIS_CATALOG_IDS.includes(newId) ? prev : prev.map((id) => (id === oldId ? newId : id))));
    }, []);
    const removeAxis = useCallback((axisId: string) => setAxisIds((prev) => (prev.length <= MIN_AXES ? prev : prev.filter((id) => id !== axisId))), []);
    const addAxis = useCallback((axisId: string) => {
        setAxisIds((prev) => (prev.length >= MAX_AXES || prev.includes(axisId) || !AXIS_CATALOG_IDS.includes(axisId) ? prev : [...prev, axisId]));
    }, []);
    const toggleReverse = useCallback((id: string) => setReversed((prev) => ({ ...prev, [id]: !prev[id] })), []);

    // Content banner (third step): one line of transit theme from CosmyDay, when available.
    const transitLine = useMemo(() => {
        // The CosmyDay /events/upcoming feed does not carry narrative text, so we surface
        // the next event's headline instead. The local moon phase + retrograde list are
        // computed from astronomy-engine on the server and ride along in view.astro.
        if (!view) return null;
        const cd = view.astro.cosmyday;
        if (cd.nextEventDays === null) return null;
        return `Next sky event in ${cd.nextEventDays} day${cd.nextEventDays === 1 ? '' : 's'}`;
    }, [view]);

    return (
        <div className={pending ? 'pointer-events-none flex flex-col gap-3 opacity-60 transition-opacity' : 'flex flex-col gap-3 transition-opacity'} aria-busy={pending}>
            <Panel title="Instruments" sub={`Pick up to ${MAX_SELECTED}. Each one becomes a coloured line through the axes you choose.`}>
                <div className="flex flex-col gap-3 p-3.5">
                    <ul className="flex flex-wrap gap-1.5" aria-label="Selected instruments">
                        {selected.map((symbol, i) => (
                            <li key={symbol} className="flex items-center gap-1.5 rounded-full border border-line-strong bg-hover py-0.5 pl-2 pr-1 text-[12.5px]">
                                <span className="size-2.5 rounded-full" style={{ background: SELECTED_PALETTE[i % SELECTED_PALETTE.length] }} />
                                <span className="mono font-semibold text-foreground">{symbol}</span>
                                <button type="button" className="grid size-5 place-items-center rounded-full text-faint hover:bg-white/10 hover:text-foreground" aria-label={`Remove ${symbol}`} onClick={() => remove(symbol)}>
                                    <X className="size-3" />
                                </button>
                            </li>
                        ))}
                        {selected.length === 0 && <li className="text-[13px] text-faint">Nothing selected yet.</li>}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                        <form onSubmit={submit} className="flex items-center gap-1.5">
                            <input
                                value={draft}
                                onChange={(e) => { setDraft(e.target.value); setError(null); }}
                                placeholder="Ticker, e.g. NVDA"
                                aria-label="Add a ticker"
                                maxLength={25}
                                disabled={full}
                                className="h-8 w-40 rounded-lg border border-line bg-hover px-2.5 text-[13px] uppercase text-foreground outline-none placeholder:normal-case placeholder:text-faint focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                            />
                            <button type="submit" className="btn btn-sm btn-outline" disabled={full || !draft.trim()}><Plus /> Add</button>
                        </form>
                        {addable.length > 0 && (
                            <select className={selectClass} value="" disabled={full} onChange={(e) => e.target.value && add(e.target.value)} aria-label="Add from watchlist">
                                <option value="">Add from watchlist…</option>
                                {addable.map((w) => <option key={w.symbol} value={w.symbol}>{w.symbol}{w.company !== w.symbol ? ` · ${w.company}` : ''}</option>)}
                            </select>
                        )}
                        <span className="num ml-auto text-[12px] text-faint">{selected.length} / {MAX_SELECTED}{pending && ' · updating…'}</span>
                    </div>
                    {error && <p className="text-[12px] text-down" role="alert">{error}</p>}
                </div>
            </Panel>

            {!view || view.table.ids.length === 0 ? (
                <Panel>
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-[13px] text-faint">
                        <Eye className="size-7 text-brand-ink" />
                        {selected.length > 0
                            ? `No readable data for ${selected.join(', ')} (Finnhub free covers US stocks only).`
                            : 'Select an instrument to see why it moved: valuation, growth, quality, momentum, size, sentiment and the symbolic layer, ending in today’s, 1-month and 1-quarter price change.'}
                        {watchlist.length > 0 && (
                            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                                {watchlist.slice(0, MAX_SELECTED).map((w) => (
                                    <button key={w.symbol} type="button" className="btn btn-sm btn-outline" onClick={() => add(w.symbol)}><Plus /> {w.symbol}</button>
                                ))}
                            </div>
                        )}
                    </div>
                </Panel>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-[#8b5cf6]/40 bg-[#8b5cf6]/5 px-3 py-2 text-[12px] text-muted-foreground">
                        <Moon className="size-4 text-[#c4a35a]" />
                        <span><span className="font-semibold text-foreground">Symbolic layer</span> · {view.astro.moon.name}, {Math.round(view.astro.moon.illumination * 100)}% lit</span>
                        <span>Sun in {view.astro.sunSign} {view.astro.sunSignDegree.toFixed(0)}°</span>
                        <span>Moon in {view.astro.moon.sign} {view.astro.moon.signDegree.toFixed(0)}°</span>
                        <span>Retrograde now: {view.astro.retrograde.length ? view.astro.retrograde.join(', ') : 'none'}</span>
                        {transitLine && <span className="flex items-center gap-1"><Sparkles className="size-3.5 text-[#c4a35a]" /> {transitLine}</span>}
                        {view.astro.cosmyday.error && <span className="text-faint">CosmyDay feed unavailable — event axes may be empty ({view.astro.cosmyday.error})</span>}
                        <span className="text-faint">Cultural overlay, no demonstrated effect on prices.</span>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <Panel
                            title="Why it moved"
                            sub={`Scores are percentiles among the ${view.table.ids.length} instruments shown (${selected.length} selected + ${view.table.ids.length - selected.length} peers). Grey lines are peers; click one to add it. Each axis shows the data you pick: change it, drag to reorder, or remove it.`}
                            action={(
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                    <span className="num text-[12px] text-faint" aria-live="polite">{axisIds.length} / {MAX_AXES} axes</span>
                                    <select
                                        className={selectClass}
                                        value=""
                                        disabled={axisIds.length >= MAX_AXES || unusedAxes.length === 0}
                                        onChange={(e) => e.target.value && addAxis(e.target.value)}
                                        aria-label="Add an axis"
                                    >
                                        <option value="">{axisIds.length >= MAX_AXES ? 'Axis limit reached' : 'Add axis…'}</option>
                                        {[...new Set(unusedAxes.map((a) => a.section))].map((section) => (
                                            <optgroup key={section} label={section}>
                                                {unusedAxes.filter((a) => a.section === section).map((a) => <option key={a.id} value={a.id}>{a.labelEn}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAxisIds(DEFAULT_AXIS_IDS); setReversed({}); }} title={`Back to the suggested ${DEFAULT_AXIS_COUNT} axes`}>
                                        <RotateCcw /> Reset
                                    </button>
                                </div>
                            )}
                        >
                            <div className="px-1 py-2">
                                <ParallelCoordinatesVertical
                                    axes={axes}
                                    catalog={view.axes}
                                    table={view.table}
                                    reversed={reversed}
                                    hoverId={hoverId}
                                    canRemoveAxis={axisIds.length > MIN_AXES}
                                    onToggleReverse={toggleReverse}
                                    onMoveAxis={moveAxis}
                                    onReplaceAxis={replaceAxis}
                                    onRemoveAxis={removeAxis}
                                    onHoverChange={setHoverId}
                                    onAddSymbol={add}
                                    canAdd={!full}
                                />
                            </div>
                        </Panel>

                        <Panel title="Price outcome" sub="What actually happened, with the rank among the instruments shown" className="self-start xl:sticky xl:top-3">
                            <ul className="flex max-h-[70vh] flex-col divide-y divide-line overflow-y-auto">
                                {selected.map((symbol, i) => {
                                    const row = view.table.ids.indexOf(symbol);
                                    if (row < 0) return null;
                                    const scored = axes.filter((a) => a.isScore).map((a) => ({ a, v: view.table.columns[a.id][row] })).filter((e): e is { a: typeof e.a; v: number } => typeof e.v === 'number').sort((x, y) => y.v - x.v);
                                    return (
                                        <li key={symbol} className="flex flex-col gap-2 p-3" onMouseEnter={() => setHoverId(symbol)} onMouseLeave={() => setHoverId(undefined)}>
                                            <div className="flex items-center gap-2">
                                                <span className="size-2.5 flex-none rounded-full" style={{ background: SELECTED_PALETTE[i % SELECTED_PALETTE.length] }} />
                                                <span className="mono text-[13px] font-bold text-foreground">{symbol}</span>
                                                <span className="truncate text-[12px] text-faint">{view.table.labels[row] !== symbol ? view.table.labels[row] : ''}</span>
                                            </div>
                                            <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-0.5 text-[12.5px]">
                                                {OUTCOME_AXIS_IDS.map((id) => {
                                                    const axis = view.axes.find((a) => a.id === id)!;
                                                    const v = view.table.columns[id][row];
                                                    const rank = view.table.rank[id][row];
                                                    const num = typeof v === 'number' ? v : null;
                                                    return (
                                                        <React.Fragment key={id}>
                                                            <dt className="text-faint">{axis.labelEn}</dt>
                                                            <dd className="num text-right font-semibold" style={{ color: num === null ? undefined : num >= 0 ? EYE_THEME.pos : EYE_THEME.neg }}>
                                                                {num === null ? '—' : `${num >= 0 ? '▲' : '▼'} ${formatValue('spct', num).replace('+', '')}`}
                                                            </dd>
                                                            <dd className="num w-12 text-right text-[11px] text-faint">{rank === null ? '' : `P${Math.round(rank)}`}</dd>
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </dl>
                                            {scored.length >= 4 && (
                                                <p className="text-[11.5px] leading-snug text-faint">
                                                    Highest: {scored.slice(0, 2).map((e) => `${e.a.labelEn} ${e.v.toFixed(0)}`).join(' · ')}
                                                    <br />
                                                    Lowest: {scored.slice(-2).reverse().map((e) => `${e.a.labelEn} ${e.v.toFixed(0)}`).join(' · ')}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </Panel>
                    </div>

                    <ul className="flex flex-col gap-1 px-1 text-[11.5px] leading-snug text-faint">
                        {view.skipped.length > 0 && <li>No readable data for {view.skipped.join(', ')} (Finnhub free covers US stocks only).</li>}
                        <li>Background: {backgroundCount} peers from Finnhub&apos;s peer list, topped up from your watchlist. Industry is Finnhub&apos;s own classification.</li>
                        <li>Axes marked &quot;unverified&quot; use Finnhub metric names or units that have not been checked against a live response; they may be empty or mis-scaled. The 1-month and 1-quarter changes are price returns, not total returns.</li>
                        <li>The macro-environment axis needs the FRED pipeline, which is not built yet.</li>
                        <li>Eye of Omniscience explains what already happened with public data. It is for research and education only, is not investment advice, and does not forecast prices. The symbolic layer is a cultural overlay with no demonstrated effect on prices.</li>
                    </ul>
                </>
            )}
        </div>
    );
}
