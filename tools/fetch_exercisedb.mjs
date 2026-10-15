// Скачивает бесплатную базу ExerciseDB v1 (1500 упражнений с GIF) в tools/exercisedb.json.
// Запускается в GitHub Actions: из песочницы разработки сайт недоступен.
import fs from "node:fs";
const BASES = ["https://oss.exercisedb.dev/api/v1", "https://exercisedb-api.vercel.app/api/v1", "https://v1.exercisedb.dev/api/v1", "https://www.exercisedb.dev/api/v1"];
const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.status === 429) { await sleep(3000 * (i + 1)); continue; }
      const t = await r.text();
      log.push(`${r.status} ${url} ${t.slice(0, 200).replace(/\s+/g, " ")}`);
      if (!r.ok) return null;
      return JSON.parse(t);
    } catch (e) { log.push(`ERR ${url} ${e.message}`); await sleep(2000); }
  }
  return null;
}
let all = null;
for (const base of BASES) {
  const first = await get(`${base}/exercises?offset=0&limit=100`);
  if (!first || !Array.isArray(first.data)) continue;
  all = [...first.data];
  const total = (first.meta && first.meta.total) || (first.metadata && first.metadata.totalExercises) || 1500;
  log.push(`base ${base}, total ${total}`);
  let meta = first.meta || {}, guard = 0;
  // курсорная пагинация: ?limit=25&cursor=<nextCursor>; пробуем имена параметра по очереди
  let param = null;
  while (meta.hasNextPage && meta.nextCursor && guard++ < 200) {
    let p = null;
    for (const name of param ? [param] : ["cursor", "after", "nextCursor"]) {
      const q = await get(`${base}/exercises?limit=100&${name}=${encodeURIComponent(meta.nextCursor)}`);
      const fresh = q && Array.isArray(q.data) && q.data.some((e) => !all.find((x) => x.exerciseId === e.exerciseId));
      if (fresh) { p = q; param = name; break; }
    }
    if (!p) break;
    all.push(...p.data); meta = p.meta || {};
    await sleep(400);
  }
  break;
}
const uniq = all ? [...new Map(all.map((e) => [e.exerciseId || e.id, e])).values()] : [];
log.push(`got ${uniq.length}`);
// проверка: отдаются ли GIF при открытии из мини-приложения (с Referer GitHub Pages)
for (const e of uniq.slice(0, 3)) {
  for (const ref of [null, "https://timurr050.github.io/"]) {
    try {
      const r = await fetch(e.gifUrl, { headers: ref ? { Referer: ref, Origin: "https://timurr050.github.io" } : {} });
      const b = await r.arrayBuffer();
      log.push(`gif ${r.status} ref=${ref} ${b.byteLength}B ${r.headers.get("content-type")} acao=${r.headers.get("access-control-allow-origin")} cache=${r.headers.get("cache-control")}`);
    } catch (err) { log.push(`gif ERR ${err.message}`); }
  }
}
fs.writeFileSync("tools/exercisedb-log.txt", log.join("\n") + "\n");
if (uniq.length) fs.writeFileSync("tools/exercisedb.json", JSON.stringify(uniq));
else fs.writeFileSync("tools/exercisedb.json", "[]");
console.log(log.slice(-5).join("\n"));
