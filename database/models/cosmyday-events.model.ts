import { Schema, model, models, type Document } from 'mongoose';

/**
 * Persisted CosmyDay sky-event feed (DB-first cache for the Eye symbolic layer).
 * English: one snapshot for the whole upcoming-events window, TTL 12h, status tri-state (200 / 429 / 0).
 * 中文：整段“未来天象事件”缓存为一份快照，TTL 12 小时，状态三态（200 / 429 / 0）。
 *
 * Why: Eye's a_next_event_days / a_event_count_7d axes read CosmyDay's /events/upcoming feed.
 * That feed changes only when the provider extends its covered window, so a 12h Mongo cache
 * means the steady state is a pure read; the live call runs only on miss or from the Inngest
 * warm-up job. CosmyDay is a single small personal server — never hammer it with per-page-load
 * requests. Attribution: data supplied by CosmyDay (Swiss Ephemeris).
 */
export interface CosmyDayEvent {
    id?: string;
    date: string; // 'YYYY-MM-DD'
    kind?: string;
    headline?: string;
    short?: string;
    long?: string;
    sign?: string;
    importance?: number;
    time_et?: string | null;
}

const CosmyDayEventSchema = new Schema(
    {
        id: { type: String, default: null },
        date: { type: String, required: true },
        kind: { type: String, default: null },
        headline: { type: String, default: null },
        short: { type: String, default: null },
        long: { type: String, default: null },
        sign: { type: String, default: null },
        importance: { type: Number, default: null },
        time_et: { type: String, default: null },
    },
    { _id: false }
);

const CosmyDayEventsSnapshotSchema = new Schema(
    {
        // Single-document cache: always the same `key`.
        key: { type: String, required: true, unique: true, index: true, default: 'cosmyday-events' },
        fetchedAt: { type: Date, required: true, default: Date.now },
        // 200 = good payload; 429 = rate-limited marker; 0 = network/JSON error marker.
        status: { type: Number, required: true, default: 200 },
        windowDays: { type: Number, default: 30 },
        minImportance: { type: Number, default: 60 },
        events: { type: [CosmyDayEventSchema], default: [] },
        // Covers metadata from the provider (Swiss Ephemeris provenance).
        covers: { type: Schema.Types.Mixed, default: null },
        rawError: { type: String, default: null },
        // TTL index target: the document disappears 12h after fetchedAt (expireAfterSeconds: 0).
        ttlExpiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0, background: true } },
    },
    { timestamps: false }
);

export const COSMYDAY_EVENTS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const COSMYDAY_EVENTS_ID = 'cosmyday-events';

interface CosmyDayEventsSnapshotDocument extends Document {
    key: string;
    fetchedAt: Date;
    status: number;
    windowDays: number;
    minImportance: number;
    events: CosmyDayEvent[];
    covers: Record<string, unknown> | null;
    rawError: string | null;
    ttlExpiresAt: Date;
}

export const CosmyDayEventsSnapshot =
    models.CosmyDayEventsSnapshot ||
    model<CosmyDayEventsSnapshotDocument>('CosmyDayEventsSnapshot', CosmyDayEventsSnapshotSchema);

export type { CosmyDayEventsSnapshotDocument };
