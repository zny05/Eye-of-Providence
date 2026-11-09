// CosmyDay sky-event feed — DB-first access for the Eye symbolic layer.
// Source: https://cosmyday.com/api-docs  (Swiss Ephemeris, free, no key, commercial use with attribution).
// Endpoints used: GET /events/upcoming (the only one that can give a_next_event_days / a_event_count_7d).
// Everything else in the symbolic layer (星座 / 赤纬 / 速度 / 月相) is computed locally from astronomy-engine.

import { connectToDatabase } from '@/database/mongoose';
import { CosmyDayEventsSnapshot, COSMYDAY_EVENTS_ID, COSMYDAY_EVENTS_TTL_MS, type CosmyDayEvent } from '@/database/models/cosmyday-events.model';

const BASE = 'https://api.cosmyday.com';
const WINDOW_DAYS = 30;
const MIN_IMPORTANCE = 60;
const FETCH_TIMEOUT_MS = 10_000; // CosmyDay runs on a single small server — be lenient with slow responses.

export interface CosmyDaySnapshot {
    events: CosmyDayEvent[];
    covers: Record<string, unknown> | null;
    fetchedAt: Date | null;
    fromCache: boolean;
    error?: string;
}

const EMPTY: CosmyDaySnapshot = { events: [], covers: null, fetchedAt: null, fromCache: false };

function toNumberDays(eventDate: string, now: Date): number | null {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const d = new Date(`${eventDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Read the cached CosmyDay event feed from Mongo. Never hits the network.
 * Returns status 200 snapshots younger than 12h; otherwise null (means: caller should backfill).
 */
export async function getCosmyDayEventsFromDb(): Promise<CosmyDaySnapshot | null> {
    try {
        await connectToDatabase();
        const doc = await CosmyDayEventsSnapshot.findOne({ key: COSMYDAY_EVENTS_ID }).lean() as unknown as {
            status: number; fetchedAt: Date; events: CosmyDayEvent[]; covers: Record<string, unknown> | null;
        } | null;
        if (!doc || doc.status !== 200) return null;
        if (Date.now() - new Date(doc.fetchedAt).getTime() > COSMYDAY_EVENTS_TTL_MS) return null;
        return { events: doc.events ?? [], covers: doc.covers ?? null, fetchedAt: new Date(doc.fetchedAt), fromCache: true };
    } catch (error) {
        console.error('Error reading CosmyDay events cache', error);
        return null;
    }
}

async function writeCosmyDaySnapshot(events: CosmyDayEvent[], covers: Record<string, unknown> | null, status: number, rawError: string | null): Promise<void> {
    try {
        await connectToDatabase();
        const now = new Date();
        // Never let a failed scrape clobber a good 200 snapshot: only write 200 payloads,
        // or a marker when no good snapshot exists at all.
        if (status !== 200) {
            const existing = await CosmyDayEventsSnapshot.findOne({ key: COSMYDAY_EVENTS_ID, status: 200 }).lean();
            if (existing) return;
        }
        await CosmyDayEventsSnapshot.findOneAndUpdate(
            { key: COSMYDAY_EVENTS_ID },
            {
                $set: {
                    fetchedAt: now,
                    status,
                    windowDays: WINDOW_DAYS,
                    minImportance: MIN_IMPORTANCE,
                    events,
                    covers,
                    rawError,
                    ttlExpiresAt: new Date(now.getTime() + COSMYDAY_EVENTS_TTL_MS),
                },
            },
            { upsert: true, new: true, runValidators: true },
        );
    } catch (error) {
        console.error('CosmyDay snapshot upsert failed', error);
    }
}

/**
 * Live fetch of the CosmyDay upcoming-events feed. Only called on cache miss or from the
 * Inngest warm-up job — never per page load in steady state.
 */
export async function fetchCosmyDayEventsLive(): Promise<CosmyDaySnapshot> {
    const url = `${BASE}/events/upcoming?days=${WINDOW_DAYS}&min_importance=${MIN_IMPORTANCE}`;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'OpenStock-EyeOfOmniscience/1.0 (+https://github.com/zny05/Eye-of-Providence)' } });
        } finally {
            clearTimeout(timer);
        }
        if (res.status === 429) {
            await writeCosmyDaySnapshot([], null, 429, 'rate-limited');
            return { ...EMPTY, error: 'rate-limited' };
        }
        if (!res.ok) {
            await writeCosmyDaySnapshot([], null, 0, `HTTP ${res.status}`);
            return { ...EMPTY, error: `HTTP ${res.status}` };
        }
        const json = (await res.json()) as { events?: CosmyDayEvent[]; covers?: Record<string, unknown> };
        const events = Array.isArray(json.events) ? json.events : [];
        const covers = json.covers ?? null;
        await writeCosmyDaySnapshot(events, covers, 200, null);
        return { events, covers, fetchedAt: new Date(), fromCache: false };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeCosmyDaySnapshot([], null, 0, message);
        return { ...EMPTY, error: message };
    }
}

/** DB-first: serve from Mongo; on miss, backfill from CosmyDay once and re-read. */
export async function getCosmyDayEvents(): Promise<CosmyDaySnapshot> {
    const cached = await getCosmyDayEventsFromDb();
    if (cached) return cached;
    return fetchCosmyDayEventsLive();
}

/**
 * Force-refresh used by the Inngest warm-up job: always calls the live feed and rewrites the cache.
 * Exported for lib/inngest/functions.ts (warmCosmyDayEventsCacheJob, cron every 6h).
 */
export async function warmCosmyDayEventsCache(): Promise<CosmyDaySnapshot> {
    return fetchCosmyDayEventsLive();
}

/** Distance (days) to the soonest upcoming sky event, or null when the feed is empty. */
export function nextEventDays(snapshot: CosmyDaySnapshot, now: Date = new Date()): number | null {
    const future = snapshot.events
        .map((e) => toNumberDays(e.date, now))
        .filter((d): d is number => d !== null && d >= 0);
    return future.length ? Math.min(...future) : null;
}

/** How many upcoming sky events land in the next 7 days (a_event_count_7d axis). */
export function eventCountInDays(snapshot: CosmyDaySnapshot, days: number, now: Date = new Date()): number {
    return snapshot.events.filter((e) => {
        const d = toNumberDays(e.date, now);
        return d !== null && d >= 0 && d <= days;
    }).length;
}
