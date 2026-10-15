// Список треков deep house с Jamendo для плеера. Запускается в GitHub Actions (секрет JAMENDO_CLIENT_ID).
// Результат: music/jamendo.json — [{ id, t, a, d, u, l, s }]: название, артист, секунды, поток mp3, лицензия, страница трека.
import fs from "fs";
const id = process.env.JAMENDO_CLIENT_ID;
if (!id) { console.log("Нет секрета JAMENDO_CLIENT_ID — пропускаю"); process.exit(0); }
const base = `https://api.jamendo.com/v3.0/tracks/?client_id=${id}&format=json&limit=200&audioformat=mp32&include=musicinfo&order=popularity_total`;
const queries = ["&tags=deephouse", "&tags=deephouse&fuzzytags=energetic", "&tags=house&fuzzytags=deephouse+energetic", "&tags=house+energetic", "&search=deep%20house"];
const seen = new Map();
for (const q of queries) {
  for (let off = 0; off < 600; off += 200) {
    const r = await fetch(base + q + "&offset=" + off);
    const j = await r.json();
    if (!j.headers || j.headers.status !== "success") { console.log("ошибка", q, JSON.stringify(j.headers)); break; }
    for (const t of j.results) {
      if (seen.has(t.id) || !t.audio || t.duration < 120 || t.duration > 600) continue;
      const mi = t.musicinfo || {};
      const speed = mi.speed || "";
      if (speed === "verylow" || speed === "low") continue; // нужна энергичная музыка
      seen.set(t.id, { id: t.id, t: t.name, a: t.artist_name, d: t.duration, u: t.audio, l: t.license_ccurl, s: t.shareurl });
    }
    console.log(q, off, "→ всего", seen.size);
    if (j.results.length < 200) break;
  }
}
const list = [...seen.values()].slice(0, 400);
fs.mkdirSync("music", { recursive: true });
fs.writeFileSync("music/jamendo.json", JSON.stringify(list));
console.log("Сохранено треков:", list.length);
list.slice(0, 15).forEach((t) => console.log(`${t.a} — ${t.t} (${Math.round(t.d / 60)} мин)`));
