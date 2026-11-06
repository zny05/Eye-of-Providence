// Percentile score in [0, 100] across the universe; ties share the average rank. A value is only scored when
// at least `minValid` rows have one: a rank among one or two peers says nothing.
export function percentileScores(values: (number | null)[], opts: { higherIsBetter?: boolean; minValid?: number } = {}): (number | null)[] {
    const { higherIsBetter = true, minValid = 3 } = opts;
    const indexed = values
        .map((v, i) => ({ v: v !== null && Number.isFinite(v) ? (higherIsBetter ? v : -v) : null, i }))
        .filter((e): e is { v: number; i: number } => e.v !== null)
        .sort((a, b) => a.v - b.v);

    const out: (number | null)[] = values.map(() => null);
    if (indexed.length < minValid) return out;

    let start = 0;
    while (start < indexed.length) {
        let end = start;
        while (end + 1 < indexed.length && indexed[end + 1].v === indexed[start].v) end++;
        const rank = (start + end) / 2;
        const score = (100 * rank) / (indexed.length - 1);
        for (let k = start; k <= end; k++) out[indexed[k].i] = score;
        start = end + 1;
    }
    return out;
}

// Mean of the available values; null when none (never invented, per plan §0).
export function meanOfAvailable(values: (number | null)[]): number | null {
    const present = values.filter((v): v is number => v !== null);
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}
