#!/usr/bin/env node
// Fix data-paths language URLs in vendored who-are-you HTML files.
// The sed pass damaged data-paths into:
//   &quot;/zh-cn/quot;/who-are-you/zh-cn/
// Repair to:
//   &quot;/who-are-you/zh-cn/
// Also handle any intact (undamaged) &quot;/SEG/ that the first pass missed.
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = process.argv[2] || "public/who-are-you";

const SEGS = ["zh-cn","zh-tw","de","es","fr","ja","ko","pt","ru"];
const SEG_RE = SEGS.join("|");

// damaged: &quot;/SEG/quot;/who-are-you/SEG/  ->  &quot;/who-are-you/SEG/
const damageRe = new RegExp(
    `&quot;/(${SEG_RE})/quot;/who-are-you/${SEG_RE}/`, "g"
);
// intact: &quot;/SEG/  ->  &quot;/who-are-you/SEG/
const intactRe = new RegExp(
    `&quot;/(${SEG_RE})/`, "g"
);

let files = 0;
let repaired = 0;
let rewritten = 0;

async function walk(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await walk(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        let next = text
            .replace(damageRe, (_m, a, b) => `&quot;/who-are-you/${a}/`)
            .replace(intactRe, (_m, seg) => `&quot;/who-are-you/${seg}/`);
        if (next !== text) {
            await writeFile(p, next, "utf8");
            const beforeDmg = (text.match(damageRe) || []).length;
            const afterIntact = (next.match(intactRe) || []).length;
            const beforeIntact = (text.match(intactRe) || []).length;
            repaired += beforeDmg;
            rewritten += Math.max(0, afterIntact - beforeIntact);
            files++;
        }
    }
}

await walk(ROOT);
console.log(`HTML files fixed: ${files}, sed-damage repaired: ${repaired}, intact paths rewritten: ${rewritten}`);

// verify none remain broken: any &quot;/SEG/ not preceded by /who-are-you/
let bad = 0;
async function verify(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await verify(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        for (const seg of SEGS) {
            const re = new RegExp(`&quot;/(${seg})/`, "g");
            let m;
            while ((m = re.exec(text)) !== null) {
                const before = text.slice(Math.max(0, m.index - 20), m.index);
                if (!before.includes("who-are-you/")) {
                    bad++;
                    console.log("STILL BROKEN:", p, seg, "->", text.slice(m.index, m.index+40));
                }
            }
        }
    }
}
await verify(ROOT);
console.log("still broken:", bad);
