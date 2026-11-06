import type { ValueFormat } from '@/lib/eye/types';

const compact = (n: number, digits = 1) => {
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}T`;
    if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
    return n.toFixed(digits);
};

export function formatValue(format: ValueFormat, value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    switch (format) {
        case 'score': return value.toFixed(0);
        case 'pct': return `${value.toFixed(1)}%`;
        case 'ratio': return value.toFixed(2);
        // Finnhub market cap is in USD millions
        case 'usdM': return `$${compact(value * 1e6)}`;
        default: return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
}

// Tick labels: short and unit-free.
export function formatTick(format: ValueFormat, value: number): string {
    if (format === 'usdM') return `$${compact(value * 1e6, 0)}`;
    if (format === 'pct') return `${Number(value.toFixed(1))}%`;
    return String(Number(value.toFixed(2)));
}
