'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatValue } from '@/lib/eye/format';
import { groupColorMap, NO_GROUP_COLOR, rampRgb, rgba } from '@/lib/eye/pcp/color-scale';
import { valueToT } from '@/lib/eye/pcp/geometry';
import type { CellValue, PcpAxis, PcpTable } from '@/lib/eye/types';
import { cn } from '@/lib/utils';

interface Props {
    axes: PcpAxis[];
    table: PcpTable;
    matched: Uint8Array;
    onlyMatched: boolean;
    sortAxisId: string | null;
    pupil?: string;
    hoverId?: string;
    onSortChange: (axisId: string | null) => void;
    onPupilChange: (id: string | undefined) => void;
    onHoverChange: (id: string | undefined) => void;
}

const median = (values: number[]) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const STRIPES = 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 5px)';

function Cell({ axis, value, raw, striped }: { axis: PcpAxis; value: CellValue; raw: CellValue | undefined; striped: boolean }) {
    if (axis.kind === 'categorical') {
        return typeof value === 'string' ? <span className="truncate rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">{value}</span> : <span className="text-faint">—</span>;
    }
    if (typeof value !== 'number') return <span className="text-faint">—</span>;
    if (!axis.isScore) return <span className="num">{formatValue(axis.format, value)}</span>;
    const t = valueToT('linear', value, axis.domain) ?? 0;
    return (
        <div className="flex items-center gap-1.5" title={typeof raw === 'number' ? `Reading ${formatValue(axis.rawFormat ?? 'num', raw)}` : undefined}>
            <div className="h-2 w-16 flex-none overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{ width: `${t * 100}%`, background: `${striped ? `${STRIPES}, ` : ''}${rgba(rampRgb(t), 1)}` }} />
            </div>
            <span className="num w-7 text-right text-[12px]">{formatValue('score', value)}</span>
        </div>
    );
}

export default function ResultMatrix({ axes, table, matched, onlyMatched, sortAxisId, pupil, hoverId, onSortChange, onPupilChange, onHoverChange }: Props) {
    const [descending, setDescending] = useState(true);
    const groups = useMemo(() => groupColorMap(table.group), [table.group]);

    const rows = useMemo(() => {
        const idx = table.ids.map((_, i) => i).filter((i) => !onlyMatched || matched[i]);
        if (sortAxisId) {
            const col = table.columns[sortAxisId] ?? [];
            const dir = descending ? -1 : 1;
            idx.sort((a, b) => {
                const va = col[a];
                const vb = col[b];
                if (va === null || va === undefined) return vb === null || vb === undefined ? a - b : 1;
                if (vb === null || vb === undefined) return -1;
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir || a - b;
                return String(va).localeCompare(String(vb)) * dir || a - b;
            });
        }
        return idx;
    }, [table, matched, onlyMatched, sortAxisId, descending]);

    const summary = (axis: PcpAxis, rowsToUse: number[]) => {
        if (axis.kind === 'categorical') return null;
        const col = table.columns[axis.id] ?? [];
        return median(rowsToUse.map((i) => col[i]).filter((v): v is number => typeof v === 'number'));
    };
    const matchedRows = useMemo(() => table.ids.map((_, i) => i).filter((i) => matched[i]), [table.ids, matched]);
    const allRows = useMemo(() => table.ids.map((_, i) => i), [table.ids]);

    const header = (axis: PcpAxis) => {
        const on = sortAxisId === axis.id;
        return (
            <th key={axis.id} className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold text-faint" aria-sort={on ? (descending ? 'descending' : 'ascending') : 'none'}>
                <button
                    type="button"
                    className="inline-flex items-center gap-0.5 hover:text-foreground"
                    onClick={() => {
                        if (on) setDescending((d) => !d);
                        else {
                            onSortChange(axis.id);
                            setDescending(axis.kind !== 'categorical');
                        }
                    }}
                >
                    {axis.labelEn}
                    {on && (descending ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
                </button>
            </th>
        );
    };

    return (
        <div className="max-h-[520px] overflow-auto" role="region" aria-label="Linked result matrix" tabIndex={0}>
            <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                        <th className="px-2 py-2 text-left text-[11px] font-semibold text-faint">Name</th>
                        {axes.map(header)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((i) => {
                        const id = table.ids[i];
                        const dim = !matched[i];
                        return (
                            <tr
                                key={id}
                                tabIndex={0}
                                aria-selected={id === pupil}
                                onClick={() => onPupilChange(id === pupil ? undefined : id)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') onPupilChange(id === pupil ? undefined : id);
                                }}
                                onMouseEnter={() => onHoverChange(id)}
                                onMouseLeave={() => onHoverChange(undefined)}
                                className={cn('cursor-pointer outline-none focus-visible:bg-white/10', id === pupil ? 'bg-white/10' : id === hoverId ? 'bg-white/5' : '', dim && 'opacity-40')}
                            >
                                <td className="max-w-[200px] border-t border-line px-2 py-1.5">
                                    <span className="flex items-center gap-2">
                                        <span className="size-2 flex-none rounded-full" style={{ background: (table.group[i] && groups.get(table.group[i]!)) || NO_GROUP_COLOR }} />
                                        <span className="truncate font-medium text-foreground" title={table.labels[i]}>{table.labels[i]}</span>
                                        {table.labels[i] !== id && <span className="mono flex-none text-[11px] text-faint">{id}</span>}
                                    </span>
                                </td>
                                {axes.map((axis) => (
                                    <td key={axis.id} className="max-w-[160px] border-t border-line px-2 py-1.5">
                                        <Cell axis={axis} value={table.columns[axis.id]?.[i] ?? null} raw={table.raw[axis.id]?.[i]} striped={!!table.flags[i]?.lowCoverage} />
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-card">
                    {[['Matching median', matchedRows], ['All median', allRows]].map(([label, set]) => (
                        <tr key={label as string}>
                            <td className="border-t border-line-strong px-2 py-1.5 text-[11px] font-semibold text-faint">{label as string}</td>
                            {axes.map((axis) => {
                                const m = summary(axis, set as number[]);
                                return (
                                    <td key={axis.id} className="num border-t border-line-strong px-2 py-1.5 text-[12px] text-muted-foreground">
                                        {m === null ? '' : formatValue(axis.format, m)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tfoot>
            </table>
            {rows.length === 0 && <p className="p-6 text-center text-[13px] text-faint">No rows match the current selection.</p>}
        </div>
    );
}
