// Persist the Eye of Omniscience instrument selection across module switches.
//
// The selection lives in the URL (?s=AAPL,MSFT) as the source of truth, but
// the sidebar only links to bare /eye. Without persistence, switching to
// another module and back loses the picks. We mirror the URL into
// localStorage and have the sidebar append it back on click.
//
// Also persists the axis layout (?axes=) so Reset-to-default stays a
// deliberate action, not an accident of navigation.

import { AXIS_CATALOG_IDS } from './explain-view';
import { parseSymbols } from './symbols';
import { MAX_AXES, MIN_AXES } from './types';

export const EYE_SYMBOLS_KEY = 'eye:selected-symbols';
export const EYE_AXES_KEY = 'eye:selected-axes';

export function readPersistedSymbols(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(EYE_SYMBOLS_KEY);
        if (!raw) return [];
        return parseSymbols(raw);
    } catch {
        return [];
    }
}

export function writePersistedSymbols(symbols: string[]): void {
    if (typeof window === 'undefined') return;
    try {
        if (symbols.length) window.localStorage.setItem(EYE_SYMBOLS_KEY, symbols.join(','));
        else window.localStorage.removeItem(EYE_SYMBOLS_KEY);
    } catch {
        // Private mode / storage full: persistence is best-effort only.
    }
}

export function readPersistedAxes(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(EYE_AXES_KEY);
        if (!raw) return [];
        const ids = raw.split(',').filter((id, i, all) => AXIS_CATALOG_IDS.includes(id) && all.indexOf(id) === i).slice(0, MAX_AXES);
        return ids.length >= MIN_AXES ? ids : [];
    } catch {
        return [];
    }
}

export function writePersistedAxes(axisIds: string[]): void {
    if (typeof window === 'undefined') return;
    try {
        if (axisIds.length) window.localStorage.setItem(EYE_AXES_KEY, axisIds.join(','));
        else window.localStorage.removeItem(EYE_AXES_KEY);
    } catch {
        // Private mode / storage full: persistence is best-effort only.
    }
}

/** href for the sidebar Eye link, carrying the persisted selection/axes back. */
export function eyeHrefWithPersistedState(): string {
    const symbols = readPersistedSymbols();
    const axes = readPersistedAxes();
    const qs = new URLSearchParams();
    if (symbols.length) qs.set('s', symbols.join(','));
    if (axes.length) qs.set('axes', axes.join(','));
    const q = qs.toString();
    return q ? `/eye?${q}` : '/eye';
}
