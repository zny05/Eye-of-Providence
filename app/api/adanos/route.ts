import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/better-auth/auth";
import { isRateLimited } from "@/lib/rate-limit";
import { computeMarketConfidenceIndex } from "@/lib/adanos/confidence-index";
import { AdanosSentimentSnapshot } from "@/database/models/adanos-sentiment.model";
import { connectToDatabase } from "@/database/mongoose";

const MAX_SYMBOLS = 25;
const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,20}$/;

/**
 * Market Confidence Index endpoint.
 *
 * Returns the OpenStock-computed MCI plus the latest Adanos snapshot per
 * source for each requested symbol. Data is read from locally persisted
 * snapshots (populated by the collection job / action), so serving a page
 * costs no Adanos API requests — the free plan's 250 requests/month are spent
 * only on collection, not on every render.
 *
 * Signed-in only and symbol-capped, mirroring /api/quotes.
 */
export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const symbols = [...new Set(
        (req.nextUrl.searchParams.get("symbols") ?? "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => SYMBOL_PATTERN.test(s)),
    )].slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
        return NextResponse.json({ items: [] });
    }

    if (await isRateLimited(`adanos:mci:user:${session.user.id}`, 120, 60, symbols.length)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    await connectToDatabase();

    const items = await Promise.all(symbols.map(async (symbol) => {
        const mci = await computeMarketConfidenceIndex(symbol);

        // Latest snapshot per source for the card breakdown.
        const latest = await AdanosSentimentSnapshot.aggregate([
            { $match: { symbol } },
            { $sort: { collectedAt: -1 } },
            {
                $group: {
                    _id: "$source",
                    doc: { $first: "$$ROOT" },
                },
            },
            {
                $replaceRoot: { newRoot: "$doc" },
            },
        ]);

        const sources = (latest as Array<{
            source: string;
            buzzScore: number | null;
            sentimentScore: number | null;
            bullishPct: number | null;
            bearishPct: number | null;
            trend: string | null;
            mentions: number | null;
            collectedAt: Date;
        }>).map((doc) => ({
            source: doc.source,
            buzzScore: doc.buzzScore,
            sentimentScore: doc.sentimentScore,
            bullishPct: doc.bullishPct,
            bearishPct: doc.bearishPct,
            trend: doc.trend,
            mentions: doc.mentions,
            collectedAt: doc.collectedAt,
        }));

        return {
            symbol,
            mci: mci.mci,
            components: mci.components,
            sources,
            sourceCount: mci.sources,
        };
    }));

    return NextResponse.json({ items }, {
        headers: { "Cache-Control": "private, max-age=60" },
    });
}
