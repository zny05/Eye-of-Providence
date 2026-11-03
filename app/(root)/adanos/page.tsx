import { Suspense } from "react";
import Link from "next/link";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { getStockSentimentInsightsCached } from "@/lib/actions/adanos.actions";
import { computeMarketConfidenceIndex } from "@/lib/adanos/confidence-index";
import { AdanosSentimentSnapshot } from "@/database/models/adanos-sentiment.model";
import { connectToDatabase } from "@/database/mongoose";
import Panel from "@/components/Panel";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import MciGauge from "@/components/adanos/MciGauge";
import SentimentSourceRow from "@/components/adanos/SentimentSourceRow";
import { DEFAULT_MCI_WEIGHTS } from "@/lib/adanos/confidence-index";

const SOURCE_LABEL: Record<string, string> = {
    reddit: "Reddit",
    x: "X.com",
    news: "News",
    polymarket: "Polymarket",
    crypto: "Crypto (Reddit)",
};

async function SymbolMci({ symbol }: { symbol: string }) {
    const mci = await computeMarketConfidenceIndex(symbol, DEFAULT_MCI_WEIGHTS);

    return (
        <Panel
            title={symbol}
            sub="Market Confidence Index · Adanos sentiment"
            action={
                <Link href={`/stocks/${symbol.toLowerCase()}`} className="btn btn-sm btn-outline">
                    Open chart
                </Link>
            }
        >
            <MciGauge mci={mci.mci} label="Market confidence" />
            {mci.mci === null ? (
                <p className="text-[12px] text-faint text-center py-4">
                    No Adanos sentiment history for {symbol} yet. Run the collection job to start building
                    the index.
                </p>
            ) : (
                <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                        { label: "Attention", value: mci.components.attention.value },
                        { label: "Sentiment", value: mci.components.sentiment.value },
                        { label: "Prediction", value: mci.components.prediction.value },
                    ].map(({ label, value }) => (
                        <div key={label} className="p-2 rounded-lg bg-muted border border-line">
                            <p className="text-[11px] text-faint">{label}</p>
                            <p className="text-[13px] font-bold text-foreground">
                                {value === null ? "—" : value.toFixed(2)}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    );
}

async function SymbolSources({ symbol }: { symbol: string }) {
    await connectToDatabase();

    const latest = await AdanosSentimentSnapshot.aggregate([
        { $match: { symbol } },
        { $sort: { collectedAt: -1 } },
        { $group: { _id: "$source", doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
    ]);

    const rows = (latest as Array<{
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
        label: SOURCE_LABEL[doc.source] ?? doc.source,
        buzzScore: doc.buzzScore,
        sentimentScore: doc.sentimentScore,
        bullishPct: doc.bullishPct,
        bearishPct: doc.bearishPct,
        trend: doc.trend,
        mentions: doc.mentions,
        collectedAt: doc.collectedAt,
    }));

    if (rows.length === 0) {
        return (
            <Panel title={symbol} sub="Source breakdown · Adanos sentiment">
                <p className="text-[12px] text-faint text-center py-4">
                    No source data for {symbol} yet.
                </p>
            </Panel>
        );
    }

    return (
        <Panel title={symbol} sub="Source breakdown · Adanos sentiment">
            <ul className="row-list border-t border-line">
                {rows.map((row) => (
                    <SentimentSourceRow key={row.source} {...row} />
                ))}
            </ul>
        </Panel>
    );
}

async function SymbolSentimentCard({ symbol }: { symbol: string }) {
    const insight = await getStockSentimentInsightsCached(symbol);
    if (!insight) return null;
    return <StockSentimentCard insight={insight} />;
}

export default async function AdanosPage() {
    const items = await getUserWatchlist();
    const symbols: string[] = items.map((item: { symbol: string }) => item.symbol);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Adanos Market Sentiment</h1>
                    <p className="page-sub">
                        Market Confidence Index and per-source sentiment for the symbols you watch. Powered by
                        Adanos (Reddit, X.com, news, Polymarket).
                    </p>
                </div>
            </header>

            <section className="hatch">
                <div className="section-head">
                    <h2 className="section-title">Market confidence</h2>
                    <p className="section-sub">
                        OpenStock research indicator (0–100) computed from locally persisted Adanos snapshots.
                    </p>
                </div>
                <div className="bento gap-3">
                    {symbols.length === 0 ? (
                        <div className="bento-tile p-3 text-center">
                            <p className="text-faint">Watch a symbol to see its market confidence here.</p>
                        </div>
                    ) : (
                        symbols.map((symbol) => (
                            <Suspense key={symbol} fallback={<MciGauge mci={null} label={symbol} />}>
                                <SymbolMci symbol={symbol} />
                            </Suspense>
                        ))
                    )}
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <div className="section-head">
                    <h2 className="section-title">Source breakdown</h2>
                    <p className="section-sub">
                        Latest snapshot per data source for each watched symbol.
                    </p>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    {symbols.length === 0 ? (
                        <div className="col-span-2 text-center py-8 text-faint">
                            No symbols watched yet. Add symbols to your watchlist to populate this view.
                        </div>
                    ) : (
                        symbols.map((symbol) => (
                            <Suspense key={symbol} fallback={null}>
                                <SymbolSources symbol={symbol} />
                            </Suspense>
                        ))
                    )}
                </div>
            </section>

            <section className="hatch">
                <div className="section-head">
                    <h2 className="section-title">Sentiment card (stock pages)</h2>
                    <p className="section-sub">
                        The existing per-symbol sentiment card, shown for your first four watched symbols.
                    </p>
                </div>
                <div className="bento gap-3">
                    {symbols.length === 0 ? (
                        <div className="bento-tile p-3 text-center">
                            <p className="text-faint">Watch a symbol to see its sentiment card here.</p>
                        </div>
                    ) : (
                        symbols.slice(0, 4).map((symbol) => (
                            <Suspense key={symbol} fallback={null}>
                                <Panel title={symbol} sub="Sentiment (live via Adanos API)">
                                    <SymbolSentimentCard symbol={symbol} />
                                </Panel>
                            </Suspense>
                        ))
                    )}
                </div>
            </section>
        </>
    );
}
