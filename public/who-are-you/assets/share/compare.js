// Compare mode every 1ms.dog tool can use: two results of the same tool side by side, each row's change and whether
// it got better or worse, an overall verdict, the preview title of a compare link, and the share card's middle for the
// share dialog (share.js). Tools copy it to /assets/share/ with the rest of the folder and load it only on a compare
// link; 1ms-shell's check compares the copies with its own. Change it there, never in a tool. See docs/compare.md.
//
// The tool turns its two results into groups of rows (its `diff(a, b)`); everything else is done here. Rows only one
// side measured are counted in the verdict, not listed: the view compares what both measured.
//
//   const { compare } = await import("/who-are-you/assets/share/compare.js");
//   const c = compare({
//     lang: "zh-CN",
//     a: { ts, sub: show => "日本 · 代理" },   // the two sides: a before (or theirs), b after (or mine). ts: when it
//     b: { ts, sub: "美国 · 本地" },           //   was measured; sub: where from, text or show => text (the share box)
//     stats: [row, …],          // up to 3 key numbers, shown as cards (optional)
//     uses: [row, …],           // what the result means in everyday use, before and after (optional)
//     groups: [{ name, rows: [row, …] }, …],   // in the tool's own order; changed rows come first in each group
//     words: "speed",           // "speed": faster/slower (latency, bandwidth); "plain": better/worse
//   });
//   c.renderHead(el);           // verdict, its detail and the two sides (A, B), for the tool's banner (c.headHTML():
//                               //   the same as a string, for the tool's Worker to put in the page before it is sent)
//   await c.render(el);         // key numbers, uses and the groups (loads compare.css first)
//   share({ …, text: () => c.text, height: c.height, draw: c.draw });   // the same, on the share card
//
// row: { id, name, a, b, unit: "ms", better: "lower" | "higher", fmt: v => "12.4", tol: { abs: 20, rel: 0.3 },
//        text: [a text, b text], tier: v => "t2" (the CSS variable that colors b in the key numbers and uses: the
//        tool's own speed colors) }
//   a, b: the value on each side; null = measured, no answer (✕); undefined = that side didn't measure it.
//   The rows show only the change: a bar from the middle, left (green) when better, right (red) when worse, as long
//   as the log of how many times it changed (8× fills it); unchanged rows get no bar and stay grey. Speed colors stay
//   on the key numbers and uses, where they say how fast it is overall, as on the tool's own page.
//   A change within tol (absolute ms, or relative to the smaller value) counts as the same. Measure the tool's own
//   noise for tol: run it several times in a row and see how much the same row moves (docs/compare.md).
//
// Every row is one fixed height (SIZE), and the groups go into two columns by `columns()`, so a tool can reserve the
// view's exact height before it is drawn: its Worker imports this file (it touches no DOM until render) and works it
// out from the link, and writes the preview title with `verdict()`.

export const VERSION = 3;

