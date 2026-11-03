import { Suspense } from "react";
import { cookies } from "next/headers";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import GroupSelector from "@/components/watchlist/GroupSelector";
import GroupWatchlistTable from "@/components/watchlist/GroupWatchlistTable";
import { getWatchlistGroup } from "@/lib/actions/watchlist-group.actions";
import { getWatchlistData } from "@/lib/actions/finnhub.actions";
import {
    CRYPTO_HEATMAP_CONFIG,
    STOCK_HEATMAP_CONFIG,
    marketOverviewConfig,
    marketQuotesConfig,
    timelineConfig,
} from "@/lib/constants";
import { MARKETS, MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { getSession } from "@/lib/better-auth/auth";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

// Widgets come from TradingView (live, no Finnhub quota) and render immediately; the tiles stream in.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ market?: string; groupId?: string }> }) {
    const { market: requested, groupId } = await searchParams;
    // Explicit choice, then the remembered one, then the market of the user's country
    const saved = (await cookies()).get(MARKET_COOKIE)?.value;
    const market = getMarket(requested ?? saved ?? marketForCountry((await getSession())?.user.country));
    const open = isMarketOpen(market);
    const native = market.pulse.some((p) => p.finnhub);
    const heatmap = market.heatmap === 'stocks'
        ? { script: 'stock-heatmap.js', config: STOCK_HEATMAP_CONFIG, title: 'S&P 500 heatmap' }
        : market.heatmap === 'crypto'
            ? { script: 'crypto-coins-heatmap.js', config: CRYPTO_HEATMAP_CONFIG, title: 'Crypto heatmap' }
            : null;

    const selectedGroup = await getWatchlistGroup(groupId);

    // Fetch quotes server-side so the client component only handles live quote updates
    const groupQuotes = selectedGroup?.symbols.length > 0 ? await getWatchlistData(selectedGroup.symbols) : [];

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Markets</h1>
                    <p className="page-sub">{market.name} · {open ? 'open now' : 'closed now'} · {market.feed.toLowerCase()} data</p>
                </div>
            </header>

            <MarketSwitcher active={market.id} openIds={MARKETS.filter((m) => isMarketOpen(m)).map((m) => m.id)} />

            <section className="hatch">
                <div className="section-head">
                    <div>
                        <h2 className="section-title">Pulse</h2>
                        <p className="section-sub">{native ? 'Our shared quotes via Finnhub' : `${market.feed} quotes via TradingView`}</p>
                    </div>
                    {native && <DataFreshness />}
                </div>
                {/* Keyed so switching markets swaps the tiles instead of reusing old widgets */}
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} />
                </Suspense>
            </section>

            {/* My Watchlist Groups */}
            <section className="hatch mt-6">
                <div className="flex flex-col gap-3">
                    <div className="section-head">
                        <h2 className="section-title">我的股票组合</h2>
                        <p className="section-sub">
                            在不同组合之间切换，查看该组合下的股票行情。每个组合独立保存，仅对你可见。
                        </p>
                    </div>
                    <GroupSelector />
                    {selectedGroup && (
                        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)]">
                            <Panel title={selectedGroup.name} sub={`${selectedGroup.symbols.length} 只股票`}>
                                <Suspense fallback={<div className="h-64 flex items-center justify-center text-faint">加载行情…</div>}>
                                    <GroupWatchlistTable
                                        initialRows={groupQuotes}
                                        groupId={selectedGroup._id}
                                    />
                                </Suspense>
                            </Panel>
                        </div>
                    )}
                    {!selectedGroup && (
                        <div className="flex items-center justify-center py-16">
                            <p className="text-faint">正在加载组合…</p>
                        </div>
                    )}
                </div>
            </section>

            <div key={market.id} className="flex flex-col gap-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <Panel title="Leaders" sub="12-month trend by group">
                        <TradingViewWidget scriptUrl={`${scriptUrl}market-overview.js`} config={marketOverviewConfig(market.groups)} height={560} />
                    </Panel>
                    {heatmap ? (
                        <Panel title={heatmap.title} sub="Sized by market cap, coloured by today’s move">
                            <TradingViewWidget scriptUrl={`${scriptUrl}${heatmap.script}`} config={heatmap.config} height={560} allowExpand />
                        </Panel>
                    ) : (
                        <Panel title="Quotes" sub={`${market.name} leaders by group`}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    {heatmap && (
                        <Panel title="Quotes" sub={`${market.name} leaders by group`}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                    <Panel title="Top stories" sub="Newest first" className={heatmap ? '' : 'xl:col-span-2'}>
                        <TradingViewWidget scriptUrl={`${scriptUrl}timeline.js`} config={timelineConfig(market.news)} height={560} />
                    </Panel>
                </div>
            </div>
        </>
    );
}
