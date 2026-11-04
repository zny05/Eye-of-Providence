'use client';

import { cn } from "@/lib/utils";

interface SentimentSourceRowProps {
    source: string;
    label: string;
    buzzScore: number | null;
    sentimentScore: number | null;
    trend: string | null;
    mentions: number | null;
    // Accepted but not rendered yet: bullish/bearish split and collection time
    // are kept on the source row for future breakdowns.
    bullishPct?: number | null;
    bearishPct?: number | null;
    collectedAt?: Date | null;
}

function formatScore(value: number | null, suffix: string): string {
    if (value === null) return "—";
    return `${value.toFixed(1)}${suffix}`;
}

function formatCompactNumber(value: number): string {
    return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(value);
}

const TREND_CLASS: Record<string, string> = {
    rising: "is-up",
    falling: "is-down",
    stable: "",
};

export default function SentimentSourceRow({
    source,
    label,
    buzzScore,
    sentimentScore,
    trend,
    mentions,
}: SentimentSourceRowProps) {
    const trendClass = TREND_CLASS[trend ?? ""] ?? "";

    let sentimentLabel = "No signal";
    if (sentimentScore !== null) {
        sentimentLabel = sentimentScore > 0.15 ? "Bullish" : sentimentScore < -0.15 ? "Bearish" : "Neutral";
    }

    return (
        <li className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-2.5 border-b border-line last:border-0">
            <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{label}</p>
                <p className="truncate text-[11px] text-faint">
                    {source} · {formatCompactNumber(mentions ?? 0)} {source === "polymarket" ? "trades" : "mentions"}
                </p>
            </div>
            <div className="text-right min-w-[72px]">
                <p className="font-semibold text-foreground">{formatScore(buzzScore, "")}</p>
                <p className="text-[11px] text-faint">buzz</p>
            </div>
            <div className="text-right min-w-[64px]">
                <p className={cn('font-semibold text-[12px]', sentimentScore === null ? 'text-faint' : 'text-foreground')}>
                    {formatScore(sentimentScore, "")}
                </p>
                <p className="text-[11px] text-faint">{sentimentLabel}</p>
            </div>
            <span className={cn('pill w-[96px] justify-center capitalize', trendClass)}>
                {trend !== null ? `${trend}` : "—"}
            </span>
        </li>
    );
}