const T = {
  en: { change: "Change", same: "About the same", lost: "No answer", back: "Answers", both_lost: "No answer either time",
    faster: "{x}× faster", slower: "{x}× slower", better: "better", worse: "worse",
    n_faster: "{n} faster", n_slower: "{n} slower", n_better: "{n} better", n_worse: "{n} worse", n_same: "{n} about the same", n_none: "{n} measured on one side only",
    all_same: "About the same both times", lost_h: "{s} stopped answering", back_h: "{s} answers again", join: ", ",
    dir_faster: "B is faster: {list}", dir_slower: "B is slower: {list}", dir_mixed: "Some faster, some slower: {list}",
    dir_better: "B is better: {list}", dir_worse: "B is worse: {list}", dir_mixed_p: "Some better, some worse: {list}",
    same_all: "Almost identical: all {n} within the margin of error", same_most: "Almost identical: {same} of {n} within the margin of error",
    noise: "{list}: likely a one-off blip.", uses_same: "No everyday use changed.", same_exit: "Same exit · {gap} later", ax_fast: "faster", ax_slow: "slower" },
  "zh-CN": { change: "变化", same: "差不多", lost: "连不上了", back: "能连上了", both_lost: "两次都没响应",
    faster: "快 {x} 倍", slower: "慢 {x} 倍", better: "变好", worse: "变差",
    n_faster: "{n} 项变快", n_slower: "{n} 项变慢", n_better: "{n} 项变好", n_worse: "{n} 项变差", n_same: "{n} 项差不多", n_none: "{n} 项只有一边测了",
    all_same: "两次结果差不多", lost_h: "{s} 连不上了", back_h: "{s} 能连上了", join: "，",
    dir_faster: "B 更快：{list}", dir_slower: "B 更慢：{list}", dir_mixed: "有快有慢：{list}",
    dir_better: "B 更好：{list}", dir_worse: "B 更差：{list}", dir_mixed_p: "有好有坏：{list}",
    same_all: "两次几乎一样：{n} 项的差别都在误差内", same_most: "两次几乎一样：{n} 项里 {same} 项差别在误差内",
    noise: "{list}：多半是偶发波动。", uses_same: "日常用途都没有变化。", same_exit: "同一出口 · 相隔 {gap}", ax_fast: "变快", ax_slow: "变慢" },
  "zh-TW": { change: "變化", same: "差不多", lost: "連不上了", back: "能連上了", both_lost: "兩次都沒回應",
    faster: "快 {x} 倍", slower: "慢 {x} 倍", better: "變好", worse: "變差",
    n_faster: "{n} 項變快", n_slower: "{n} 項變慢", n_better: "{n} 項變好", n_worse: "{n} 項變差", n_same: "{n} 項差不多", n_none: "{n} 項只有一邊測了",
    all_same: "兩次結果差不多", lost_h: "{s} 連不上了", back_h: "{s} 能連上了", join: "，",
    dir_faster: "B 較快：{list}", dir_slower: "B 較慢：{list}", dir_mixed: "有快有慢：{list}",
    dir_better: "B 較好：{list}", dir_worse: "B 較差：{list}", dir_mixed_p: "有好有壞：{list}",
    same_all: "兩次幾乎一樣：{n} 項的差別都在誤差內", same_most: "兩次幾乎一樣：{n} 項裡 {same} 項差別在誤差內",
    noise: "{list}：多半是偶發波動。", uses_same: "日常用途都沒有變化。", same_exit: "同一出口 · 相隔 {gap}", ax_fast: "變快", ax_slow: "變慢" },
  ja: { change: "変化", same: "ほぼ同じ", lost: "応答なし", back: "応答あり", both_lost: "2 回とも応答なし",
    faster: "{x} 倍速い", slower: "{x} 倍遅い", better: "改善", worse: "悪化",
    n_faster: "{n} 件速く", n_slower: "{n} 件遅く", n_better: "{n} 件改善", n_worse: "{n} 件悪化", n_same: "{n} 件ほぼ同じ", n_none: "{n} 件は片方のみ",
    all_same: "2 回ともほぼ同じ", lost_h: "{s} が応答しなくなった", back_h: "{s} が応答するようになった", join: "、",
    dir_faster: "B のほうが速い：{list}", dir_slower: "B のほうが遅い：{list}", dir_mixed: "速いものも遅いものも：{list}",
    dir_better: "B のほうが良い：{list}", dir_worse: "B のほうが悪い：{list}", dir_mixed_p: "良いものも悪いものも：{list}",
    same_all: "ほぼ同じ：{n} 件すべて誤差の範囲内", same_most: "ほぼ同じ：{n} 件中 {same} 件が誤差の範囲内",
    noise: "{list}：一時的な揺れの可能性が高い。", uses_same: "普段の用途はどれも変わらず。", same_exit: "同じ出口 · {gap}後", ax_fast: "速く", ax_slow: "遅く" },
  ko: { change: "변화", same: "비슷함", lost: "응답 없음", back: "응답함", both_lost: "두 번 모두 응답 없음",
    faster: "{x}배 빠름", slower: "{x}배 느림", better: "좋아짐", worse: "나빠짐",
    n_faster: "{n}개 빨라짐", n_slower: "{n}개 느려짐", n_better: "{n}개 좋아짐", n_worse: "{n}개 나빠짐", n_same: "{n}개 비슷함", n_none: "{n}개는 한쪽만 측정",
    all_same: "두 결과가 비슷함", lost_h: "{s} 응답 없음", back_h: "{s} 다시 응답", join: ", ",
    dir_faster: "B가 더 빠름: {list}", dir_slower: "B가 더 느림: {list}", dir_mixed: "빨라진 것도 느려진 것도 있음: {list}",
    dir_better: "B가 더 좋음: {list}", dir_worse: "B가 더 나쁨: {list}", dir_mixed_p: "좋아진 것도 나빠진 것도 있음: {list}",
    same_all: "거의 같음: {n}개 모두 오차 범위 안", same_most: "거의 같음: {n}개 중 {same}개가 오차 범위 안",
    noise: "{list}: 일시적인 흔들림일 가능성이 큽니다.", uses_same: "일상 용도는 모두 그대로입니다.", same_exit: "같은 출구 · {gap} 후", ax_fast: "빨라짐", ax_slow: "느려짐" },
  es: { change: "Cambio", same: "Casi igual", lost: "Sin respuesta", back: "Responde", both_lost: "Sin respuesta las dos veces",
    faster: "{x}× más rápido", slower: "{x}× más lento", better: "mejor", worse: "peor",
    n_faster: "{n} más rápidos", n_slower: "{n} más lentos", n_better: "{n} mejor", n_worse: "{n} peor", n_same: "{n} casi igual", n_none: "{n} solo en un lado",
    all_same: "Casi igual las dos veces", lost_h: "{s} dejó de responder", back_h: "{s} vuelve a responder", join: ", ",
    dir_faster: "B es más rápido: {list}", dir_slower: "B es más lento: {list}", dir_mixed: "Unos más rápidos, otros más lentos: {list}",
    dir_better: "B es mejor: {list}", dir_worse: "B es peor: {list}", dir_mixed_p: "Unos mejor, otros peor: {list}",
    same_all: "Casi idéntico: los {n} dentro del margen de error", same_most: "Casi idéntico: {same} de {n} dentro del margen de error",
    noise: "{list}: probablemente un pico aislado.", uses_same: "Ningún uso diario cambió.", same_exit: "Misma salida · {gap} después", ax_fast: "más rápido", ax_slow: "más lento" },
  fr: { change: "Écart", same: "Quasi identique", lost: "Plus de réponse", back: "Répond", both_lost: "Pas de réponse les deux fois",
    faster: "{x}× plus rapide", slower: "{x}× plus lent", better: "mieux", worse: "moins bien",
    n_faster: "{n} plus rapides", n_slower: "{n} plus lents", n_better: "{n} mieux", n_worse: "{n} moins bien", n_same: "{n} quasi identiques", n_none: "{n} d’un seul côté",
    all_same: "Quasi identique les deux fois", lost_h: "{s} ne répond plus", back_h: "{s} répond de nouveau", join: ", ",
    dir_faster: "B est plus rapide : {list}", dir_slower: "B est plus lent : {list}", dir_mixed: "Certains plus rapides, d’autres plus lents : {list}",
    dir_better: "B est meilleur : {list}", dir_worse: "B est moins bon : {list}", dir_mixed_p: "Certains mieux, d’autres moins bien : {list}",
    same_all: "Quasi identique : les {n} dans la marge d’erreur", same_most: "Quasi identique : {same} sur {n} dans la marge d’erreur",
    noise: "{list} : sans doute un pic passager.", uses_same: "Aucun usage courant n’a changé.", same_exit: "Même sortie · {gap} plus tard", ax_fast: "plus rapide", ax_slow: "plus lent" },
  de: { change: "Änderung", same: "Etwa gleich", lost: "Keine Antwort", back: "Antwortet", both_lost: "Beide Male keine Antwort",
    faster: "{x}× schneller", slower: "{x}× langsamer", better: "besser", worse: "schlechter",
    n_faster: "{n} schneller", n_slower: "{n} langsamer", n_better: "{n} besser", n_worse: "{n} schlechter", n_same: "{n} etwa gleich", n_none: "{n} nur auf einer Seite",
    all_same: "Beide Male etwa gleich", lost_h: "{s} antwortet nicht mehr", back_h: "{s} antwortet wieder", join: ", ",
    dir_faster: "B ist schneller: {list}", dir_slower: "B ist langsamer: {list}", dir_mixed: "Teils schneller, teils langsamer: {list}",
    dir_better: "B ist besser: {list}", dir_worse: "B ist schlechter: {list}", dir_mixed_p: "Teils besser, teils schlechter: {list}",
    same_all: "Fast gleich: alle {n} innerhalb der Messschwankung", same_most: "Fast gleich: {same} von {n} innerhalb der Messschwankung",
    noise: "{list}: vermutlich ein kurzer Ausreißer.", uses_same: "Keine Alltagsnutzung hat sich geändert.", same_exit: "Gleicher Ausgang · {gap} später", ax_fast: "schneller", ax_slow: "langsamer" },
  pt: { change: "Mudança", same: "Quase igual", lost: "Sem resposta", back: "Responde", both_lost: "Sem resposta nas duas vezes",
    faster: "{x}× mais rápido", slower: "{x}× mais lento", better: "melhor", worse: "pior",
    n_faster: "{n} mais rápidos", n_slower: "{n} mais lentos", n_better: "{n} melhor", n_worse: "{n} pior", n_same: "{n} quase iguais", n_none: "{n} só de um lado",
    all_same: "Quase igual nas duas vezes", lost_h: "{s} parou de responder", back_h: "{s} voltou a responder", join: ", ",
    dir_faster: "B é mais rápido: {list}", dir_slower: "B é mais lento: {list}", dir_mixed: "Uns mais rápidos, outros mais lentos: {list}",
    dir_better: "B é melhor: {list}", dir_worse: "B é pior: {list}", dir_mixed_p: "Uns melhores, outros piores: {list}",
    same_all: "Quase idêntico: os {n} dentro da margem de erro", same_most: "Quase idêntico: {same} de {n} dentro da margem de erro",
    noise: "{list}: provavelmente um pico isolado.", uses_same: "Nenhum uso do dia a dia mudou.", same_exit: "Mesma saída · {gap} depois", ax_fast: "mais rápido", ax_slow: "mais lento" },
  ru: { change: "Изменение", same: "Почти так же", lost: "Нет ответа", back: "Отвечает", both_lost: "Нет ответа оба раза",
    faster: "в {x} {raz} быстрее", slower: "в {x} {raz} медленнее", better: "лучше", worse: "хуже",
    n_faster: "быстрее: {n}", n_slower: "медленнее: {n}", n_better: "лучше: {n}", n_worse: "хуже: {n}", n_same: "почти так же: {n}", n_none: "только с одной стороны: {n}",
    all_same: "Оба раза почти одинаково", lost_h: "{s} перестал отвечать", back_h: "{s} снова отвечает", join: ", ",
    dir_faster: "B быстрее: {list}", dir_slower: "B медленнее: {list}", dir_mixed: "Что-то быстрее, что-то медленнее: {list}",
    dir_better: "B лучше: {list}", dir_worse: "B хуже: {list}", dir_mixed_p: "Что-то лучше, что-то хуже: {list}",
    same_all: "Почти одинаково: все {n} в пределах погрешности", same_most: "Почти одинаково: {same} из {n} в пределах погрешности",
    noise: "{list}: скорее всего, разовый всплеск.", uses_same: "Повседневные сценарии не изменились.", same_exit: "Тот же выход · через {gap}", ax_fast: "быстрее", ax_slow: "медленнее" },
};
export const STRINGS = T, LANGS = Object.keys(T);

