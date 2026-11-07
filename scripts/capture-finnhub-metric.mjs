// Diagnostic: capture a real Finnhub payload so we can verify which metric keys
// actually exist on the free plan. Paste-safe — never prints the API token.
//
// Usage:
//   node scripts/capture-finnhub-metric.mjs [SYMBOL]
// Defaults to AAPL. Reads FINNHUB_API_KEYS / FINNHUB_API_KEY from .env.
//
// Checks four endpoints that Eye of Omniscience reads:
//   GET /stock/metric?symbol=<S>&metric=all      (v_ey, growth, quality, momentum, pb/ps)
//   GET /stock/recommendation?symbol=<S>         (x_analyst primary)
//   GET /stock/price-target?symbol=<S>           (x_analyst fallback)
//   GET /stock/profile2?symbol=<S>               (s_mcap primary, industry)
//
// Output: HTTP status + sorted key list (or full JSON for non-metric endpoints).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYMBOL = (process.argv[2] || 'AAPL').toUpperCase();
const FETCH_TIMEOUT_MS = 5000;
const BASE_URL = 'https://finnhub.io/api/v1';

function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return {};
    const out = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}

const env = { ...process.env, ...loadEnv() };
const KEYS = (env.FINNHUB_API_KEYS || env.NEXT_PUBLIC_FINNHUB_API_KEY || env.FINNHUB_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

if (KEYS.length === 0) {
    console.error('No Finnhub API key found. Set FINNHUB_API_KEY / FINNHUB_API_KEYS in .env');
    process.exit(1);
}

// What the Eye module currently reads (lib/eye/types.ts FACTOR_METRIC_KEYS).
const EXPECTED = [
    'peTTM', 'pbQuarterly', 'pbAnnual', 'psTTM', 'dividendYieldIndicatedAnnual',
    'revenueGrowthTTMYoy', 'epsGrowthTTMYoy', 'roeTTM', 'grossMarginTTM', 'netProfitMarginTTM',
    'totalDebt/totalEquityQuarterly', '26WeekPriceReturnDaily', '13WeekPriceReturnDaily',
    '52WeekPriceReturnDaily', '1MonthPriceReturnDaily', '52WeekHigh', '52WeekLow', 'beta',
    '10DayAverageTradingVolume',
];

async function getJson(url) {
    let lastErr;
    for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i];
        try {
            const res = await fetch(url, {
                headers: { 'X-Finnhub-Token': key },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (res.status === 429 && i < KEYS.length - 1) continue; // next key
            const text = await res.text().catch(() => '');
            let body = text;
            try { body = JSON.parse(text); } catch { /* keep as text */ }
            return { status: res.status, body };
        } catch (e) {
            lastErr = e;
        }
    }
    return { status: 0, body: `fetch failed: ${lastErr?.message ?? lastErr}` };
}

function header(title, extra = '') {
    console.log(`\n=== ${title}${extra ? ` (${extra})` : ''} ===`);
}

async function main() {
    console.log(`Capturing Finnhub payloads for ${SYMBOL} using ${KEYS.length} key(s) (token hidden)`);
    console.log('NOTE: this is the ground truth — compare EXPECTED keys below against real keys.');

    header(`GET /stock/metric?symbol=${SYMBOL}&metric=all`);
    const metricRes = await getJson(`${BASE_URL}/stock/metric?symbol=${encodeURIComponent(SYMBOL)}&metric=all`);
    console.log(`HTTP ${metricRes.status}`);
    if (metricRes.status === 200 && metricRes.body && typeof metricRes.body === 'object') {
        const metric = metricRes.body.metric || {};
        const keys = Object.keys(metric).sort();
        console.log(`metric keys (${keys.length}):`);
        for (const k of keys) console.log(`  ${k}: ${JSON.stringify(metric[k])}`);
        console.log('\nEXPECTED (from lib/eye/types.ts) vs PRESENT:');
        for (const k of EXPECTED) {
            const present = k in metric;
            console.log(`  ${present ? 'OK     ' : 'MISSING'} ${k}${present ? ` = ${JSON.stringify(metric[k])}` : ''}`);
        }
        // Extra keys worth noting (e.g. marketCap inside metric).
        const interesting = keys.filter((k) => /marketCap|sharesOutstanding|totalDebt|currentPrice/i.test(k));
        if (interesting.length) {
            console.log('\nExtra interesting keys:');
            for (const k of interesting) console.log(`  ${k}: ${JSON.stringify(metric[k])}`);
        }
    } else {
        console.log('body:', typeof metricRes.body === 'string' ? metricRes.body : JSON.stringify(metricRes.body, null, 2));
    }

    header(`GET /stock/recommendation?symbol=${SYMBOL}`);
    const recRes = await getJson(`${BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(SYMBOL)}`);
    console.log(`HTTP ${recRes.status}`);
    console.log(Array.isArray(recRes.body) ? `rows: ${recRes.body.length}\nlatest: ${JSON.stringify(recRes.body[0] ?? null)}` : JSON.stringify(recRes.body, null, 2));

    header(`GET /stock/price-target?symbol=${SYMBOL}`);
    const ptRes = await getJson(`${BASE_URL}/stock/price-target?symbol=${encodeURIComponent(SYMBOL)}`);
    console.log(`HTTP ${ptRes.status}`);
    console.log(ptRes.body && typeof ptRes.body === 'object' ? JSON.stringify(ptRes.body, null, 2) : String(ptRes.body));

    header(`GET /stock/profile2?symbol=${SYMBOL}`);
    const profRes = await getJson(`${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(SYMBOL)}`);
    console.log(`HTTP ${profRes.status}`);
    if (profRes.body && typeof profRes.body === 'object') {
        const p = profRes.body;
        console.log(JSON.stringify({
            name: p.name, ticker: p.ticker, finnhubIndustry: p.finnhubIndustry,
            marketCapitalization: p.marketCapitalization, sharesOutstanding: p.sharesOutstanding,
            currency: p.currency, exchange: p.exchange,
        }, null, 2));
        console.log('\nMarket cap source: profile2.marketCapitalization =', p.marketCapitalization ?? 'null');
    } else {
        console.log(String(profRes.body));
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
