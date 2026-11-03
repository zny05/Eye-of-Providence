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

let nextKeyIndex = 0;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IN_FLIGHT_PER_KEY = 2;
const MAX_CACHE_ENTRIES = 500;
const FAILURE_TTL_MS = 60_000;

// Cache TTL: realtime mode = 60s, cached mode = 3600s
const CACHE_TTL_SECONDS = process.env.NEXT_PUBLIC_OPENSTOCK_DATA_MODE === 'realtime' ? 60 : 3600;

class RecentFailure extends Error {}

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
    if (ADANOS_KEYS.length === 0) throw new Error('No Adanos API key configured (ADANOS_API_KEY)');
    let res: Response | null = null;
    for (let attempt = 0; attempt < ADANOS_KEYS.length; attempt++) {
        const key = ADANOS_KEYS[nextKeyIndex++ % ADANOS_KEYS.length];
        res = await fetch(url, {
            headers: { 'X-API-Key': key },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            cache: 'no-store',
        });
        if (res.status !== 429) break;
    }
    return res!;
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

export { fetchAdanosJSON, ADANOS_BASE_URL, ADANOS_KEYS, RecentFailure };