const strings = lang => T[lang] || T.en;
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);
const fmt0 = v => v < 10 ? v.toFixed(1) : String(Math.round(v));
const isNum = v => typeof v === "number" && isFinite(v);
// how many times faster, in the language's own digits ("6.8", "6,8"); 10 and up as a whole number
const times = (x, lang) => new Intl.NumberFormat(T[lang] ? lang : "en", { maximumFractionDigits: x >= 10 ? 0 : 1 }).format(x);
// Russian counts "раза" after 2–4 and fractions, "раз" after the rest
const raz = x => { const n = Math.round(x * 10) / 10; if (n % 1) return "раза"; const d = n % 10, h = n % 100; return d >= 2 && d <= 4 && (h < 12 || h > 14) ? "раза" : "раз"; };
const ratioText = (t, st, x, lang) => fill(t[st === "better" ? "faster" : "slower"], { x: times(x, lang), raz: raz(x) });

// A row's change from a to b → the row plus st: better | worse | same | lost (b doesn't answer, a did) | back (b
// answers, a didn't) | gone (neither answered) | none (only one side measured it); d = b − a; x = how many times
// bigger the larger value is; score = how much it changed (lost and back most, then the ratio's log), for the order.
export const TOL = { abs: 20, rel: 0.3 };
export function judge(r) {
  const { a, b } = r, tol = { ...TOL, ...r.tol };
  if (a === undefined || b === undefined) return { ...r, st: "none", score: -1 };
  if (a === null && b === null) return { ...r, st: "gone", score: 0 };
  if (b === null) return { ...r, st: "lost", score: 99 };
  if (a === null) return { ...r, st: "back", score: 99 };
  const d = b - a, hi = Math.max(a, b), lo = Math.min(a, b), x = lo > 0 ? hi / lo : hi > 0 ? 50 : 1;
  if (Math.abs(d) <= tol.abs || x - 1 <= tol.rel) return { ...r, d, x, st: "same", score: 0 };
  return { ...r, d, x, st: (r.better === "higher" ? d > 0 : d < 0) ? "better" : "worse", score: Math.log(Math.min(x, 50)) };
}
const changed = r => r.score > 0;
// every row judged, biggest change first; equal ones keep the tool's order
export const rank = rows => rows.map((r, i) => [judge(r), i]).sort((p, q) => q[0].score - p[0].score || p[1] - q[1]).map(p => p[0]);
// how many got better (back included), worse (lost included), stayed the same (no answer either time included), or
// were measured on one side only
export function tally(rows) {
  const n = { better: 0, worse: 0, same: 0, none: 0 };
  for (const r of rows.map(judge)) n[r.st === "back" ? "better" : r.st === "lost" ? "worse" : r.st === "gone" ? "same" : r.st]++;
  return n;
}
export function tallyText(rows, lang, words = "speed") {
  const t = strings(lang), n = tally(rows), sp = words !== "plain";
  return [n.better && fill(t[sp ? "n_faster" : "n_better"], { n: n.better }), n.worse && fill(t[sp ? "n_slower" : "n_worse"], { n: n.worse }),
    n.same && fill(t.n_same, { n: n.same }), n.none && fill(t.n_none, { n: n.none })].filter(Boolean).join(" · ");
}
// The biggest changes by name: the first as "ChatGPT 300→44 ms", the next ones as "GitHub 5× faster" when that is at
// least double (else the same arrow form)
export function headline(rows, lang, n = 2) {
  const t = strings(lang), out = [];
  for (const r of rank(rows)) {
    if (out.length >= n || !changed(r)) break;
    const f = r.fmt || fmt0;
    if (r.st === "lost" || r.st === "back") out.push(fill(t[r.st + "_h"], { s: r.name }));
    else if (r.text) out.push(`${r.name} ${r.text[0]}→${r.text[1]}`);
    else if (out.length && r.unit && r.x >= 2) out.push(r.name + " " + ratioText(t, r.st, r.x, lang));
    else out.push(`${r.name} ${f(r.a)}→${f(r.b)}${r.unit ? " " + r.unit : ""}`);
  }
  return out.length ? out.join(t.join) : t.all_same;
}
// better, worse, mixed or same overall: what colors the verdict
export const tone = rows => { const n = tally(rows); return n.better > n.worse ? "better" : n.worse > n.better ? "worse" : "same"; };

