"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import WatchlistButton from "@/components/WatchlistButton";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { formatNumber, formatPrice } from "@/lib/utils";

type Row = {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    currency: string;
    name: string;
    logo: string | undefined | null;
    marketCap: number | undefined | null;
    peRatio: number;
};

interface GroupWatchlistTableProps {
    initialRows: Row[];
    groupId: string;
}

export default function GroupWatchlistTable({ initialRows }: GroupWatchlistTableProps) {
    const [rows, setRows] = useState<Row[]>(initialRows);
    const [error, setError] = useState<string | null>(null);
    const live = useLiveQuotes(rows.map((r) => r.symbol));

    // Server re-renders (after group switch) replace the local copy
    useEffect(() => {
        setRows(initialRows);
        setError(null);
    }, [initialRows]);

    const merged = rows.map((r) => {
        const q = live[r.symbol];
        return q?.c ? { ...r, price: q.c, change: q.d ?? r.change, changePercent: q.dp ?? r.changePercent } : r;
    });

    if (error) {
        return (
            <div className="empty-state py-12">
                <p className="text-faint">{error}</p>
            </div>
        );
    }

    if (merged.length === 0) {
        return (
            <div className="empty-state py-12">
                <span className="empty-icon"><Star className="size-5" /></span>
                <h3>该组合尚未添加股票</h3>
                <p className="max-w-sm text-faint">前往股票详情页添加到组合，或在组合管理页面添加。</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-[14px] border border-line">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Company</th>
                        <th className="is-num">Price</th>
                        <th className="is-num">Today</th>
                        <th className="is-num">Change</th>
                        <th className="is-num">Market cap</th>
                        <th className="w-[88px]"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {merged.map((row) => (
                        <tr key={row.symbol}>
                            <td className="max-w-[320px]">
                                <Link href={`/stocks/${row.symbol}`} className="group flex items-center gap-3">
                                    {row.logo ? (
                                        <span className="logo-well"><img src={row.logo} alt="" className="size-full object-contain p-1" /></span>
                                    ) : (
                                        <span className="logo-well is-empty">{row.symbol[0]}</span>
                                    )}
                                    <span className="min-w-0">
                                        <span className="block truncate font-semibold text-foreground group-hover:text-brand-ink transition-colors" title={row.name}>{row.name}</span>
                                        <span className="mono block text-[12px] text-faint">{row.symbol}</span>
                                    </span>
                                </Link>
                            </td>
                            <td className="is-num font-semibold text-foreground">
                                <PriceFlash value={row.price} className="px-1">{row.price ? formatPrice(row.price, row.currency) : '—'}</PriceFlash>
                            </td>
                            <td className="is-num"><ChangePill value={row.price ? row.changePercent : null} /></td>
                            <td className="is-num text-muted-foreground">{row.price ? `${row.change > 0 ? '+' : ''}${row.change.toFixed(2)}` : '—'}</td>
                            <td className="is-num text-muted-foreground">{row.marketCap ? formatNumber(row.marketCap) : '—'}</td>
                            <td>
                                <WatchlistButton
                                    symbol={row.symbol}
                                    company={row.name}
                                    isInWatchlist
                                    variant="icon"
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
