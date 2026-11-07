import { Schema, model, models, type Document } from 'mongoose';

/**
 * Persisted Finnhub /stock/metric?metric=all payloads (DB-first cache for Eye + watchlist).
 * English: one snapshot per symbol, TTL 12h, status tri-state (200 / 429 / 0 for network/JSON error).
 * 中文：每个标的存一份 Finnhub metric=all 载荷快照，TTL 12 小时，状态三态（200 / 429 / 0 网络或 JSON 错误）。
 *
 * Why: /eye and the watchlist can fan out 50+ Finnhub calls on one page load and hit the free
 * plan's 60/min limit on the first user. Persisting here means the steady state is a pure Mongo
 * read; the live Finnhub call only runs on miss or from the Inngest warm-up job. API keys stay
 * inside their 60/min allowance, and a 429 never clobbers a previously-good 200 snapshot.
 */
const FinnhubMetricSnapshotSchema = new Schema(
    {
        symbol: { type: String, required: true, unique: true, index: true, uppercase: true },
        fetchedAt: { type: Date, required: true, default: Date.now },
        // 200 = good payload; 429 = rate-limited marker; 0 = network/JSON error marker.
        status: { type: Number, required: true, default: 200 },
        // Full Finnhub `metric` object as returned by /stock/metric?metric=all (Mixed).
        metric: { type: Schema.Types.Mixed, default: {} },
        // Full /stock/profile2 payload for marketCap / industry fallback (Mixed, optional).
        profile: { type: Schema.Types.Mixed, default: null },
        // Latest /stock/recommendation rows (Mixed, optional).
        recommendation: { type: Schema.Types.Mixed, default: null },
        rawError: { type: String, default: null },
        // TTL index target: the document disappears 12h after fetchedAt (expireAfterSeconds: 0).
        // TTL 索引目标：fetchedAt 起 12 小时后文档自动删除。
        ttlExpiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0, background: true } },
    },
    { timestamps: false }
);

export const FINNHUB_METRIC_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface FinnhubMetricSnapshotDocument extends Document {
    symbol: string;
    fetchedAt: Date;
    status: number;
    metric: Record<string, number | string | null | undefined>;
    profile: Record<string, unknown> | null;
    recommendation: Array<Record<string, unknown>> | null;
    rawError: string | null;
    ttlExpiresAt: Date;
    _id: unknown;
}

export const FinnhubMetricSnapshot =
    models.FinnhubMetricSnapshot ||
    model<FinnhubMetricSnapshotDocument>('FinnhubMetricSnapshot', FinnhubMetricSnapshotSchema);

export type { FinnhubMetricSnapshotDocument };
