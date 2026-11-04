/**
 * Rate-limited HTTP client for Adanos API.
 *
 * Adanos free tier: 250 requests/month shared across ALL endpoints, 100/min rate limit.
 * Mirrors the proven Finnhub client in lib/actions/finnhub.actions.ts:
 *   - API key pool (comma-separated ADANOS_API_KEYS, rotated per request)
 *   - In-flight request queue (max 2 per key)
 *   - Per-URL deduplication (one network call per URL at a time)
 *   - Stale-while-revalidate cache
 *   - 429 → next key rotation
 *   - Failure cooldown (60s): a failing URL is not retried for 60 seconds
 *
 * Cache TTL follows DATA_MODE: realtime = 60s, cached = 3600s.
 */

const ADANOS_BASE_URL = (process.env.ADANOS_API_BASE_URL || 'https://api.adanos.org').replace(/\/$/, '');

const ADANOS_KEYS = (process.env.ADANOS_API_KEYS || process.env.ADANOS_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

let currentKeyIndex = 0;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IN_FLIGHT_PER_KEY = 2;
const MAX_CACHE_ENTRIES = 500;
const FAILURE_TTL_MS = 60_000;

// Cache TTL: realtime mode = 60s, cached mode = 3600s
const CACHE_TTL_SECONDS = process.env.NEXT_PUBLIC_OPENSTOCK_DATA_MODE === 'realtime' ? 60 : 3600;

// Per-key monthly quota exhaustion: key index -> reset timestamp (ms).
// When a key returns "Monthly API limit exceeded", we mark that key exhausted
// until its reset_at date and switch to the next key.
const keyExhaustedUntil = new Map<number, number>();

// Global cooldown when ALL keys are exhausted. Set to the earliest reset_at
// among all keys so we know when to retry.
let monthlyQuotaExhaustedUntil = 0;

class RecentFailure extends Error {}
class MonthlyQuotaExceeded extends Error {}

function parseResetAt(body: string): number | null {
    try {
        const match = body.match(/"reset_at"\s*:?\s*"([^"]+)"/);
        if (!match) return null;
        const ts = new Date(match[1]).getTime();
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

function getNextAvailableKeyIndex(): number | null {
    const start = currentKeyIndex % ADANOS_KEYS.length;
    for (let i = 0; i < ADANOS_KEYS.length; i++) {
        const idx = (start + i) % ADANOS_KEYS.length;
        const exhaustedUntil = keyExhaustedUntil.get(idx) || 0;
        if (Date.now() >= exhaustedUntil) return idx;
    }
    return null;
}

function getEarliestReset(): number | null {
    let earliest: number | null = null;
    for (const [, until] of keyExhaustedUntil) {
        if (earliest === null || until < earliest) earliest = until;
    }
    return earliest;
}

function isMonthlyQuotaExhausted(): boolean {
    // Only block when ALL keys are exhausted. Individual key exhaustion is
    // handled by getNextAvailableKeyIndex() skipping exhausted keys.
    return ADANOS_KEYS.every((_, i) => {
        const until = keyExhaustedUntil.get(i) || 0;
        return Date.now() < until;
    });
}

function markKeyExhausted(keyIndex: number, resetAt: number) {
    keyExhaustedUntil.set(keyIndex, resetAt);
    console.error(`Adanos key ${keyIndex + 1}/${ADANOS_KEYS.length} monthly quota exhausted. No requests with this key until ${new Date(resetAt).toISOString()}.`);

    const allExhausted = ADANOS_KEYS.every((_, i) => {
        const until = keyExhaustedUntil.get(i) || 0;
        return Date.now() < until;
    });

    if (allExhausted) {
        const earliest = getEarliestReset()!;
        monthlyQuotaExhaustedUntil = earliest;
        console.error(`Adanos monthly quota exhausted across all keys. No Adanos requests until ${new Date(earliest).toISOString()}.`);
    }
}

let activeRequests = 0;
const waitingForSlot: (() => void)[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { value: unknown; freshUntil: number; failed?: boolean }>();

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (activeRequests >= MAX_IN_FLIGHT_PER_KEY * Math.max(1, ADANOS_KEYS.length)) {
        await new Promise<void>((resolve) => waitingForSlot.push(resolve));
    }
    activeRequests++;
    try {
        return await run();
    } finally {
        activeRequests--;
        waitingForSlot.shift()?.();
    }
}

async function fetchWithKeyPool(url: string): Promise<Response> {
    if (isMonthlyQuotaExhausted()) throw new MonthlyQuotaExceeded('Adanos monthly quota exhausted');

    if (ADANOS_KEYS.length === 0) throw new Error('No Adanos API key configured (ADANOS_API_KEY)');

    let res: Response | null = null;
    let lastKeyIndex: number | null = null;

    for (let attempt = 0; attempt < ADANOS_KEYS.length; attempt++) {
        const keyIdx = getNextAvailableKeyIndex();
        if (keyIdx === null) break; // all keys exhausted

        lastKeyIndex = keyIdx;
        const key = ADANOS_KEYS[keyIdx];
        res = await fetch(url, {
            headers: { 'X-API-Key': key },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            cache: 'no-store',
        });

        if (res.status !== 429) break; // success or non-quota error

        // Check if this is a monthly quota exceeded response for this specific key
        try {
            const body = await res.clone().text();
            if (body.includes('Monthly API limit exceeded')) {
                const resetAt = parseResetAt(body);
                if (resetAt !== null) {
                    markKeyExhausted(keyIdx, resetAt);
                } else {
                    // Fallback: 1-hour cooldown if reset_at not parseable
                    markKeyExhausted(keyIdx, Date.now() + 60 * 60 * 1000);
                }
                continue; // try next key
            }
        } catch {
            // ignore body parse errors, continue to next key
        }

        // 429 but not monthly quota (e.g. rate limit): rotate key and continue
        currentKeyIndex = (keyIdx + 1) % ADANOS_KEYS.length;
    }

    if (!res) throw new MonthlyQuotaExceeded('Adanos monthly quota exhausted: all keys unavailable');
    return res;
}

async function request<T>(url: string): Promise<T> {
    let pending = inFlight.get(url) as Promise<T> | undefined;
    if (!pending) {
        pending = withSlot(async () => {
            const res = await fetchWithKeyPool(url);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Fetch failed ${res.status}: ${text}`);
            }
            return (await res.json()) as T;
        }).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
    }
    return pending;
}

/**
 * Fetch JSON from Adanos with rate limiting and cache.
 * `revalidateSeconds` defaults to CACHE_TTL_SECONDS (60s realtime / 3600s cached).
 */
async function fetchAdanosJSON<T>(url: string, revalidateSeconds = CACHE_TTL_SECONDS): Promise<T> {
    if (!revalidateSeconds) return request<T>(url);

    const store = (entry: { value: unknown; freshUntil: number; failed?: boolean }) => {
        if (responseCache.size >= MAX_CACHE_ENTRIES) {
            responseCache.delete(responseCache.keys().next().value!);
        }
        responseCache.set(url, entry);
    };

    const refresh = () => request<T>(url).then(
        (value) => {
            store({ value, freshUntil: Date.now() + revalidateSeconds * 1000 });
            return value;
        },
        (error) => {
            const existing = responseCache.get(url);
            store(existing && !existing.failed
                ? { value: existing.value, freshUntil: Date.now() + FAILURE_TTL_MS }
                : { value: null, freshUntil: Date.now() + FAILURE_TTL_MS, failed: true });
            throw error;
        }
    );

    const hit = responseCache.get(url);
    if (!hit || (hit.failed && hit.freshUntil < Date.now())) return refresh();
    if (hit.failed) throw new RecentFailure(`Adanos request failed recently: ${url}`);
    if (hit.freshUntil < Date.now()) refresh().catch(() => { /* keep serving the stale value */ });
    return hit.value as T;
}

export { fetchAdanosJSON, ADANOS_BASE_URL, ADANOS_KEYS, RecentFailure, MonthlyQuotaExceeded };