// What the comparison says, overall first: { mood: same | better | worse | mixed, head, detail, title }.
// "Almost identical" when no everyday use and no key number changed and only a few rows moved past their tolerance
// (a single run has its blips: with the home page's tolerance about 2 % of rows move between two runs a minute apart,
// docs/compare.md); those few are named in the detail as likely blips. Otherwise the direction, the counts, the uses
// that changed and the biggest changes. title: for a chat preview, the verdict and the biggest change by name.
export function verdict(o, lang) {
  const t = strings(lang), sp = o.words !== "plain";
  const rows = (o.groups || []).flatMap(g => g.rows), n = tally(rows), total = n.better + n.worse + n.same;
  const moved = n.better + n.worse, uses = (o.uses || []).map(judge).filter(changed), stats = (o.stats || []).map(judge).filter(changed);
  const named = headline(rows, lang), usesText = uses.map(r => `${r.name} ${r.text ? r.text[0] + "→" + r.text[1] : ""}`.trim()).join(t.join);
  if (!uses.length && !stats.length && moved <= Math.max(2, Math.ceil(total * 0.08))) {
    const head = moved ? fill(t.same_most, { n: total, same: n.same }) : fill(t.same_all, { n: total });
    const detail = [moved ? fill(t.noise, { list: named }) : "", o.uses && o.uses.length ? t.uses_same : ""].filter(Boolean).join(/^(zh|ja)/.test(lang) ? "" : " ");
    return { mood: "same", head, detail, title: head };
  }
  // uses count toward the direction too: a use that got better is the change that matters most
  const up = n.better + uses.filter(r => r.st === "better" || r.st === "back").length, dn = n.worse + uses.filter(r => r.st === "worse" || r.st === "lost").length;
  const mood = up >= 2 * dn && up ? "better" : dn >= 2 * up && dn ? "worse" : up || dn ? "mixed" : "same";
  const list = [n.better && fill(t[sp ? "n_faster" : "n_better"], { n: n.better }), n.worse && fill(t[sp ? "n_slower" : "n_worse"], { n: n.worse })].filter(Boolean).join(t.join);
  const key = { better: sp ? "dir_faster" : "dir_better", worse: sp ? "dir_slower" : "dir_worse", mixed: sp ? "dir_mixed" : "dir_mixed_p" }[mood];
  const head = key ? fill(t[key], { list }) : t.all_same;
  return { mood, head, detail: [usesText, moved ? named : ""].filter(Boolean).join(" · "), title: moved ? head + " · " + headline(rows, lang, 1) : head };
}

