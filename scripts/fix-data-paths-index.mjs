#!/usr/bin/env node
// Rewrite data-paths language URLs to explicit index.html paths so language
// switching lands on a real file (Next.js does not do directory indexing for
// public/ files).
//
//   &quot;/&quot;                            -> &quot;/who-are-you/index.html&quot;   (en)
//   &quot;/who-are-you/zh-cn/&quot;          -> &quot;/who-are-you/zh-cn/index.html&quot;
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = process.argv[2] || "public/who-are-you";

const SEGS = ["zh-cn","zh-tw","de","es","fr","ja","ko","pt","ru"];

let files = 0;
let fixed = 0;

async function walk(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await walk(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        let next = text
            // en root -> explicit index.html
            .replace(/&quot;\/&quot;/g, "&quot;/who-are-you/index.html&quot;")
            // every other lang dir -> add index.html
            .replace(/\/&quot;/g, "/index.html&quot;");
        if (next !== text) {
            await writeFile(p, next, "utf8");
            fixed += 1;
            files += 1;
        }
    }
}

await walk(ROOT);
console.log(`HTML files fixed: ${files}, data-paths entries fixed: ${fixed}`);

// verify: every data-paths value should end in index.html&quot;
let bad = 0;
async function verify(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await verify(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        const m = text.match(/data-paths="([^"]*)"/);
        if (!m) continue;
        const parsed = JSON.parse(m[1].replace(/&quot;/g, '"'));
        for (const [lang, url] of Object.entries(parsed)) {
            if (!url.endsWith("index.html")) {
                bad++;
                console.log("STILL BAD:", p, lang, "->", url);
            }
        }
    }
}
await verify(ROOT);
console.log("entries not ending in index.html:", bad);
