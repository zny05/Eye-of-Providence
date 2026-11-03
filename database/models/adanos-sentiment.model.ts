import { Schema, model, models, type Document, type Model } from 'mongoose';

export type AdanosSentimentSource = 'reddit' | 'x' | 'news' | 'polymarket' | 'crypto';

export interface IAdanosSentimentSnapshot extends Document {
    symbol: string;
    source: AdanosSentimentSource;
    collectedAt: Date;
    buzzScore: number | null;
    sentimentScore: number | null;
    bullishPct: number | null;
    bearishPct: number | null;
    trend: 'rising' | 'falling' | 'stable' | null;
    mentions: number | null;
    rawJson: Record<string, unknown>;
}

// One normalized snapshot of a single Adanos data source for a single symbol.
// OpenStock persists these (via an Inngest collection job) so the Market
// Confidence Index can be computed from local history instead of calling the
// Adanos API on every page load — the free plan only allows 250 requests/month,
// shared across every endpoint.
const AdanosSentimentSnapshotSchema = new Schema<IAdanosSentimentSnapshot>(
    {
        symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
        source: { type: String, required: true, enum: ['reddit', 'x', 'news', 'polymarket', 'crypto'] },
        collectedAt: { type: Date, required: true, default: Date.now, index: true },
        buzzScore: { type: Number, required: false },
        sentimentScore: { type: Number, required: false },
        bullishPct: { type: Number, required: false },
        bearishPct: { type: Number, required: false },
        trend: { type: String, enum: ['rising', 'falling', 'stable'], required: false },
        mentions: { type: Number, required: false },
        rawJson: { type: Schema.Types.Mixed, required: true, default: {} },
    },
    { timestamps: true }
);

// Keep at most one snapshot per symbol + source per collection run.
AdanosSentimentSnapshotSchema.index({ symbol: 1, source: 1, collectedAt: 1 });

export const AdanosSentimentSnapshot: Model<IAdanosSentimentSnapshot> =
    (models?.AdanosSentimentSnapshot as Model<IAdanosSentimentSnapshot>) ||
    model<IAdanosSentimentSnapshot>('AdanosSentimentSnapshot', AdanosSentimentSnapshotSchema);
