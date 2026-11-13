#!/usr/bin/env node
// Rewrites root-absolute paths in the vendored who-are-you static build so they
// resolve under /who-are-you/ when served from OpenStock's own public/.
// Root-absolute paths ignore <base>, so they must be rewritten, not rebased.
// Run from OUTSIDE the submodule dir.
// Usage: node scripts/rewrite-who-are-you-paths.mjs public/who-are-you

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) { console.error("usage: node scripts/rewrite-who-are-you-paths.mjs <dir>"); process.exit(1); }

// Segments whose root-absolute URLs must be prefixed with /who-are-you/.
// External URLs (https://...) and Cloudflare-only paths (/cdn-cgi/trace,
// /api/*) are intentionally left alone: they fail gracefully in the page.
// Nested segments (zh-cn/stats/) are anchored by the FIRST segment after the
// quote, so each URL is rewritten exactly once — no double prefixing.
const SEG =
    "assets|zh-cn|zh-tw|de|es|fr|ja|ko|pt|ru|stats|r|" +
    "favicon\\.ico|favicon-32\\.png|apple-touch-icon\\.png|__who_tag";

// "SEG/..." and "SEG" (end of string) quoted with " or '.
// Tail handles: "/" (continues path), end of string, backtick/$ (template lit).
const BT = String.fromCharCode(96); // backtick, can't appear literally in template literal
const reQuoted = new RegExp(
    `(["'])\\/(${SEG})(\\/|$|${BT}|\\$\\{)`, "g"
);
const reUrl = new RegExp(`url\\(\\/(${SEG})`, "g");

let files = 0;
let changed = 0;

async function walk(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await walk(p); continue; }
        if (![".html", ".js", ".css"].includes(extname(p))) continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        let next = text
            .replace(reQuoted, (_m, q, seg, tail) => `${q}/who-are-you/${seg}${tail}`)
            .replace(reUrl, (_m, seg) => `url(/who-are-you/${seg}`);
        if (next !== text) {
            await writeFile(p, next, "utf8");
            changed++;
        }
        files++;
    }
}

await walk(ROOT);
console.log(`scanned ${files} text files, rewrote ${changed}`);
