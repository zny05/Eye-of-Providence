import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface WatchlistGroupItem extends Document {
    userId: string;
    name: string;
    symbols: string[];
    isDefault: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
}

const WatchlistGroupSchema = new Schema<WatchlistGroupItem>(
    {
        userId: { type: String, required: true, index: true },
        name: { type: String, required: true, trim: true, maxlength: 50 },
        symbols: [{ type: String, trim: true, uppercase: true }],
        isDefault: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// One user cannot have two groups with the same name.
WatchlistGroupSchema.index({ userId: 1, name: 1 }, { unique: true });

export const WatchlistGroup: Model<WatchlistGroupItem> =
    (models?.WatchlistGroup as Model<WatchlistGroupItem>) ||
    model<WatchlistGroupItem>('WatchlistGroup', WatchlistGroupSchema);
