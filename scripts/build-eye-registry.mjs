// Parses §4 of the industry knowledge base into lib/eye/registry/industries.json and validates it.
// Usage: node scripts/build-eye-registry.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'docs', '行业细分经济驱动指标与权重知识库.md');
const OUT = path.join(root, 'lib', 'eye', 'registry', 'industries.json');
const VERSION = 'kb-2026-11-06';
const FACTORS = ['DEM', 'RATE', 'COST', 'LAB', 'POLICY', 'SPEC'];
// §8 of the source: per-sector counts, 130 in total.
const EXPECTED_COUNTS = {
    'Basic Materials': 13, 'Communication Services': 5, 'Consumer Cyclical': 17, 'Consumer Defensive': 10,
    Energy: 8, Financial: 14, Healthcare: 10, Industrials: 22, 'Real Estate': 12, Technology: 13, Utilities: 6,
};

const lines = readFileSync(SOURCE, 'utf8').split(/\r?\n/);
const sectionStart = (n) => lines.findIndex((l) => l.startsWith(`## ${n}.`));
const slice = (from, to) => lines.slice(sectionStart(from), sectionStart(to));
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const slug = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const errors = [];
const notes = [];

const packIds = new Set(
    slice(2, 3).filter((l) => l.startsWith('|')).map((l) => cells(l)[0]).filter((c) => /^[A-Z_]+$/.test(c)),
);

const sectors = [];
const industries = [];
let current = null;
for (const line of slice(4, 5)) {
    const heading = line.match(/^### (.+?)（(.+?)）\s*$/);
    if (heading) {
        current = { id: slug(heading[1]), en: heading[1], zh: heading[2] };
        sectors.push(current);
        continue;
    }
    if (!current || !line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length !== 8 || !/^\d+$/.test(c[1])) continue;
    const weights = Object.fromEntries(FACTORS.map((f, i) => [f, Number(c[i + 1])]));
    industries.push({ profileId: slug(c[0]), sector: current.id, name: c[0], weights, packId: c[7] });
}

if (industries.length !== 130) errors.push(`expected 130 industries, found ${industries.length}`);
const seen = new Set();
for (const row of industries) {
    const sum = Object.values(row.weights).reduce((a, b) => a + b, 0);
    if (sum !== 100) errors.push(`${row.name}: weights sum to ${sum}`);
    if (!packIds.has(row.packId)) errors.push(`${row.name}: unknown pack ${row.packId}`);
    if (seen.has(row.profileId)) errors.push(`duplicate profileId ${row.profileId}`);
    seen.add(row.profileId);
}
for (const s of sectors) {
    s.count = industries.filter((i) => i.sector === s.id).length;
    if (EXPECTED_COUNTS[s.en] !== s.count) errors.push(`sector ${s.en}: expected ${EXPECTED_COUNTS[s.en]}, found ${s.count}`);
}
for (const pack of packIds) {
    if (!industries.some((i) => i.packId === pack)) notes.push(`pack ${pack} is defined but no industry uses it`);
}

if (errors.length) {
    console.error(`Registry validation failed:\n- ${errors.join('\n- ')}`);
    process.exit(1);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ version: VERSION, sectors, industries }, null, 2)}\n`);
console.log(`Wrote ${industries.length} industries in ${sectors.length} sectors to ${path.relative(root, OUT)}`);
for (const n of notes) console.log(`note: ${n}`);
