'use client';

import React from 'react';
import { X } from 'lucide-react';
import { formatValue } from '@/lib/eye/format';
import { EYE_THEME } from '@/lib/eye/pcp/color-scale';
import type { PcpAxis, PcpTable } from '@/lib/eye/types';

interface Props {
    axes: PcpAxis[]; // every axis, not only the displayed ones
    table: PcpTable;
    pupil: string;
    // Cluster score axes that feed the equal-weight tilt (stock view only).
    tiltAxisIds: string[];
    onClose: () => void;
}

// Explanatory decomposition under an equal-weight lens: c = W * (S - 50) / 50 (plan §8.1). Not a forecast.
export default function PupilPanel({ axes, table, pupil, tiltAxisIds, onClose }: Props) {
    const row = table.ids.indexOf(pupil);
    if (row < 0) return null;

    const tilt = tiltAxisIds
        .map((id) => ({ axis: axes.find((a) => a.id === id)!, score: table.columns[id]?.[row] }))
        .filter((e): e is { axis: PcpAxis; score: number } => !!e.axis && typeof e.score === 'number');
    const weight = tilt.length ? 1 / tilt.length : 0;
    const contributions = tilt.map((e) => ({ ...e, c: (weight * (e.score - 50)) / 50 }));
    const net = contributions.reduce((s, e) => s + e.c, 0);

    return (
        <div className="flex flex-col gap-3 p-3.5" aria-label="Selected instrument">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="kicker text-brand-ink">Pupil</p>
                    <h3 className="truncate text-[15px] font-bold text-foreground">{table.labels[row]}</h3>
                    <p className="truncate text-[12px] text-faint">
                        {table.labels[row] !== pupil && <span className="mono mr-1.5">{pupil}</span>}
                        {table.group[row] ?? ''}
                    </p>
                </div>
                <button type="button" className="icon-btn" onClick={onClose} aria-label="Clear selection"><X /></button>
            </div>

            {contributions.length > 0 && (
                <div>
                    <div className="flex items-baseline justify-between">
                        <span className="text-[12px] font-semibold text-muted-foreground">Net tilt (equal-weight lens)</span>
                        <span className="num text-[15px] font-bold" style={{ color: net >= 0 ? EYE_THEME.pos : EYE_THEME.neg }}>
                            {net >= 0 ? '▲ +' : '▼ '}{net.toFixed(2)}
                        </span>
                    </div>
                    <ul className="mt-2 flex flex-col gap-1.5">
                        {contributions.map(({ axis, c }) => {
                            // Full bar half = the largest contribution one axis can make (1 / k).
                            const frac = Math.min(1, Math.abs(c) * tilt.length);
                            return (
                                <li key={axis.id} className="grid grid-cols-[84px_1fr_44px] items-center gap-2 text-[12px]">
                                    <span className="truncate text-faint">{axis.labelEn}</span>
                                    <span className="relative h-2 rounded-full bg-white/5">
                                        <span className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                                        <span
                                            className="absolute inset-y-0 rounded-full"
                                            style={{ background: c >= 0 ? EYE_THEME.pos : EYE_THEME.neg, left: `${c >= 0 ? 50 : 50 - frac * 50}%`, width: `${frac * 50}%` }}
                                        />
                                    </span>
                                    <span className="num text-right">{c >= 0 ? '▲' : '▼'} {Math.abs(c).toFixed(2)}</span>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-[11px] leading-snug text-faint">
                        Explanatory decomposition of percentile scores against the group, not a forecast and not investment advice.
                    </p>
                </div>
            )}

            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px]">
                {axes.filter((a) => a.kind !== 'categorical').map((a) => {
                    const v = table.columns[a.id]?.[row];
                    const raw = table.raw[a.id]?.[row];
                    return (
                        <React.Fragment key={a.id}>
                            <dt className="truncate text-faint" title={a.labelZh}>{a.labelEn}</dt>
                            <dd className="num text-right text-foreground">
                                {formatValue(a.format, typeof v === 'number' ? v : null)}
                                {a.isScore && typeof raw === 'number' && <span className="text-faint"> ({formatValue(a.rawFormat ?? 'num', raw)})</span>}
                            </dd>
                        </React.Fragment>
                    );
                })}
            </dl>
        </div>
    );
}
