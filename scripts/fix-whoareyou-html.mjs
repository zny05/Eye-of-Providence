#!/usr/bin/env node
// One clean pass over vendored who-are-you HTML files:
//   1) logo-light.svg / logo-dark.svg -> logo-light.png / logo-dark.png  (Eye of Omniscience icon)
//   2) data-paths: &quot;/zh-cn/  ->  &quot;/who-are-you/zh-cn/  etc.
// Uses plain string replace — no regex, no sed &-trap.
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = process.argv[2] || "public/who-are-you";

const SEGS = ["zh-cn","zh-tw","de","es","fr","ja","ko","pt","ru"];

let files = 0;
let logoRepl = 0;
let pathRepl = 0;

async function walk(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await walk(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        let next = text
            .replace(/logo-light\.svg/g, "logo-light.png")
            .replace(/logo-dark\.svg/g, "logo-dark.png");
        for (const seg of SEGS) {
            next = next.split(`&quot;/${seg}/`).join(`&quot;/who-are-you/${seg}/`);
        }
        if (next !== text) {
            await writeFile(p, next, "utf8");
            logoRepl += (text.match(/logo-light\.svg|logo-dark\.svg/g) || []).length;
            for (const seg of SEGS) {
                pathRepl += (text.match(new RegExp(`&quot;/${seg}/`, "g")) || []).length;
            }
            files++;
        }
    }
}

await walk(ROOT);
console.log(`HTML files updated: ${files}, logo svg->png replacements: ${logoRepl}, data-paths rewritten: ${pathRepl}`);

// verify
let badLogo = 0;
let badPath = 0;
async function verify(dir) {
    for (const name of await readdir(dir)) {
        const p = dir + "/" + name;
        const st = await stat(p);
        if (st.isDirectory()) { await verify(p); continue; }
        if (extname(p) !== ".html") continue;
        let text;
        try { text = await readFile(p, "utf8"); } catch { continue; }
        if (text.includes("logo-light.svg") || text.includes("logo-dark.svg")) badLogo++;
        for (const seg of SEGS) {
            if (text.includes(`&quot;/${seg}/`) && !text.includes(`&quot;/who-are-you/${seg}/`)) badPath++;
        }
    }
}
await verify(ROOT);
console.log("remaining logo-light/dark.svg refs:", badLogo);
console.log("remaining non-rewritten data-paths:", badPath);
