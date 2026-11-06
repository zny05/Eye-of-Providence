import { Suspense } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import EyeWorkbench from '@/components/eye/EyeWorkbench';
import Panel from '@/components/Panel';
import { getEyeStockView } from '@/lib/actions/eye.actions';
import { buildIndustryView, INDUSTRY_DEFAULT_AXES } from '@/lib/eye/industry-view';
import { STOCK_DEFAULT_AXES } from '@/lib/eye/stock-view';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Eye of Omniscience' };

const DISCLAIMER =
    'Eye of Omniscience shows multi-dimensional scores and explanatory decompositions built from public data and prior weights. It is for research and education only, is not investment advice, and does not forecast prices or returns.';

async function StockView() {
    const view = await getEyeStockView();

    if (view.table.ids.length === 0) {
        return (
            <Panel title="Watchlist cross-section">
                <div className="flex flex-col items-center gap-2 p-10 text-center text-[13px] text-faint">
                    <Eye className="size-6 text-brand-ink" />
                    {view.requested === 0
                        ? 'Your watchlist is empty. Star a few US stocks to see them side by side.'
                        : `None of your ${view.requested} watchlist symbols has readable fundamentals (Finnhub free covers US stocks only).`}
                    <Link href="/eye?v=industries" className="btn btn-sm btn-outline mt-2">Explore industry weight structure</Link>
                </div>
            </Panel>
        );
    }

    const notes = [
        `Scores are percentile ranks within your ${view.table.ids.length} watchlist symbols, as of ${new Date(view.asOf).toLocaleString()}. A metric needs at least 3 readings to be ranked.`,
        'Finnhub metric field names are not yet verified against the live response; axes marked "unverified" may be empty.',
        'Composite is the equal-weight mean of the four cluster scores. Industry is Finnhub’s own classification, not the 130-industry knowledge base.',
        ...(view.skipped.length ? [`Skipped (no fundamentals available): ${view.skipped.join(', ')}.`] : []),
    ];

    return (
        <EyeWorkbench
            key="stocks"
            view="stocks"
            axes={view.axes}
            table={view.table}
            defaultAxes={STOCK_DEFAULT_AXES}
            defaultColor="composite"
            tiltAxisIds={['k_value', 'k_growth', 'k_quality', 'k_momentum']}
            notes={notes}
        />
    );
}

function Loading() {
    return (
        <Panel title="Watchlist cross-section" sub="Reading fundamentals from Finnhub…">
            <div className="flex flex-col gap-3 p-4" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => <span key={i} className="h-10 animate-pulse rounded-lg bg-hover" />)}
            </div>
        </Panel>
    );
}

export default async function EyePage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
    const { v } = await searchParams;
    const view = v === 'industries' ? 'industries' : 'stocks';
    const industry = view === 'industries' ? buildIndustryView() : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title flex items-center gap-2"><Eye className="size-6 text-brand-ink" /> Eye of Omniscience</h1>
                    <p className="page-sub">High-dimensional view of stocks and industries: brush any axis to find the cluster you care about.</p>
                </div>
                <nav className="flex gap-1" aria-label="Data view">
                    <Link href="/eye" className={cn('btn btn-sm btn-ghost', view === 'stocks' && 'is-on')} aria-current={view === 'stocks' ? 'page' : undefined}>Watchlist stocks</Link>
                    <Link href="/eye?v=industries" className={cn('btn btn-sm btn-ghost', view === 'industries' && 'is-on')} aria-current={view === 'industries' ? 'page' : undefined}>Industry weights</Link>
                </nav>
            </header>

            {industry ? (
                <EyeWorkbench
                    key="industries"
                    view="industries"
                    axes={industry.axes}
                    table={industry.table}
                    defaultAxes={INDUSTRY_DEFAULT_AXES}
                    defaultColor="group"
                    tiltAxisIds={[]}
                    notes={[
                        `Prior weights from the industry knowledge base (${industry.version}). They are expert priors, not regression coefficients.`,
                        'Weights show how strongly each driver factor is assumed to matter for an industry; they are not scores. Macro factor scores need the FRED data pipeline, which is not built yet.',
                    ]}
                />
            ) : (
                <Suspense fallback={<Loading />}>
                    <StockView />
                </Suspense>
            )}

            <p className="px-1 text-[11.5px] leading-snug text-faint">{DISCLAIMER}</p>
        </>
    );
}
