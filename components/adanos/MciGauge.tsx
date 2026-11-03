'use client';

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MciGaugeProps {
    mci: number | null;
    label?: string;
}

/**
 * Renders the Market Confidence Index (0–100) as a color-coded gauge tile.
 * MCI is an OpenStock research indicator computed from locally persisted
 * Adanos sentiment snapshots — not a trading signal.
 */
export default function MciGauge({ mci, label = "Market confidence" }: MciGaugeProps) {
    const hasData = mci !== null;
    const value = hasData ? Math.round(mci) : 0;

    let fillColor: string;
    let IconComponent: React.ElementType = Minus;
    let iconClass = "text-faint";
    let verdict: string;

    if (!hasData) {
        fillColor = "bg-muted";
        verdict = "No data";
    } else if (value >= 70) {
        fillColor = "bg-up";
        IconComponent = TrendingUp;
        iconClass = "text-up";
        verdict = "Strong confidence";
    } else if (value >= 55) {
        fillColor = "bg-up/60";
        IconComponent = TrendingUp;
        iconClass = "text-up";
        verdict = "Cautiously positive";
    } else if (value >= 45) {
        fillColor = "bg-muted";
        verdict = "Neutral";
    } else if (value >= 30) {
        fillColor = "bg-down/60";
        IconComponent = TrendingDown;
        iconClass = "text-down";
        verdict = "Cautiously negative";
    } else {
        fillColor = "bg-down";
        IconComponent = TrendingDown;
        iconClass = "text-down";
        verdict = "Weak confidence";
    }

    return (
        <div className="bento-tile p-3">
            <div className="flex items-end gap-2 mb-1">
                <span className="kicker">{label}</span>
                <span className="ml-auto text-[12px] text-faint">{verdict}</span>
            </div>
            <div className="relative h-8 w-full rounded-full overflow-hidden border border-line mb-2">
                <div
                    className={cn('h-full transition-all duration-500', fillColor)}
                    style={{ width: hasData ? `${Math.min(100, Math.max(0, value))}%` : '0%' }}
                />
            </div>
            <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-foreground">
                    {hasData ? value : "—"}
                </span>
                <span className={cn('size-4 shrink-0', iconClass)}>
                    <IconComponent />
                </span>
            </div>
            <p className="text-[11px] text-faint mt-1">
                Research indicator · not investment advice
            </p>
        </div>
    );
}