/* ---------- layout: fixed heights, so a tool can reserve the space ---------- */
// px: one row, a group's title, the space between two groups
export const SIZE = { row: 34, head: 30, gap: 14 };
// the groups the view lists: rows both sides measured, changed ones first, empty groups left out
export const shown = groups => groups.map(g => {
  const rows = g.rows.map((r, i) => [judge(r), i]).filter(([r]) => r.st !== "none");
  return { ...g, rows: rows.sort((p, q) => q[0].score - p[0].score || p[1] - q[1]).map(p => p[0]) };
}).filter(g => g.rows.length);
// The listed groups in one column, and in two (in order, split where the taller column is shortest); one, two: the
// height of the groups in px for each
export function columns(groups) {
  const h = g => SIZE.head + g.rows.length * SIZE.row, col = l => l.reduce((s, g) => s + h(g), 0) + Math.max(0, l.length - 1) * SIZE.gap;
  let k = groups.length;
  for (let i = 0, best = Infinity; i <= groups.length; i++) { const m = Math.max(col(groups.slice(0, i)), col(groups.slice(i))); if (m < best) { best = m; k = i; } }
  return { cols: [groups.slice(0, k), groups.slice(k)], one: col(groups), two: Math.max(col(groups.slice(0, k)), col(groups.slice(k))) };
}
// when a side was measured, to the second when the two are less than a minute apart
const when = (ts, lang, sec) => new Date(ts).toLocaleString(T[lang] ? lang : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}) });
const gapText = (ms, lang) => {
  const s = Math.abs(ms) / 1000, [v, unit] = s < 90 ? [s, "second"] : s < 5400 ? [s / 60, "minute"] : s < 129600 ? [s / 3600, "hour"] : [s / 86400, "day"];
  return new Intl.NumberFormat(T[lang] ? lang : "en", { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 0 }).format(Math.round(v));
};

