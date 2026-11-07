import { Suspense } from 'react';
import { Eye } from 'lucide-react';
import EyeWorkbench from '@/components/eye/EyeWorkbench';
import Panel from '@/components/Panel';
import { getEyeExplain } from '@/lib/actions/eye.actions';
import { parseSymbols } from '@/lib/eye/symbols';

export const metadata = { title: 'Eye of Omniscience' };

async function Content({ symbols }: { symbols: string[] }) {
    return <EyeWorkbench data={await getEyeExplain(symbols)} />;
}

function Loading({ count }: { count: number }) {
    return (
        <Panel title="Why it moved" sub={count ? `Reading ${count} instrument${count === 1 ? '' : 's'} and their peers from Finnhub…` : 'Loading…'}>
            <div className="flex flex-col gap-3 p-4" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => <span key={i} className="h-10 animate-pulse rounded-lg bg-hover" />)}
            </div>
        </Panel>
    );
}

export default async function EyePage({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
    const { s } = await searchParams;
    const symbols = parseSymbols(s);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title flex items-center gap-2"><Eye className="size-6 text-brand-ink" /> Eye of Omniscience</h1>
                    <p className="page-sub">Select up to 12 instruments and see which valuation, growth, quality, momentum, size, sentiment and symbolic factors line up with what the price did.</p>
                </div>
            </header>
            <Suspense fallback={<Loading count={symbols.length} />}>
                <Content symbols={symbols} />
            </Suspense>
        </>
    );
}
