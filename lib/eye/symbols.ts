import { MAX_SELECTED } from '@/lib/eye/types';

// Same shape the watchlist accepts: AAPL, BRK.B, BINANCE:BTCUSDT.
export const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;

// Comma-separated list from the address bar: uppercased, de-duplicated, invalid entries dropped, capped at 12.
export function parseSymbols(value: string | string[] | null | undefined): string[] {
    const raw = Array.isArray(value) ? value.join(',') : value ?? '';
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const symbol = part.trim().toUpperCase();
        if (SYMBOL_PATTERN.test(symbol) && !out.includes(symbol)) out.push(symbol);
        if (out.length === MAX_SELECTED) break;
    }
    return out;
}