/* ---------- the view ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const here = name => new URL(`${name}?v=${VERSION}`, import.meta.url).href;   // past old cached copies
let cssP = null;
const loadCSS = () => cssP || (cssP = new Promise(res => {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = here("compare.css");
  l.onload = l.onerror = res; document.head.appendChild(l);
}));
const W = 1200;
const roundRect = (x, a, b, w, h, r) => { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); };
const clip = (x, s, w) => { s = String(s); if (x.measureText(s).width <= w) return s; while (s.length > 1 && x.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; };

export function compare(o) {
  const lang = T[o.lang] ? o.lang : "en", t = T[lang], words = o.words === "plain" ? "plain" : "speed";
  const groups = shown(o.groups || []), lay = columns(groups), stats = (o.stats || []).slice(0, 3).map(judge), uses = (o.uses || []).map(judge);
  const v = verdict(o, lang), A = o.a || {}, B = o.b || {};
  const subOf = (side, show) => typeof side.sub === "function" ? side.sub(show) : side.sub || "";
  // the two sides: when, and where from; the same exit twice says so once, with the time between them
  const close = isNum(A.ts) && isNum(B.ts) && Math.abs(B.ts - A.ts) < 120000;
  const sides = show => {
    const a = subOf(A, show), b = subOf(B, show), same = a && a === b && isNum(A.ts) && isNum(B.ts);
    return [[A.label || (isNum(A.ts) ? when(A.ts, lang, close) : ""), a], [B.label || (isNum(B.ts) ? when(B.ts, lang, close) : ""), same ? fill(t.same_exit, { gap: gapText(B.ts - A.ts, lang) }) : b]];
  };
  const val = (r, k) => { const v0 = r[k]; return r.text ? r.text[k === "a" ? 0 : 1] : v0 === undefined ? "–" : v0 === null ? "✕" : (r.fmt || fmt0)(v0); };
  const tierOf = r => r.tier && r.st !== "none" ? r.tier(r.b) : null;
  // the change column: −256 ms, and how many times when that says more (at least 1.5×); empty when it didn't change
  const change = r => {
    if (r.st === "better" || r.st === "worse") {
      const f = r.fmt || fmt0, d = r.text ? "" : (r.d > 0 ? "+" : "−") + f(Math.abs(r.d)) + (r.unit ? " " + r.unit : "");
      return [d || t[r.st], r.unit && r.x >= 1.5 && words !== "plain" ? ratioText(t, r.st, r.x, lang) : ""];
    }
    return r.st === "lost" || r.st === "back" ? [t[r.st], ""] : r.st === "gone" ? [t.both_lost, ""] : ["", ""];
  };
  const tone = st => st === "better" || st === "back" ? "up" : st === "worse" || st === "lost" ? "dn" : "eq";

  // A and B: a grey outlined badge and a solid one, the same in the banner, the column heads and the share card
  const badge = k => `<i class="msc-badge msc-${k}" aria-label="${k.toUpperCase()}">${k.toUpperCase()}</i>`;
  // the bar's two directions, under its column head
  const axis = words === "plain" ? [t.better, t.worse] : [t.ax_fast, t.ax_slow];
  // how long a row's bar is (0…1 of half the bar, from the middle): the log of how many times it changed, 8× and
  // more filling it; answering again or no longer, all of it; null: no bar (unchanged)
  const barOf = r => r.st === "lost" || r.st === "back" ? 1 : r.st === "better" || r.st === "worse" ? Math.max(0.08, Math.min(1, Math.log(r.x) / Math.log(8))) : null;

  // the head as HTML: pure, so a Worker can put it in the page before it is sent (no layout shift when it is drawn)
  function headHTML(show = true) {
    // A and B as the same badges the column heads use
    const side = (k, [label, sub]) => `<span class="msc-side">${badge(k)}<span>${esc(label)}</span>${sub ? `<span class="msc-sub">${esc(sub)}</span>` : ""}</span>`;
    const [sa, sb] = sides(show);
    return `<div class="msc-head" lang="${lang}"><p class="msc-h msc-${v.mood}" title="${esc(v.head)}">${esc(v.head)}</p><p class="msc-d" title="${esc(v.detail)}">${esc(v.detail)}</p>` +
      `<div class="msc-sides">${side("a", sa)}${side("b", sb)}</div></div>`;
  }
  const renderHead = (el, show = true) => { el.innerHTML = headHTML(show); };

  async function render(el) {
    await loadCSS();
    const stat = r => { const [c, x] = change(r);
      return `<div class="msc-stat msc-${tone(r.st)}"><em>${esc(r.name)}</em><b><span class="msc-va">${esc(val(r, "a"))}</span><small class="msc-ar">→</small><span class="msc-vb" data-tier>${esc(val(r, "b"))}</span>${r.unit ? `<small>${esc(r.unit)}</small>` : ""}</b><i>${esc(x || c || t.same)}</i></div>`; };
    const use = r => `<span class="msc-use msc-${tone(r.st)}"><em>${esc(r.name)}</em>${changed(r) ? `<span class="msc-ua">${esc(val(r, "a"))}</span><small>→</small>` : ""}<b data-tier>${esc(val(r, "b"))}</b></span>`;
    // a row: name, A, B, then the change as a bar from the middle (left = better, right = worse) and in numbers;
    // an unchanged row has no bar and no number, so the ones that changed stand out
    const row = r => { const [c, x] = change(r);
      return `<div class="msc-r msc-${tone(r.st)} msc-st-${r.st}" role="row"><span class="msc-n" role="cell" title="${esc(r.name)}">${esc(r.name)}</span>` +
        `<b class="msc-va" role="cell">${esc(val(r, "a"))}</b><b class="msc-vb" role="cell">${esc(val(r, "b"))}</b>` +
        `<span class="msc-bar" aria-hidden="true"><i></i></span><span class="msc-c" role="cell">${esc(c)}${x ? `<small>${esc(x)}</small>` : ""}</span></div>`; };
    const hd = `<div class="msc-r msc-hd" role="row"><span role="columnheader"></span><b role="columnheader">${badge("a")}</b><b role="columnheader">${badge("b")}</b>` +
      `<span class="msc-bar-h" title="← ${esc(axis[0])} · ${esc(axis[1])} →"><em><s class="msc-up">←</s> <span>${esc(axis[0])}</span></em><em><span>${esc(axis[1])}</span> <s class="msc-dn">→</s></em></span><span class="msc-c" role="columnheader">${esc(t.change)}</span></div>`;
    const col = gs => `<div class="msc-col">${hd}${gs.map(g => `<section class="msc-g"><h3>${esc(g.name || "")}</h3><div role="table">${g.rows.map(row).join("")}</div></section>`).join("")}</div>`;
    el.innerHTML = `<div class="msc" lang="${lang}">` + (stats.length ? `<div class="msc-stats">${stats.map(stat).join("")}</div>` : "") +
      (uses.length ? `<div class="msc-uses">${uses.map(use).join("")}</div>` : "") + `<div class="msc-cols">${lay.cols.filter(c => c.length).map(col).join("")}</div></div>`;
    // bar lengths and the speed colors of the key numbers and uses are set here, not as style="" in the markup,
    // which a strict CSP would block
    const paint = (e, r) => { const k = tierOf(r); if (k) e.querySelectorAll("[data-tier]").forEach(x => x.style.setProperty("--msc-tier", `var(--${k})`)); };
    el.querySelectorAll(".msc-stat").forEach((e, i) => paint(e, stats[i]));
    el.querySelectorAll(".msc-use").forEach((e, i) => paint(e, uses[i]));
    const all = lay.cols.flat().flatMap(g => g.rows);
    el.querySelectorAll(".msc-g .msc-r").forEach((e, i) => {
      const w = barOf(all[i]), bar = e.querySelector(".msc-bar i");
      if (w) bar.style.width = (w * 50).toFixed(1) + "%"; else bar.remove();
    });
  }

  // the share card's middle: verdict, sides, key numbers, uses and the groups in two columns, laid out once for its
  // height and drawn the same way
  let L = null;
  function height(m, kit) {
    const { P, top, F } = kit;
    m.font = `700 36px ${F}`;
    const hTop = top + 40, dTop = hTop + 40, sTop = dTop + 46, stTop = sTop + 2 * 34 + 8, SH = stats.length ? 100 : 0;
    const uTop = stTop + SH + (SH ? 22 : 0), UH = uses.length ? 44 : 0, gTop = uTop + UH + (UH ? 18 : 0);
    const RH = 30, GH = 36, GG = 12, colH = c => c.reduce((s, g) => s + GH + g.rows.length * RH, 0) + Math.max(0, c.length - 1) * GG;
    L = { hTop, dTop, sTop, stTop, SH, uTop, UH, gTop, RH, GH, GG };
    return gTop + 30 + Math.max(colH(lay.cols[0]), colH(lay.cols[1])) + 16 + 70;
  }
  async function draw(x, kit) {
    const { P, F, M, v: cv, dark, show } = kit, { hTop, dTop, sTop, stTop, SH, uTop, UH, gTop, RH, GH, GG } = L;
    const C = { fg: cv("fg"), muted: cv("muted"), line: cv("line"), bg: cv("bg"), panel: cv("panel") || cv("bg"),
      up: cv("good") || (dark ? "#3ecf8e" : "#1a8a5a"), dn: cv("bad") || (dark ? "#f56565" : "#d23a2f") };
    C.eq = C.muted;
    const tierC = r => { const k = tierOf(r); return (k && cv(k)) || C.fg; };
    const mood = { better: C.up, worse: C.dn }[v.mood] || C.fg;
    x.textBaseline = "alphabetic";
    x.fillStyle = mood; x.font = `700 36px ${F}`; x.fillText(clip(x, v.head, W - P * 2), P, hTop);
    x.fillStyle = C.muted; x.font = `400 22px ${F}`; x.fillText(clip(x, v.detail, W - P * 2), P, dTop);
    // the A and B badges, as on the page
    const badgeAt = (k, bx, by, s = 26) => {
      roundRect(x, bx, by, s, s, 6);
      if (k === "a") { x.strokeStyle = C.muted; x.lineWidth = 2; x.stroke(); x.fillStyle = C.muted; } else { x.fillStyle = C.fg; x.fill(); x.fillStyle = C.bg; }
      x.font = `700 ${Math.round(s * 0.6)}px ${F}`; x.textAlign = "center"; x.fillText(k.toUpperCase(), bx + s / 2, by + s * 0.74); x.textAlign = "left";
    };
    sides(show).forEach(([label, sub], i) => {
      const y = sTop + i * 34;
      badgeAt(i ? "b" : "a", P, y - 21);
      x.fillStyle = C.fg; x.font = `600 21px ${F}`; x.fillText(label, P + 40, y);
      x.fillStyle = C.muted; x.font = `400 21px ${F}`; x.fillText(clip(x, sub, W - P * 2 - 60 - x.measureText(label).width), P + 40 + x.measureText(label).width + 16, y);
    });
    // key numbers
    const cw3 = (W - P * 2 - 2 * 16) / 3;
    stats.forEach((r, i) => {
      const x0 = P + i * (cw3 + 16), [c, xr] = change(r);
      x.fillStyle = C.panel === C.bg ? C.line + "55" : C.panel; roundRect(x, x0, stTop, cw3, SH, 14); x.fill();
      x.fillStyle = C.muted; x.font = `400 19px ${F}`; x.fillText(clip(x, r.name, cw3 - 40), x0 + 20, stTop + 30);
      x.font = `600 36px ${M}`; const av = val(r, "a"), bv = val(r, "b");
      x.fillText(av, x0 + 20, stTop + 74); let xx = x0 + 20 + x.measureText(av).width + 8;
      x.font = `400 24px ${F}`; x.fillText("→", xx, stTop + 72); xx += x.measureText("→").width + 8;
      x.fillStyle = tierC(r); x.font = `600 36px ${M}`; x.fillText(bv, xx, stTop + 74); xx += x.measureText(bv).width + 8;
      x.font = `400 17px ${F}`; x.fillStyle = C[tone(r.st)]; x.fillText(clip(x, (r.unit ? r.unit + "  " : "") + (xr || c || t.same), x0 + cw3 - 14 - xx), xx, stTop + 74);
    });
    // uses, before → after
    let ux = P;
    for (const r of uses) {
      x.font = `400 19px ${F}`; x.fillStyle = C.muted; x.fillText(r.name, ux, uTop + 26); ux += x.measureText(r.name).width + 8;
      if (changed(r)) { x.fillText(val(r, "a") + " →", ux, uTop + 26); ux += x.measureText(val(r, "a") + " →").width + 8; }
      x.font = `600 19px ${F}`; x.fillStyle = tierC(r); x.fillText(val(r, "b"), ux, uTop + 26); ux += x.measureText(val(r, "b")).width + 28;
    }
    // the groups, in the page's two columns
    // the groups, in the page's two columns: name, A, B, the change bar from the middle, the change
    const cw = (W - P * 2 - 48) / 2, nameW = 130, valW = 58, chW = 96;
    lay.cols.forEach((gs, ci) => {
      const x0 = P + ci * (cw + 48), aR = x0 + nameW + valW, bR = aR + valW + 4, l0 = bR + 16, l1 = x0 + cw - chW - 12, mid = (l0 + l1) / 2;
      badgeAt("a", aR - 22, gTop, 22); badgeAt("b", bR - 22, gTop, 22);
      x.fillStyle = C.muted; x.font = `500 14px ${F}`;
      x.textAlign = "right"; x.fillText("← " + axis[0], mid - 6, gTop + 16); x.fillText(t.change.toUpperCase(), x0 + cw, gTop + 16);
      x.textAlign = "left"; x.fillText(axis[1] + " →", mid + 6, gTop + 16);
      let y0 = gTop + 30;
      for (const g of gs) {
        x.fillStyle = C.muted; x.font = `600 15px ${F}`; x.fillText(String(g.name || "").toUpperCase(), x0, y0 + 24); y0 += GH;
        x.fillStyle = C.line; x.fillRect(mid - 0.5, y0, 1, g.rows.length * RH);
        for (const r of g.rows) {
          const y = y0 + 20, cy = y - 6, col = C[tone(r.st)], [c] = change(r), moved = changed(r), w = barOf(r);
          x.fillStyle = moved ? C.fg : C.muted; x.font = `${moved ? 600 : 400} 18px ${F}`; x.fillText(clip(x, r.name, nameW - 10), x0, y);
          x.font = `500 18px ${M}`; x.textAlign = "right";
          x.fillStyle = C.muted; x.fillText(val(r, "a"), aR, y);
          x.fillStyle = moved ? C.fg : C.muted; x.fillText(val(r, "b"), bR, y);
          x.font = `500 16px ${r.st === "better" || r.st === "worse" ? M : F}`; x.fillStyle = col;
          x.fillText(clip(x, c, chW), x0 + cw, y); x.textAlign = "left";
          if (w) { const len = w * (l1 - l0) / 2; x.fillStyle = col; roundRect(x, tone(r.st) === "up" ? mid - len : mid, cy - 6, len, 12, 3); x.fill(); }
          y0 += RH;
        }
        y0 += GG;
      }
    });
  }

  return { groups, stats, uses, verdict: v, mood: v.mood, head: v.head, text: v.head + (v.detail ? " · " + v.detail : ""), layout: lay, headHTML, renderHead, render, height, draw };
}
