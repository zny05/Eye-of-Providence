export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / len2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// xs[row * axisCount + axis] is the x of that row on that axis (NaN = missing). ys[axis] is the track's y.
// Segments touching a missing value are not hit targets.
export function nearestPolyline(
    xs: ArrayLike<number>,
    rowCount: number,
    axisCount: number,
    ys: ArrayLike<number>,
    px: number,
    py: number,
    threshold: number,
    skip?: (row: number) => boolean,
): number | null {
    let best: number | null = null;
    let bestDist = threshold;
    for (let r = 0; r < rowCount; r++) {
        if (skip?.(r)) continue;
        const base = r * axisCount;
        for (let a = 0; a < axisCount - 1; a++) {
            const x1 = xs[base + a];
            const x2 = xs[base + a + 1];
            if (Number.isNaN(x1) || Number.isNaN(x2)) continue;
            const d = distToSegment(px, py, x1, ys[a], x2, ys[a + 1]);
            if (d < bestDist) {
                bestDist = d;
                best = r;
            }
        }
    }
    return best;
}
