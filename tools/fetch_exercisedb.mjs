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
  const total = (first.metadata && first.metadata.totalExercises) || 1500;
  log.push(`base ${base}, total ${total}`);
  for (let off = all.length; off < total; ) {
    const p = await get(`${base}/exercises?offset=${off}&limit=100`);
    if (!p || !Array.isArray(p.data) || !p.data.length) break;
    all.push(...p.data); off += p.data.length;
    await sleep(400);
  }
  break;
}
const uniq = all ? [...new Map(all.map((e) => [e.exerciseId || e.id, e])).values()] : [];
log.push(`got ${uniq.length}`);
fs.writeFileSync("tools/exercisedb-log.txt", log.join("\n") + "\n");
if (uniq.length) fs.writeFileSync("tools/exercisedb.json", JSON.stringify(uniq));
else fs.writeFileSync("tools/exercisedb.json", "[]");
console.log(log.slice(-5).join("\n"));
