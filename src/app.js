// ===================== TELEGRAM =====================
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor("#000000"); tg.setBackgroundColor("#000000"); tg.setBottomBarColor && tg.setBottomBarColor("#000000"); } catch (e) {}
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const userName = esc((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || "атлет");
const haptic = (t = "light") => { try { tg && tg.HapticFeedback.impactOccurred(t); } catch (e) {} };
const notify = (t = "success") => { try { tg && tg.HapticFeedback.notificationOccurred(t); } catch (e) {} };

// ===================== ХРАНИЛИЩЕ =====================
// localStorage на устройстве + Telegram CloudStorage, чтобы данные были на всех устройствах пользователя.
const LS_KEY = "aicoach_v2";
let store = { profile: null, history: [], session: null, shuffle: {}, basket: [], runs: [], run: null };
try { Object.assign(store, JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch (e) {}
if (!Array.isArray(store.basket)) store.basket = [];
// v3: в зале появился новый инвентарь из полной базы упражнений
if (store.profile && !store.profile.v3) { if (store.profile.place === "gym") store.profile.eq = [...new Set([...store.profile.eq, "fitball", "medball", "roller", "other"])]; store.profile.v3 = 1; }
const cloud = tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9") ? tg.CloudStorage : null;
let cloudTimer = null;
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
  if (!cloud) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    try {
      cloud.setItem("p", JSON.stringify(store.profile || null));
      const h = JSON.stringify(store.history), parts = [];
      for (let i = 0; i < h.length; i += 4000) parts.push(h.slice(i, i + 4000));
      parts.forEach((p, i) => cloud.setItem("h" + i, p));
      cloud.setItem("hn", String(parts.length));
    } catch (e) {}
  }, 800);
}
function cloudLoad() {
  if (!cloud) return;
  try {
    cloud.getItems(["p", "hn"], (err, v) => {
      if (err || !v) return;
      let changed = false;
      if (!store.profile && v.p && v.p !== "null") { try { store.profile = JSON.parse(v.p); changed = true; } catch (e) {} }
      const n = +v.hn || 0;
      const finish = () => { if (changed) { save(); render(); } };
      if (!n) return finish();
      cloud.getItems(Array.from({ length: n }, (_, i) => "h" + i), (e2, hv) => {
        if (!e2 && hv) {
          try {
            const remote = JSON.parse(Array.from({ length: n }, (_, i) => hv["h" + i] || "").join(""));
            const seen = new Set(store.history.map((h) => h.d));
            const add = remote.filter((h) => !seen.has(h.d));
            if (add.length) { store.history = [...store.history, ...add].sort((a, b) => new Date(b.d) - new Date(a.d)); changed = true; }
          } catch (e) {}
        }
        finish();
      });
    });
  } catch (e) {}
}
function resetAll() {
  if (cloud) try { cloud.getKeys((e, keys) => { if (!e && keys && keys.length) cloud.removeItems(keys); }); } catch (e) {}
  geoStop(); wakeOff();
  store = { profile: null, history: [], session: null, shuffle: {}, basket: [], runs: [], run: null };
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  state.stack = []; state.ob = null; state.tab = "coach";
  render();
}

// ===================== УТИЛИТЫ =====================
const $app = document.getElementById("app");
const $tabbar = document.getElementById("tabbar");
const img = (id, w, alt = "") => `<img src="${String(id).startsWith("http") ? id : IMG(id, w)}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()">`;
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dow = (d) => (d.getDay() + 6) % 7;
const todayIdx = dow(new Date());
const mondayOf = (d = new Date()) => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - dow(m)); return m; };
const weekNo = () => Math.floor((mondayOf() - new Date(2024, 0, 1)) / (7 * 864e5));
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const toast = (t) => { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 1900); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const eqName = (id) => (EQUIPMENT.find((e) => e.id === id) || {}).name || id;
const WEIGHTED = ["dumbbells", "kettlebell", "barbell", "cable", "machines"];
const isWeighted = (ex) => ex.eq.some((r) => r.split("|").some((x) => WEIGHTED.includes(x)));

// ===================== ВСЯ БАЗА: free-exercise-db на русском =====================
const DB_IMG = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
const MUSCLE_RU = ["Грудь", "Широчайшие", "Середина спины", "Поясница", "Трапеции", "Плечи", "Шея", "Бицепс", "Трицепс", "Предплечья", "Пресс", "Квадрицепс", "Бицепс бедра", "Ягодицы", "Икры", "Приводящие бедра", "Отводящие бедра"];
const MUSCLE_GROUP = ["chest", "back", "back", "back", "back", "shoulders", "shoulders", "arms", "arms", "arms", "core", "legs", "legs", "glutes", "legs", "legs", "glutes"];
const CAT_RU = ["Силовое", "Растяжка", "Плиометрика", "Пауэрлифтинг", "Тяжёлая атлетика", "Стронгмен", "Кардио"];
const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const codes = (s) => [...s].map((c) => c.charCodeAt(0) - 97);
const EMO = { chest: "💪", back: "🧗", legs: "🦵", glutes: "🍑", shoulders: "🏋️", arms: "💪", core: "🔥", cardio: "⚡" };
// картинка упражнения: фото из базы или заглушка с эмодзи, если фото нет
const pic = (e, w) => e.photo ? img(e.photo, w, e.name) : `<div class="ph">${EMO[e.group] || "🏋️"}</div>`;
const DB = DB_RAW.map(([slug, name, en, pm, sm, eq, level, cat, comp, steps, nimg]) => {
  const prim = codes(pm), sec = codes(sm), url = DB_IMG + encodeURIComponent(slug) + "/";
  return { id: "db:" + slug, db: true, name, en, prim, sec, level, cat, compound: !!comp,
    group: cat === 6 ? "cardio" : MUSCLE_GROUP[prim.length ? prim[0] : 10],
    eq: eq ? eq.split(",") : [], unit: cat === 1 || /^(планка|удержание|вис |статич)/i.test(name) ? "s" : "r",
    steps: steps.split(" / "), photo: nimg ? url + "0.jpg" : null, photos: Array.from({ length: nimg }, (_, k) => `${url}${k}.jpg`) };
});
// кураторские упражнения тоже участвуют в поиске; мышцы для них берём из группы
const GROUP_MUSCLES = { chest: [0], back: [1, 2], legs: [11], glutes: [13], shoulders: [5], arms: [7, 8], core: [10], cardio: [] };
const GROUP_SEC = { back: [3, 4], legs: [12, 13], glutes: [12, 16], arms: [9] };
const DB_BY_SLUG = new Map(DB.map((d) => [d.id.slice(3), d]));
EXERCISES.forEach((e) => { const d = DB_BY_SLUG.get(CURATED_PIC[e.id]); e.photo = d ? d.photo : null; e.photos = d ? d.photos : []; e.prim = GROUP_MUSCLES[e.group]; e.sec = GROUP_SEC[e.group] || []; e.cat = e.group === "cardio" ? 6 : 0; });
const CURATED_NAMES = new Set(EXERCISES.map((e) => norm(e.name)));
const ALL = [...EXERCISES, ...DB.filter((e) => !CURATED_NAMES.has(norm(e.name)))];
ALL.forEach((e) => { e._n = norm(e.name + " " + (e.en || "")); e._t = norm(e.steps.join(" ")); });
const BY_ID = new Map(ALL.map((e) => [e.id, e]));
const exById = (id) => BY_ID.get(id);

// Разбор фразы: «бицепс с гантелями дома», «растяжка спины для новичка», «ноги без инвентаря»
const M_ALL_LEGS = [11, 12, 13, 14, 15, 16];
const Q_PHRASES = [
  [/бицепс\S* бедр\S*|задн\S* (поверхн\S* )?бедр\S*/, (f) => f.mus.push(12)],
  [/(свой|своим|собственн\S*) вес\S*|без (инвентар|снаряд|оборудов|железа)\S*/, (f) => (f.bw = true)],
  [/(мо[йиеё]\S*|доступн\S*) (инвентар|снаряд|оборуд)\S*|что (у меня )?есть/, (f) => (f.mine = true)],
  [/тяжел\S* атлетик\S*/, (f) => f.cat.push(4)],
  [/на улиц\S*|на (спорт)?площадк\S*|во двор\S*/, (f) => (f.place = "outdoor")],
  [/в зал\S*/, (f) => (f.place = "gym")],
];
const Q_WORDS = [
  // мышцы
  [["бицепс"], (f) => f.mus.push(7)], [["трицепс"], (f) => f.mus.push(8)], [["предплеч", "запяст"], (f) => f.mus.push(9)],
  [["рук", "руч"], (f) => f.mus.push(7, 8, 9)], [["груд"], (f) => f.mus.push(0)], [["спин"], (f) => f.mus.push(1, 2, 3, 4)],
  [["широч", "крыл"], (f) => f.mus.push(1)], [["поясниц"], (f) => f.mus.push(3)], [["трапец"], (f) => f.mus.push(4)],
  [["плеч", "дельт"], (f) => f.mus.push(5)], [["шея", "шеи", "шею", "шейн"], (f) => f.mus.push(6)],
  [["пресс", "живот", "кубик", "кор", "косы"], (f) => f.mus.push(10)], [["ног"], (f) => f.mus.push(...M_ALL_LEGS)],
  [["бедр", "квадр"], (f) => f.mus.push(11, 12)], [["ягодиц", "попа", "попу", "попы", "ягодич"], (f) => f.mus.push(13)],
  [["икр", "голен"], (f) => f.mus.push(14)], [["привод"], (f) => f.mus.push(15)], [["отвод"], (f) => f.mus.push(16)],
  // инвентарь
  [["гантел"], (f) => f.eq.push("dumbbells")], [["штанг", "гриф"], (f) => f.eq.push("barbell")], [["гир"], (f) => f.eq.push("kettlebell")],
  [["резин", "эспандер", "ленточ", "фитнес-резин"], (f) => f.eq.push("bands")], [["блок", "кроссовер", "трос"], (f) => f.eq.push("cable")],
  [["тренаж"], (f) => f.eq.push("machines")], [["медбол"], (f) => f.eq.push("medball")], [["фитбол"], (f) => f.eq.push("fitball")],
  [["мяч"], (f) => f.eq.push("medball", "fitball")], [["ролик", "роллер", "мфр"], (f) => f.eq.push("roller")],
  [["турник", "перекладин", "подтяг"], (f) => f.eq.push("pullup")], [["брус"], (f) => f.eq.push("dips")],
  [["скамь", "лавк", "скамейк"], (f) => f.eq.push("bench")], [["скакалк"], (f) => f.eq.push("rope")], [["trx", "петл"], (f) => f.eq.push("trx")],
  [["цеп", "сан", "покрыш", "шин"], (f) => f.eq.push("other")],
  // место
  [["дома", "дом", "домашн", "квартир"], (f) => (f.place = "home")], [["улиц", "площадк", "парк", "двор"], (f) => (f.place = "outdoor")],
  [["зал", "спортзал", "фитнес", "качалк"], (f) => (f.place = "gym")],
  // уровень
  [["нович", "начина", "легк", "прост", "лайт"], (f) => (f.lvl = 1)], [["средн"], (f) => (f.lvl = 2)],
  [["продвинут", "сложн", "опытн", "эксперт", "профи", "тяжел"], (f) => (f.lvl = 3)],
  // тип
  [["растяж", "растян", "стретч", "гибк", "заминк"], (f) => f.cat.push(1)], [["кардио", "жиросж", "похуд", "выносл"], (f) => f.cat.push(6, 2)],
  [["плиометр", "прыж", "взрывн"], (f) => f.cat.push(2)], [["пауэрлифт", "троебор"], (f) => f.cat.push(3)],
  [["олимп", "тяжелоатлет"], (f) => f.cat.push(4)], [["стронгмен", "strongman"], (f) => f.cat.push(5)], [["силов"], (f) => f.cat.push(0, 3)],
  [["базов"], (f) => (f.comp = true)], [["изолир"], (f) => (f.comp = false)],
  [["мой", "мои", "моим", "мне", "меня", "доступн"], (f) => (f.mine = true)],
];
const STOP = ["с", "со", "на", "для", "и", "в", "во", "по", "без", "из", "к", "от", "а", "или", "мышц", "упражнен", "покаж", "найд", "дай", "хоч", "как", "какие", "какое", "что", "можно",
  "сделат", "накач", "прокач", "кача", "укреп", "проработ", "все", "всё", "лучш", "топ", "есть", "мою", "моя", "уровн", "тренир", "вариант", "чтобы", "надо", "нужн", "подбер", "посоветуй", "у"];
const HOME_EQ = ["mat", "dumbbells", "kettlebell", "bands", "fitball", "medball", "roller", "pullup", "rope", "trx"];
const PLACE_EQ = { home: HOME_EQ, outdoor: ["mat", "pullup", "dips", "bench", "bands", "rope"], gym: null };
const eqFits = (e, allowed) => !allowed || e.eq.every((r) => r.split("|").some((x) => allowed.includes(x)));

function parseQuery(raw) {
  const f = { mus: [], eq: [], cat: [], place: null, lvl: 0, bw: false, mine: false, comp: null, text: [], seen: [] };
  let q = " " + norm(raw) + " ";
  for (const [re, fn] of Q_PHRASES) { const m = q.match(re); if (m) { fn(f); f.seen.push(m[0].trim()); q = q.replace(m[0], " "); } }
  for (const w of q.split(" ").filter(Boolean)) {
    const rule = Q_WORDS.find(([stems]) => stems.some((s) => (s.length <= 3 ? w === s || (w.startsWith(s) && w.length <= s.length + 3) : w.startsWith(s))));
    if (rule) { rule[1](f); f.seen.push(w); continue; }
    if (STOP.some((s) => w === s || (s.length > 3 && w.startsWith(s)))) continue;
    f.text.push(w);
  }
  return f;
}
const stem = (w) => (w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w);
const textHit = (hay, w) => (" " + hay).includes(" " + stem(w));

function searchAll(raw, opts = {}) {
  const f = parseQuery(raw), p = store.profile;
  const allowed = f.mine ? p.eq : f.place ? PLACE_EQ[f.place] : null;
  const out = [];
  for (const e of ALL) {
    if (opts.group && opts.group !== "all" && e.group !== opts.group) continue;
    if (opts.mine && !eqFits(e, p.eq)) continue;
    if (e.where && f.place && e.where !== f.place) continue;
    if (!eqFits(e, allowed)) continue;
    if (f.bw && e.eq.length) continue;
    if (f.eq.length && !e.eq.some((r) => r.split("|").some((x) => f.eq.includes(x)))) continue;
    if (f.cat.length && !f.cat.includes(e.cat)) continue;
    if (f.lvl === 1 && e.level > 1) continue;
    if (f.lvl === 2 && e.level !== 2) continue;
    if (f.lvl === 3 && e.level < 2) continue;
    if (f.comp != null && e.compound !== f.comp) continue;
    let score = e.db ? 0 : 3, primHit = true;
    if (f.mus.length) {
      const pm = e.prim.filter((m) => f.mus.includes(m)).length, sm = e.sec.filter((m) => f.mus.includes(m)).length;
      if (!pm && !sm) continue;
      primHit = pm > 0;
      score += (pm ? 10 : 0) + Math.min(sm, 2) - (pm ? 0 : 6);
    }
    let ok = true;
    for (const w of f.text) {
      if (textHit(e._n, w)) score += 12; else if (textHit(e._t, w)) score += 3; else { ok = false; break; }
    }
    if (!ok) continue;
    if (!f.cat.length && !f.text.length && e.cat) score -= e.cat === 1 ? 4 : 2; // растяжки и спецвиды ниже, если не просили
    out.push([score + (e.compound ? 1 : 0) - e.level * 0.1, e, primHit]);
  }
  out.sort((a, b) => b[0] - a[0]);
  // если по основной мышце нашлось достаточно, вспомогательные не показываем
  const res = out.filter((x) => x[2]).length >= 6 ? out.filter((x) => x[2]) : out;
  return { f, list: res.map((x) => x[1]) };
}
const EQ_RU = (id) => (EQUIPMENT.find((x) => x.id === id) || { name: id }).name.toLowerCase();
function understood(f) {
  const bits = [];
  if (f.mus.length) { const set = [...new Set(f.mus)]; bits.push(set.length >= 5 && set.includes(11) ? "ноги" : set.length === 4 && set.includes(1) ? "спина" : set.map((m) => MUSCLE_RU[m].toLowerCase()).join(", ")); }
  if (f.bw) bits.push("свой вес");
  if (f.eq.length) bits.push([...new Set(f.eq)].map(EQ_RU).join(" или "));
  if (f.place) bits.push(PLACES.find((x) => x.id === f.place).name.toLowerCase());
  if (f.mine) bits.push("твой инвентарь");
  if (f.lvl) bits.push(LEVELS[f.lvl - 1].name.toLowerCase());
  if (f.cat.length) bits.push([...new Set(f.cat)].map((c) => CAT_RU[c].toLowerCase()).join(" / "));
  if (f.comp != null) bits.push(f.comp ? "базовые" : "изолирующие");
  if (f.text.length) bits.push("«" + f.text.join(" ") + "»");
  return bits;
}

// ===================== AI-ТРЕНЕР: подбор =====================
function canDo(ex, p, levelBoost = 0) {
  const have = new Set(p.eq);
  if (ex.where && ex.where !== p.place) return false;
  if (ex.level > p.level + levelBoost) return false;
  if (p.level >= 2 && EASY.has(ex.id)) return false;
  return ex.eq.every((req) => req.split("|").some((x) => have.has(x)));
}
// облегчённые варианты: только для новичков
const EASY = new Set(["pushup_knee", "pushup_incline", "neg_pullup"]);
const available = (p) => EXERCISES.filter((e) => canDo(e, p, 1));

function scheme(ex, p) {
  const G = {
    lose: { sets: 3, reps: 15, rest: 30, sec: 40 },
    mass: { sets: 4, reps: 10, rest: 90, sec: 45 },
    strength: ex.compound && isWeighted(ex) ? { sets: 5, reps: 5, rest: 150, sec: 45 } : { sets: 4, reps: 8, rest: 90, sec: 45 },
    endurance: { sets: 3, reps: 20, rest: 30, sec: 50 },
    fit: { sets: 3, reps: 12, rest: 60, sec: 40 },
  }[p.goal] || { sets: 3, reps: 12, rest: 60, sec: 40 };
  let sets = G.sets - (p.level === 1 ? 1 : 0) + (p.level === 3 && ex.compound ? 1 : 0);
  sets = Math.max(2, Math.min(6, sets));
  let reps = G.reps;
  if (!isWeighted(ex) && (p.goal === "strength" || p.goal === "mass")) reps = ex.level >= 2 ? 8 : 15;
  const sec = Math.round((G.sec * (p.level === 1 ? 0.75 : p.level === 3 ? 1.4 : 1)) / 5) * 5;
  return { sets, reps: ex.unit === "s" ? sec : reps, unit: ex.unit, rest: G.rest };
}

function buildWorkout(title, groups, seed, p) {
  const r = rng(seed);
  const count = { 20: 4, 30: 5, 45: 6, 60: 7 }[p.minutes] || 5;
  const wantFinisher = (p.goal === "lose" || p.goal === "endurance") && !groups.includes("cardio");
  const slots = wantFinisher ? count - 1 : count;
  const used = new Set(), items = [], missing = new Set();
  const pick = (g, preferCompound) => {
    let pool = EXERCISES.filter((e) => e.group === g && !used.has(e.id) && canDo(e, p));
    if (!pool.length) pool = EXERCISES.filter((e) => e.group === g && !used.has(e.id) && canDo(e, p, 1));
    if (!pool.length) return null;
    if (preferCompound) { const c = pool.filter((e) => e.compound); if (c.length) pool = c; }
    return pool[Math.floor(r() * pool.length)];
  };
  const seenGroup = new Set();
  for (let i = 0, tries = 0; items.length < slots && tries < slots * 4; i++, tries++) {
    const g = groups[i % groups.length];
    const ex = pick(g, !seenGroup.has(g) && p.goal !== "endurance");
    seenGroup.add(g);
    if (!ex) { missing.add(g); continue; }
    used.add(ex.id); items.push({ id: ex.id, ...scheme(ex, p) });
  }
  if (wantFinisher) { const ex = pick("cardio", false); if (ex) { used.add(ex.id); items.push({ id: ex.id, ...scheme(ex, p) }); } }
  // базовые упражнения в начало
  items.sort((a, b) => (exById(b.id).compound && isWeighted(exById(b.id))) - (exById(a.id).compound && isWeighted(exById(a.id))));
  const realMissing = [...missing].filter((g) => !items.some((it) => exById(it.id).group === g));
  return { title, groups: [...new Set(groups)], items, missing: realMissing };
}

function weekPlan(p) {
  const sch = { ...SCHEDULES[p.days] };
  if (p.goal === "lose" && p.days >= 3) { const last = Math.max(...Object.keys(sch).map(Number)); sch[last] = "cardio"; }
  return DAYS.map((_, i) => (sch[i] ? { type: sch[i], ...DAY_TYPES[sch[i]] } : null));
}
function dayWorkout(i) {
  const p = store.profile, d = weekPlan(p)[i];
  if (!d) return null;
  const sh = store.shuffle[`${weekNo()}-${i}`] || 0;
  return buildWorkout(d.title, d.groups, hash(JSON.stringify(p)) + weekNo() * 31 + i * 7 + sh * 101, p);
}
function swapItem(w, idx) {
  const p = store.profile, cur = exById(w.items[idx].id);
  const used = new Set(w.items.map((it) => it.id));
  const pool = EXERCISES.filter((e) => e.group === cur.group && !used.has(e.id) && canDo(e, p, 1));
  if (!pool.length) { toast("Других вариантов с твоим инвентарём нет"); return; }
  const ex = pool[Math.floor(Math.random() * pool.length)];
  w.items[idx] = { id: ex.id, ...scheme(ex, p) };
}

// ===================== НАВИГАЦИЯ =====================
const state = { tab: "coach", stack: [], ob: null, obStep: 0, obReturn: false, group: "all", query: "", limit: 40, onlyMine: true, liftEx: null, builder: new Set() };

function go(tab) { state.tab = tab; state.stack = []; render(); window.scrollTo(0, 0); }
function push(v) { state.stack.push(v); render(); window.scrollTo(0, 0); }
function pop() { state.stack.pop(); render(); window.scrollTo(0, 0); }
$tabbar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; haptic(); go(b.dataset.tab); });
if (tg) tg.BackButton.onClick(() => { haptic(); if (state.ob && state.obStep > 0) { state.obStep--; render(); } else if (state.ob && state.obReturn) { state.ob = null; render(); } else pop(); });

let sessionClock = null;
function render() {
  if (state.tab !== "timer") stopTicker();
  clearInterval(sessionClock); sessionClock = null;
  const top = state.stack[state.stack.length - 1];
  let html;
  const onboarding = !store.profile || state.ob;
  if (onboarding) html = viewOnboarding();
  else if (top) html = ({ preview: viewPreview, session: viewSession, exercise: viewExercise, settings: viewSettings, builder: viewBuilder, run: viewRunDetail, admin: viewAdmin })[top.type](top);
  else html = { coach: viewCoach, catalog: viewCatalog, run: viewRun, timer: viewTimer, history: viewHistory, progress: viewProgress }[state.tab]();
  killMap();
  const bar = !onboarding && (!top ? state.tab === "catalog" : top.type === "exercise") ? basketBar() : "";
  $app.innerHTML = `<div class="screen">${html}</div>${bar}`;
  const hideTabs = onboarding || (top && top.type === "session");
  $tabbar.classList.toggle("hidden", !!hideTabs);
  $tabbar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  if (tg) {
    const back = state.stack.length || (state.ob && (state.obStep > 0 || state.obReturn));
    back ? tg.BackButton.show() : tg.BackButton.hide();
    try { tg.MainButton.hide(); } catch (e) {}
  }
  renderRestBar();
  bind();
  if (!onboarding) { afterRunRender(); renderRunBar(); }
}

// ===================== АНКЕТА =====================
const OB_STEPS = 5;
function viewOnboarding() {
  if (!state.ob) state.ob = { place: null, eq: [], goal: null, level: null, days: 3, minutes: 45, eqTouched: false };
  const o = state.ob, s = state.obStep;
  const prog = `<div class="ob-progress">${Array.from({ length: OB_STEPS }, (_, i) => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>`;
  let body = "", canNext = true;
  if (s === 0) {
    canNext = !!o.place;
    body = `<div class="eyebrow">Привет, ${userName}! Я твой AI-тренер</div>
      <div class="h1" style="margin-top:10px">Где ты <span class="lime">тренируешься?</span></div>
      <div class="ob-sub">Подберу упражнения под место и инвентарь. Всё можно поменять позже в настройках.</div>
      <div class="opts">${PLACES.map((pl) => `<button class="opt opt-photo ${o.place === pl.id ? "on" : ""}" data-place="${pl.id}">${img(pl.photo, 700)}
        <div><b style="font-family:var(--display);font-size:22px;text-transform:uppercase">${pl.emo} ${pl.name}</b><small>${pl.desc}</small></div></button>`).join("")}</div>`;
  } else if (s === 1) {
    body = `<div class="eyebrow">Шаг 2 из ${OB_STEPS}</div>
      <div class="h1" style="margin-top:10px">Что есть <span class="lime">под рукой?</span></div>
      <div class="ob-sub">Отметь весь доступный инвентарь. Если ничего нет, не страшно: подберу упражнения с собственным весом.</div>
      <div class="eq">${EQUIPMENT.map((e) => `<button data-eq="${e.id}" class="${o.eq.includes(e.id) ? "on" : ""}"><span>${e.emo}</span><b>${e.name}</b></button>`).join("")}</div>`;
  } else if (s === 2) {
    canNext = !!o.goal;
    body = `<div class="eyebrow">Шаг 3 из ${OB_STEPS}</div>
      <div class="h1" style="margin-top:10px">Какая <span class="lime">цель?</span></div>
      <div class="opts">${GOALS.map((g) => `<button class="opt ${o.goal === g.id ? "on" : ""}" data-goal="${g.id}"><div class="emo">${g.emo}</div><div><b>${g.name}</b><small>${g.desc}</small></div></button>`).join("")}</div>`;
  } else if (s === 3) {
    canNext = !!o.level;
    body = `<div class="eyebrow">Шаг 4 из ${OB_STEPS}</div>
      <div class="h1" style="margin-top:10px">Твой <span class="lime">уровень</span></div>
      <div class="opts">${LEVELS.map((l) => `<button class="opt ${o.level === l.id ? "on" : ""}" data-level="${l.id}"><div class="emo">${l.emo}</div><div><b>${l.name}</b><small>${l.desc}</small></div></button>`).join("")}</div>`;
  } else {
    body = `<div class="eyebrow">Шаг 5 из ${OB_STEPS}</div>
      <div class="h1" style="margin-top:10px">Сколько <span class="lime">времени?</span></div>
      <div class="h3 label">Тренировок в неделю</div>
      <div class="row2">${[2, 3, 4, 5, 6].map((n) => `<button data-days="${n}" class="${o.days === n ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="h3 label">Минут на тренировку</div>
      <div class="row2">${[20, 30, 45, 60].map((n) => `<button data-min="${n}" class="${o.minutes === n ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="coach" style="margin-top:26px"><div class="ava">AI</div><p>Составлю план на ${o.days} ${plural(o.days, "тренировку", "тренировки", "тренировок")} в неделю по ${o.minutes} минут: ${Object.keys(SCHEDULES[o.days]).map((d) => DAYS[d]).join(", ")}.</p></div>`;
  }
  const backBtn = s > 0 ? `<button class="btn dark" data-ob="back" style="flex:0 0 auto;width:56px;padding:0">‹</button>` : "";
  return `<div class="ob">${prog}${body}<div class="ob-foot">${backBtn}<button class="btn" data-ob="next" ${canNext ? "" : 'style="opacity:.35;pointer-events:none"'}>${s === OB_STEPS - 1 ? "Составить план" : "Далее"}</button></div></div>`;
}
function finishOnboarding() {
  const o = state.ob;
  store.profile = { ...(store.profile || {}), place: o.place, eq: o.eq, goal: o.goal, level: o.level, days: o.days, minutes: o.minutes, v3: 1 };
  store.shuffle = {};
  state.ob = null; state.obStep = 0;
  save(); notify(); syncRemind();
  if (state.obReturn) { state.obReturn = false; render(); toast("Настройки сохранены"); }
  else { go("coach"); toast("План готов 💪"); }
}

// ===================== ГЛАВНАЯ: ТРЕНЕР =====================
function weekStats() {
  const mon = mondayOf();
  const wk = store.history.filter((h) => new Date(h.d) >= mon);
  const doneDays = new Set(wk.map((h) => dow(new Date(h.d))));
  const days = new Set(store.history.map((h) => new Date(h.d).toDateString()));
  const plan = weekPlan(store.profile);
  let streak = 0; const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 120; i++) {
    if (days.has(d.toDateString())) streak++;
    else if (plan[dow(d)]) break;
    d.setDate(d.getDate() - 1);
  }
  return { count: wk.length, minutes: wk.reduce((s, h) => s + h.m, 0), doneDays, streak };
}
function coachLine(w, p) {
  const eq = p.eq.length ? p.eq.slice(0, 3).map(eqName).join(", ").toLowerCase() + (p.eq.length > 3 ? " и др." : "") : "собственный вес";
  let t = `Подобрал ${w.items.length} ${plural(w.items.length, "упражнение", "упражнения", "упражнений")} под твой инвентарь: ${eq}.`;
  if (w.missing.length) t += ` Для группы «${w.missing.map((g) => GROUPS[g].name).join(", ")}» не хватает инвентаря, заменил другими.`;
  return t;
}
function viewCoach() {
  const p = store.profile, plan = weekPlan(p), today = dayWorkout(todayIdx), st = weekStats(), mon = mondayOf();
  const goal = GOALS.find((g) => g.id === p.goal);
  const session = store.session ? `<button class="row" data-resume style="margin-bottom:12px;box-shadow:inset 0 0 0 2px var(--lime)"><div class="thumb" style="display:grid;place-items:center;font-size:28px">⏱</div>
    <div class="grow"><div class="title">Продолжить тренировку</div><div class="sub">${esc(store.session.title)}</div></div><span class="chev">›</span></button>` : "";
  const hero = today
    ? `<button class="hero" style="width:100%;text-align:left" data-day="${todayIdx}">${img(GROUPS[today.groups[0]].photo, 900)}
        <span class="tag">Сегодня · ${DAYS[todayIdx]}</span>
        <div class="h1" style="font-size:32px;margin-top:12px">${today.title}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><span class="tag ghost">${p.minutes} мин</span><span class="tag ghost">${today.items.length} упр.</span><span class="tag ghost">${goal.emo} ${goal.name}</span></div></button>
       <div class="coach"><div class="ava">AI</div><p>${coachLine(today, p)}</p></div>`
    : `<div class="hero">${img(PHOTOS.home, 900)}<span class="tag">Сегодня · ${DAYS[todayIdx]}</span>
        <div class="h1" style="font-size:32px;margin-top:12px">День отдыха</div>
        <div class="muted" style="margin-top:8px">Восстановление тоже часть прогресса: прогулка, растяжка, сон.</div></div>
       <div class="coach"><div class="ava">AI</div><p>Сегодня по плану отдых. Если хочется подвигаться, собери лёгкую тренировку ниже.</p></div>`;
  return `
  <div class="top">
    <div><div class="eyebrow">Привет, ${userName}</div><div class="h1" style="margin-top:8px">Время<br><span class="lime">качаться</span></div></div>
    <button class="icon-btn" data-settings aria-label="Настройки">⚙️</button>
  </div>
  ${session}${hero}
  <div class="stats section" style="margin-top:12px">
    <div class="stat"><div class="big-num lime">${st.count}/${p.days}</div><div class="eyebrow">за неделю</div></div>
    <div class="stat"><div class="big-num">${st.minutes}</div><div class="eyebrow">минут</div></div>
    <div class="stat"><div class="big-num">${st.streak}${st.streak ? "🔥" : ""}</div><div class="eyebrow">${plural(st.streak, "день", "дня", "дней")} подряд</div></div>
  </div>
  <div class="section">
    <div class="section-head"><div class="h2">План недели</div><span class="pill">${p.days}×${p.minutes} мин</span></div>
    <div class="week">${plan.map((d, i) => { const date = new Date(mon); date.setDate(mon.getDate() + i);
      return `<button class="day ${i === todayIdx ? "today" : ""} ${st.doneDays.has(i) ? "done" : ""}" data-day="${i}" style="${d ? "" : "opacity:.5"}"><small>${DAYS[i]}</small><b>${date.getDate()}</b><i></i></button>`; }).join("")}</div>
    <div class="list" style="margin-top:12px">${plan.map((d, i) => d ? `
      <button class="row" data-day="${i}"><div class="thumb">${img(GROUPS[d.groups[0]].photo, 200)}</div>
        <div class="grow"><div class="title">${d.title}</div><div class="sub">${DAYS[i]} · ${[...new Set(d.groups)].slice(0, 4).map((g) => GROUPS[g].name).join(", ")}</div></div>
        ${st.doneDays.has(i) ? `<span class="pill">✓</span>` : i === todayIdx ? `<span class="pill">сегодня</span>` : `<span class="chev">›</span>`}</button>` : "").join("")}</div>
  </div>
  <div class="section">
    <button class="btn outline block" data-builder>＋ Собрать свою тренировку</button>
  </div>`;
}

// ===================== КОНСТРУКТОР =====================
function viewBuilder() {
  const sel = state.builder;
  return `
  <div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button>
    <div class="h1" style="margin-top:16px">Своя <span class="lime">тренировка</span></div></div></div>
  <div class="ob-sub" style="margin-top:0">Выбери группы мышц, и я соберу тренировку из того, что у тебя есть.</div>
  <div class="groups section" style="margin-top:18px">${Object.entries(GROUPS).map(([id, g]) => `<button data-bg="${id}" class="${sel.has(id) ? "on" : ""}">${g.name}</button>`).join("")}</div>
  <div class="section"><button class="btn block" data-build ${sel.size ? "" : 'style="opacity:.35;pointer-events:none"'}>Собрать тренировку</button></div>`;
}

// ===================== ПРЕДПРОСМОТР =====================
function viewPreview(v) {
  const w = v.w, p = store.profile;
  return `
  <div class="detail-hero">${img(GROUPS[w.groups[0]].photo, 900)}<button class="back" data-back>‹ Назад</button></div>
  <div class="detail-body">
    <span class="tag">${v.day != null ? DAYS[v.day] + " · по плану" : "Своя тренировка"}</span>
    <div class="h1" style="margin-top:12px">${w.title}</div>
    <div class="kv">
      <div><span class="eyebrow">Время</span><b>~${p.minutes} мин</b></div>
      <div><span class="eyebrow">Упр.</span><b>${w.items.length}</b></div>
      <div><span class="eyebrow">Подходов</span><b>${w.items.reduce((s, it) => s + it.sets, 0)}</b></div>
    </div>
    <div class="coach"><div class="ava">AI</div><p>${v.basket ? "Собрал из твоей подборки, подходы и повторы подстроил под твою цель." : coachLine(w, p)} Отдых между подходами ${w.items[0] ? w.items[0].rest : 60} с.</p></div>
    <div class="section"><div class="section-head"><div class="h2">Упражнения</div>${v.day != null ? `<button class="swap" data-reshuffle>🔄 Другие</button>` : ""}</div>
      <div class="list">${w.items.map((it, i) => { const e = exById(it.id); return `
        <div class="row"><button class="thumb" data-ex="${e.id}">${pic(e, 200)}</button>
          <button class="grow" style="text-align:left" data-ex="${e.id}"><div class="title">${e.name}</div><div class="sub">${GROUPS[e.group].name} · ${it.sets} × ${it.reps}${it.unit === "s" ? " с" : ""}</div></button>
          ${v.basket ? `<button class="swap" data-unbasket="${i}">Убрать</button>` : `<button class="swap" data-swap="${i}">Заменить</button>`}</div>`; }).join("") ||
        `<div class="empty"><div class="big">🤷</div><b>Не из чего собрать</b><p>Добавь инвентарь в настройках, и я подберу упражнения.</p></div>`}</div></div>
    ${w.items.length ? `<div class="section"><button class="btn block" data-start>▶ Начать тренировку</button></div>` : ""}
  </div>`;
}

// ===================== ТРЕНИРОВКА =====================
let rest = { left: 0, timer: null };
function startRest(sec) {
  clearInterval(rest.timer); rest.left = sec;
  rest.timer = setInterval(() => { rest.left--; if (rest.left <= 3 && rest.left > 0) beep(660, 0.06);
    if (rest.left <= 0) { clearInterval(rest.timer); beep(990, 0.35); notify(); } renderRestBar(); }, 1000);
  renderRestBar();
}
function renderRestBar() {
  let el = document.getElementById("restbar");
  const top = state.stack[state.stack.length - 1];
  if (rest.left <= 0 || !top || top.type !== "session") { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "restbar"; el.className = "restbar"; document.body.appendChild(el);
    el.onclick = (e) => { if (e.target.closest("button")) { clearInterval(rest.timer); rest.left = 0; renderRestBar(); } }; }
  el.innerHTML = `<span>Отдых</span><b>${fmt(rest.left)}</b><button>Пропустить</button>`;
}
function startSession(w) {
  store.session = { title: w.title, startedAt: Date.now(), items: w.items.map((it) => ({ ...it, done: Array(it.sets).fill(false), w: "" })) };
  save(); notify();
  state.stack = [{ type: "session" }]; render(); window.scrollTo(0, 0);
}
function viewSession() {
  const s = store.session;
  if (!s) return `<div class="empty" style="margin-top:40px"><b>Тренировка не найдена</b></div>`;
  const total = s.items.reduce((a, it) => a + it.sets, 0), done = s.items.reduce((a, it) => a + it.done.filter(Boolean).length, 0);
  return `
  <div class="top"><div><div class="eyebrow">${esc(s.title)}</div><div class="h1" style="margin-top:8px;font-variant-numeric:tabular-nums" id="s-clock">${fmt(Math.floor((Date.now() - s.startedAt) / 1000))}</div></div>
    <button class="icon-btn" data-back aria-label="Свернуть">✕</button></div>
  <div class="card" style="padding:14px 18px"><div class="section-head" style="margin:0"><span class="eyebrow">Подходы</span><b>${done} / ${total}</b></div>
    <div class="tr" style="height:8px;border-radius:6px;background:var(--surface-2);margin-top:10px;overflow:hidden"><i style="display:block;height:100%;width:${(done / total) * 100}%;background:var(--lime)"></i></div></div>
  <div class="list section" style="margin-top:12px">${s.items.map((it, i) => { const e = exById(it.id); const all = it.done.every(Boolean); return `
    <div class="ex-card ${all ? "done" : ""}">
      <div class="ex-head"><button class="thumb" data-ex="${e.id}">${pic(e, 200)}</button>
        <div class="grow"><div class="title">${e.name}</div><div class="sub">${it.sets} × ${it.reps}${it.unit === "s" ? " с" : ""} · отдых ${it.rest} с</div></div></div>
      <div class="sets">${it.done.map((d, j) => `<button class="set ${d ? "on" : ""}" data-set="${i}:${j}">${d ? "✓" : j + 1}</button>`).join("")}
        ${isWeighted(e) ? `<input class="w-input" inputmode="decimal" placeholder="кг" value="${esc(it.w)}" data-w="${i}">` : ""}</div>
    </div>`; }).join("")}</div>
  <div class="section"><button class="btn block" data-finish>✓ Завершить тренировку</button></div>
  <button class="danger-link" data-cancel>Отменить без сохранения</button>`;
}
function finishSession() {
  const s = store.session, mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const x = s.items.map((it) => [it.id, it.done.filter(Boolean).length, it.reps, parseFloat(String(it.w).replace(",", ".")) || 0]).filter((e) => e[1] > 0);
  if (!x.length) { toast("Отметь хотя бы один подход"); return; }
  const v = x.reduce((a, [id, sets, reps, w]) => a + (exById(id).unit === "r" ? sets * reps * w : 0), 0);
  store.history.unshift({ d: new Date().toISOString(), t: s.title, m: mins, x, v: Math.round(v) });
  store.session = null; clearInterval(rest.timer); rest.left = 0;
  save(); notify(); go("history"); toast("Тренировка сохранена 💪");
}

// ===================== КАТАЛОГ =====================
const Q_EXAMPLES = ["бицепс с гантелями дома", "ноги без инвентаря", "спина на турнике", "пресс для новичка", "растяжка спины", "грудь в зале", "ягодицы с резинкой", "кардио дома"];
function viewCatalog() {
  const p = store.profile, q = state.query.trim();
  const { f, list } = searchAll(q, { group: state.group, mine: state.onlyMine });
  const shown = list.slice(0, state.limit), bits = q ? understood(f) : [];
  const n = list.length;
  return `
  <div class="top"><div><div class="eyebrow">${ALL.length} упражнений в базе</div><div class="h1" style="margin-top:8px">Упражнения</div></div></div>
  <input class="search" id="search" type="search" enterkeyhint="search" placeholder="Спроси тренера: бицепс с гантелями дома" value="${esc(state.query)}">
  ${q ? `<div class="coach" style="margin:0 0 12px"><div class="ava">AI</div><p>${n ? `Нашёл ${n} ${plural(n, "упражнение", "упражнения", "упражнений")}` : "Ничего не нашёл"}${bits.length ? `: ${esc(bits.join(" · "))}` : ""}.${!n ? " Попробуй проще, например «спина с гантелями»" + (state.onlyMine ? " или выключи «Мой инвентарь»" : "") + "." : ""}</p></div>`
    : `<div class="chips" style="margin-bottom:12px">${Q_EXAMPLES.map((x) => `<button class="chip ghost" data-q="${x}">${x}</button>`).join("")}</div>`}
  <div class="seg" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><button data-mine="1" class="${state.onlyMine ? "active" : ""}">Мой инвентарь</button><button data-mine="0" class="${state.onlyMine ? "" : "active"}">Все</button></div>
  <div class="chips"><button class="chip ${state.group === "all" ? "active" : ""}" data-group="all">Все</button>${Object.entries(GROUPS).map(([id, g]) => `<button class="chip ${id === state.group ? "active" : ""}" data-group="${id}">${g.name}</button>`).join("")}</div>
  <div class="grid section" style="margin-top:16px">${shown.map((e) => `
    <button class="tile${e.db ? " tile-db" : ""}" data-ex="${e.id}">${pic(e, 500)}${store.basket.includes(e.id) ? `<span class="in-basket">✓</span>` : ""}
      <div class="cap"><span>${GROUPS[e.group].name}${e.eq.length ? "" : " · свой вес"}</span><b>${e.name}</b></div></button>`).join("") || `<div class="muted">Ничего не найдено</div>`}</div>
  ${n > shown.length ? `<div class="section"><button class="btn dark block" data-more>Показать ещё (${n - shown.length})</button></div>` : ""}
  <div class="muted" style="font-size:12px;margin:18px 0 0;text-align:center">Версия 3.6</div>`;
}
function basketBar() {
  const n = store.basket.length;
  if (!n) return "";
  return `<div style="height:72px"></div><div class="basket-bar"><button class="grow" data-basket-go>▶ Моя тренировка · ${n} ${plural(n, "упражнение", "упражнения", "упражнений")}</button><button class="x" data-basket-clear aria-label="Очистить">✕</button></div>`;
}
function basketWorkout() {
  const p = store.profile, items = store.basket.map(exById).filter(Boolean).map((e) => ({ id: e.id, ...scheme(e, p) }));
  return { title: "Моя подборка", groups: [...new Set(items.map((it) => exById(it.id).group))].concat("core").slice(0, 3), items, missing: [] };
}
function viewExercise(v) {
  const e = exById(v.id), have = new Set(store.profile.eq);
  if (!e) return `<div class="empty" style="margin-top:40px"><b>Упражнение не найдено</b><p><button class="btn" data-back>Назад</button></p></div>`;
  const reqs = e.eq.map((r) => { const opts = r.split("|"); const ok = opts.some((x) => have.has(x)); return `<div class="pr"><div>${opts.map(eqName).join(" или ")}</div><b class="${ok ? "lime" : ""}" style="font-size:15px;${ok ? "" : "color:var(--danger)"}">${ok ? "✓ есть" : "нет"}</b></div>`; });
  const sc = scheme(e, store.profile), inB = store.basket.includes(e.id);
  const mus = e.db ? `<div class="section"><div class="section-head"><div class="h2">Мышцы</div></div><div class="card">
      <div class="pr"><div>Основные</div><b style="font-size:15px;text-align:right">${e.prim.map((m) => MUSCLE_RU[m]).join(", ") || "—"}</b></div>
      ${e.sec.length ? `<div class="pr"><div>Помогают</div><b style="font-size:15px;text-align:right;font-weight:500">${e.sec.map((m) => MUSCLE_RU[m]).join(", ")}</b></div>` : ""}</div></div>` : "";
  const demo = demoPlan(e);
  return `
  <div class="detail-hero"><div class="anim" id="anim">${e.photos.length > 1 ? e.photos.map((u, k) => `<img class="f${k}" src="${u}" alt="${esc(e.name)}">`).join("") : pic(e, 900)}
    <div class="demo-cap" id="demo-cap"></div><div class="demo-rep" id="demo-rep"></div></div><button class="back" data-back>‹ Назад</button></div>

  <div class="detail-body">
  <div class="anim-ctl"><button class="play" data-anim="toggle" aria-label="Пауза">❚❚</button>
    <input type="range" min="0" max="${demo.dur * 10}" value="0" id="anim-r" aria-label="Демонстрация"><span class="lbl" id="demo-t">0:00 / ${fmt(demo.dur)}</span>
    <button class="spd" data-anim="speed">1×</button></div>
    <span class="tag">${GROUPS[e.group].name}</span>${e.db ? ` <span class="tag ghost">${CAT_RU[e.cat]}</span>` : ""}
    <div class="h1" style="margin-top:12px;font-size:32px">${e.name}</div>
    ${e.en ? `<div class="muted" style="margin-top:6px;font-size:13px">${esc(e.en)}</div>` : ""}
    <div class="kv">
      <div><span class="eyebrow">Уровень</span><b>${LEVELS[e.level - 1].name}</b></div>
      <div style="grid-column:span 2"><span class="eyebrow">Для тебя</span><b>${sc.sets} × ${sc.reps}${sc.unit === "s" ? " с" : ""}, отдых ${sc.rest} с</b></div>
    </div>
    <div class="section"><button class="btn block ${inB ? "dark" : ""}" data-basket="${esc(e.id)}">${inB ? "✓ В моей тренировке · убрать" : "+ Добавить в мою тренировку"}</button></div>
    <div class="section"><div class="section-head"><div class="h2">Техника</div></div><ol class="steps">${e.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
      ${e.en ? `<button class="swap" style="margin-top:12px" data-video="${esc(e.en)}">▶ Видео техники на YouTube</button>` : ""}</div>
    ${mus}
    <div class="section"><div class="section-head"><div class="h2">Инвентарь</div></div>
      <div class="card">${reqs.length ? reqs.join("") : `<div class="pr"><div>Без инвентаря, свой вес</div><b class="lime" style="font-size:15px">✓</b></div>`}${e.where === "outdoor" ? `<div class="pr"><div>Только на улице</div><b style="font-size:15px">🌳</b></div>` : ""}</div></div>
  </div>`;
}

// ===================== ДЕМОНСТРАЦИЯ ТЕХНИКИ =====================
// Сцена на 15–30 с: повторы в рабочем темпе (кадры старт ↔ финиш), подсказки по шагам техники, счёт повторов.
function demoPlan(e) {
  const hold = e.unit === "s";
  if (hold) return { hold, dur: e.cat === 1 ? 20 : 25, period: 0, reps: 0 };
  const period = e.cat === 2 || e.cat === 6 || e.group === "cardio" ? 1.4 : e.compound ? 3.2 : 2.6;
  let reps = Math.round(20 / period);
  const dur = Math.min(30, Math.max(15, Math.round(reps * period)));
  return { hold, period: dur / reps, reps, dur };
}
const ease = (x) => x * x * (3 - 2 * x);
function phaseAt(plan, t) { // 0 — старт, 1 — финиш
  if (plan.hold) return t < 1.5 ? ease(t / 1.5) : 1;
  const x = (t % plan.period) / plan.period;
  return x < 0.12 ? 0 : x < 0.45 ? ease((x - 0.12) / 0.33) : x < 0.58 ? 1 : x < 0.95 ? 1 - ease((x - 0.58) / 0.37) : 0;
}
let demoRaf = 0;
function startDemo(an) {
  cancelAnimationFrame(demoRaf);
  const top = state.stack[state.stack.length - 1], e = exById(top.id), plan = demoPlan(e);
  const f1 = an.querySelector(".f1"), ph = an.querySelector(".ph"), cap = document.getElementById("demo-cap"), rep = document.getElementById("demo-rep");
  const ar = document.getElementById("anim-r"), tl = document.getElementById("demo-t"), btn = $app.querySelector("[data-anim=toggle]"), spd = $app.querySelector("[data-anim=speed]");
  const st = { t: 0, playing: true, speed: 1, last: performance.now() };
  const steps = e.steps;
  const paint = () => {
    const t = Math.min(st.t, plan.dur), p = phaseAt(plan, t);
    if (f1) f1.style.opacity = p;
    an.style.setProperty("--zoom", 1 + 0.04 * p);
    if (ph) ph.style.transform = `scale(${1 + 0.25 * p})`;
    const si = Math.min(steps.length - 1, Math.floor((t / plan.dur) * steps.length));
    cap.textContent = steps[si];
    rep.textContent = plan.hold ? (t < plan.dur ? `Держи · ${Math.ceil(plan.dur - t)} с` : "Готово") : `Повтор ${Math.min(plan.reps, Math.floor(t / plan.period) + 1)} / ${plan.reps}`;
    ar.value = Math.round(t * 10); tl.textContent = `${fmt(Math.floor(t))} / ${fmt(plan.dur)}`;
  };
  const setPlaying = (v) => { st.playing = v; if (v && st.t >= plan.dur) st.t = 0; st.last = performance.now(); btn.textContent = v ? "❚❚" : "▶"; };
  const loop = (now) => {
    if (!an.isConnected) return;
    if (st.playing) { st.t += ((now - st.last) / 1000) * st.speed; if (st.t >= plan.dur) { st.t = plan.dur; setPlaying(false); btn.textContent = "↻"; } }
    st.last = now; paint(); demoRaf = requestAnimationFrame(loop);
  };
  btn.onclick = () => { haptic(); setPlaying(!st.playing); };
  an.onclick = () => { haptic(); setPlaying(!st.playing); };
  spd.onclick = () => { haptic(); const sp = { "1×": "0.5×", "0.5×": "2×", "2×": "1×" }[spd.textContent]; spd.textContent = sp; st.speed = parseFloat(sp); };
  ar.oninput = () => { st.t = +ar.value / 10; setPlaying(false); paint(); };
  paint(); demoRaf = requestAnimationFrame(loop);
}

// ===================== НАПОМИНАНИЯ В ЧАТЕ =====================
// Сервер напоминаний: worker/reminders.js на Cloudflare Workers. Пока адреса нет, блок показывает, что функция скоро.
const REMIND_URL = "https://ai-trainer.tim9728.workers.dev";
const remindCfg = () => ({ on: false, before: true, dayOf: true, beforeAt: "20:00", dayOfAt: "09:00", ...((store.profile && store.profile.remind) || {}) });
function syncRemind(extra = {}) {
  const p = store.profile, r = remindCfg();
  if (!REMIND_URL || !p || !tg || !tg.initData || (!r.on && !extra.force)) return Promise.resolve(null);
  const days = weekPlan(p).map((d) => (d ? d.title : null));
  let tz = "Europe/Moscow"; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  return fetch(REMIND_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ initData: tg.initData, ...r, days, tz, minutes: p.minutes, ...extra }) })
    .then((x) => x.json()).catch(() => null);
}
function remindBlock() {
  const r = remindCfg(), ready = !!REMIND_URL && !!(tg && tg.initData);
  const times = (key, list) => list.map((t) => `<button class="chip ${r[key] === t ? "active" : ""}" data-rtime="${key}:${t}" style="height:32px;padding:0 12px;font-size:13px">${t}</button>`).join("");
  return `<div class="section"><div class="section-head"><div class="h2">Напоминания</div></div>
  <div class="card">
    <div class="pr"><div><b>Писать мне в чат с ботом</b><div class="muted" style="font-size:12px;margin-top:4px">${ready ? "Накануне тренировки и в её день" : "Скоро: подключаем сервер напоминаний"}</div></div>
      <button class="toggle ${r.on ? "on" : ""}" data-remind="on" ${ready ? "" : 'style="opacity:.4;pointer-events:none"'} aria-label="Напоминания"><i></i></button></div>
    ${r.on ? `
    <div class="pr" style="display:block"><div style="display:flex;justify-content:space-between;align-items:center"><span>Накануне вечером</span><button class="toggle ${r.before ? "on" : ""}" data-remind="before"><i></i></button></div>
      ${r.before ? `<div class="chips" style="margin:10px 0 0;padding:0">${times("beforeAt", ["19:00", "20:00", "21:00", "22:00"])}</div>` : ""}</div>
    <div class="pr" style="display:block"><div style="display:flex;justify-content:space-between;align-items:center"><span>В день тренировки</span><button class="toggle ${r.dayOf ? "on" : ""}" data-remind="dayOf"><i></i></button></div>
      ${r.dayOf ? `<div class="chips" style="margin:10px 0 0;padding:0">${times("dayOfAt", ["07:00", "09:00", "12:00", "17:00"])}</div>` : ""}</div>
    <div class="pr"><div class="muted" style="font-size:13px">Дни берутся из твоего плана</div><button class="swap" data-remind-test>Проверить</button></div>` : ""}
  </div></div>`;
}
function setRemind(patch) {
  store.profile.remind = { ...remindCfg(), ...patch }; save(); render();
  syncRemind({ force: true }).then((res) => { if (res && !res.ok) toast("Не получилось сохранить напоминания"); });
}


// ===================== АДМИН-ПАНЕЛЬ =====================
// Видна только владельцу бота: сервер проверяет подпись Telegram и ID (worker/reminders.js).
const adm = { flag: (() => { try { return JSON.parse(localStorage.getItem("adm") || "{}"); } catch (e) { return {}; } })(), data: null, loading: false, err: "", text: "", button: true, sending: null };
function api(body) {
  if (!tg || !tg.initData) return Promise.resolve(null);
  return fetch(REMIND_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ initData: tg.initData, ...body }) }).then((x) => x.json()).catch(() => null);
}
function hello() {
  const stats = { w: store.history.length, r: (store.runs || []).length };
  const key = new Date().toDateString() + "|" + stats.w + "|" + stats.r;
  try { if (localStorage.getItem("hello") === key) return; } catch (e) {}
  api({ action: "hello", stats }).then((res) => {
    if (!res || !res.ok) return;
    try { localStorage.setItem("hello", key); } catch (e) {}
    const f = { admin: !!res.admin, claimable: !!res.claimable };
    if (f.admin !== !!adm.flag.admin || f.claimable !== !!adm.flag.claimable) { adm.flag = f; try { localStorage.setItem("adm", JSON.stringify(f)); } catch (e) {} if (state.stack.length && state.stack[state.stack.length - 1].type === "settings") render(); }
  });
}
function adminLoad() {
  adm.loading = true; adm.err = ""; render();
  api({ action: "admin_stats" }).then((res) => {
    adm.loading = false;
    if (res && res.ok) adm.data = res; else adm.err = res && res.error === "forbidden" ? "Нет доступа" : "Не удалось загрузить, проверь интернет";
    render();
  });
}
function adminBlock() {
  if (adm.flag.admin) return `<button class="row" data-admin style="padding:16px;margin-top:16px"><div class="grow"><div class="title" style="font-size:15px">🛠 Админ-панель</div><div class="sub" style="margin:4px 0 0">Пользователи, рассылка, статистика</div></div><span class="swap">Открыть</span></button>`;
  if (adm.flag.claimable) return `<div class="card" style="margin-top:16px"><b>Вы владелец бота?</b><p class="muted" style="font-size:13px;margin:6px 0 12px">Админ-панель пока ни за кем не закреплена. Нажмите, и она станет доступна только с вашего аккаунта Telegram.</p><button class="btn" data-admin-claim>Стать администратором</button></div>`;
  return "";
}
const ruN = (n, a, b, c) => { const m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); };
const ruDate = (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${+dd}.${m}.${y.slice(2)}`; };
function viewAdmin() {
  const D = adm.data;
  const head = `<div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button><div class="h1" style="margin-top:16px">Админ-панель</div></div></div>`;
  if (!D) return head + `<div class="card" style="text-align:center;padding:32px">${adm.err ? `<p>${esc(adm.err)}</p><button class="btn" data-admin-reload style="margin-top:12px">Повторить</button>` : "Загружаю…"}</div>`;
  const tile = (v, k) => `<div class="card" style="padding:14px"><div style="font:700 26px var(--display);color:var(--lime)">${v}</div><div class="muted" style="font-size:12px;margin-top:4px">${k}</div></div>`;
  const grid = (a) => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${a.join("")}</div>`;
  const S = adm.sending;
  const users = D.users.map((u) => {
    const nm = esc([u.f, u.l].filter(Boolean).join(" ") || "Без имени");
    return `<div class="row" style="padding:12px 16px;display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${nm}${u.b ? ' <span class="muted">· заблокировал</span>' : ""}</b><span class="muted" style="font-size:12px;white-space:nowrap">${ruDate(u.a || u.s)}</span></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${u.n ? "@" + esc(u.n) + " · " : ""}с ${ruDate(u.s)} · ${ruN(u.w || 0, "тренировка", "тренировки", "тренировок")} · ${ruN(u.r || 0, "пробежка", "пробежки", "пробежек")}${!u.a ? " · приложение не открывал" : ""}</div></div>`;
  }).join("");
  return head + `
  <div class="section"><div class="section-head"><div class="h2">Пользователи</div><button class="swap" data-admin-reload>${adm.loading ? "…" : "Обновить"}</button></div>
    ${grid([tile(D.total, "всего"), tile(D.actWeek, "активны за неделю"), tile(D.reminders, "с напоминаниями")])}
    <div class="card" style="margin-top:8px;font-size:14px;line-height:1.9">
      <div style="display:flex;justify-content:space-between"><span class="muted">Новые: сегодня / неделя / месяц</span><b>${D.newDay} / ${D.newWeek} / ${D.newMonth}</b></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">Активные: сегодня / неделя / месяц</span><b>${D.actDay} / ${D.actWeek} / ${D.actMonth}</b></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">Тренировок / пробежек всего</span><b>${D.workouts} / ${D.runs}</b></div>
      <div style="display:flex;justify-content:space-between"><span class="muted">Заблокировали бота</span><b>${D.blocked}</b></div>
    </div>
    ${D.webhook ? "" : `<div class="card" style="margin-top:8px"><b>Бот пока не отвечает на /start</b><p class="muted" style="font-size:13px;margin:6px 0 12px">Подключите, чтобы бот здоровался с новыми людьми и записывал их в список.</p><button class="btn" data-admin-webhook>Подключить</button></div>`}
  </div>
  <div class="section"><div class="section-head"><div class="h2">Рассылка</div></div>
    <div class="card">
      <textarea id="adm-text" rows="5" placeholder="Текст сообщения всем пользователям" style="width:100%;box-sizing:border-box;background:var(--bg);color:inherit;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;font-size:15px;resize:vertical" ${S && !S.done ? "disabled" : ""}>${esc(adm.text)}</textarea>
      <div class="pr" style="padding:12px 0 0"><span>Кнопка «Открыть приложение»</span><button class="toggle ${adm.button ? "on" : ""}" data-admin-btn><i></i></button></div>
      ${S ? `<p style="margin:12px 0 0">${S.done ? `Готово: доставлено ${S.sent}${S.failed ? `, не доставлено ${S.failed}` : ""}.` : `Отправляю… ${S.sent + S.failed} из ${S.total}`}</p>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" data-admin-test style="flex:1;background:var(--surface);color:inherit">Себе</button><button class="btn" data-admin-send style="flex:2" ${S && !S.done ? "disabled" : ""}>Отправить всем (${D.total - D.blocked})</button></div>
    </div>
  </div>
  <div class="section"><div class="section-head"><div class="h2">Список</div><span class="muted" style="font-size:13px">по последней активности</span></div>
    <div class="list">${users || '<div class="card muted">Пока никого</div>'}</div>
  </div>`;
}
function adminSend() {
  const text = adm.text.trim(); if (!text) { toast("Напишите текст"); return; }
  const n = adm.data.total - adm.data.blocked;
  const go2 = () => {
    adm.sending = { sent: 0, failed: 0, total: n, done: false }; render();
    const step = (offset) => api({ action: "admin_send", text, button: adm.button ? "Открыть приложение" : "", offset }).then((r) => {
      if (!r || !r.ok) { adm.sending.done = true; toast("Рассылка прервалась, проверь интернет"); render(); return; }
      adm.sending.sent += r.sent; adm.sending.failed += r.failed; adm.sending.total = r.total;
      if (r.done) { adm.sending.done = true; adm.text = ""; render(); } else { render(); step(r.next); }
    });
    step(0);
  };
  if (tg && tg.showConfirm) tg.showConfirm(`Отправить сообщение ${ruN(n, "пользователю", "пользователям", "пользователям")}?`, (ok) => ok && go2()); else if (confirm("Отправить всем?")) go2();
}

// ===================== НАСТРОЙКИ =====================
function viewSettings() {
  const p = store.profile;
  const rows = [
    ["Место", PLACES.find((x) => x.id === p.place).emo + " " + PLACES.find((x) => x.id === p.place).name, 0],
    ["Инвентарь", p.eq.length ? p.eq.map(eqName).join(", ") : "Только свой вес", 1],
    ["Цель", GOALS.find((g) => g.id === p.goal).name, 2],
    ["Уровень", LEVELS[p.level - 1].name, 3],
    ["Расписание", `${p.days} × ${p.minutes} мин в неделю`, 4],
  ];
  return `
  <div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button><div class="h1" style="margin-top:16px">Профиль</div></div></div>
  <div class="list">${rows.map(([k, v, step]) => `<button class="row" data-edit="${step}" style="padding:16px"><div class="grow"><div class="sub" style="margin:0 0 4px">${k}</div><div class="title" style="font-size:15px">${esc(v)}</div></div><span class="swap">Изменить</span></button>`).join("")}</div>
  <div class="coach" style="margin-top:16px"><div class="ava">AI</div><p>Когда меняешь инвентарь или цель, я сразу пересобираю план и все тренировки.</p></div>
  ${remindBlock()}
  ${adminBlock()}
  <button class="danger-link" data-reset>Сбросить все данные</button>`;
}

// ===================== ТАЙМЕР =====================
const timer = { mode: "interval", work: 40, rest: 20, rounds: 8, preset: 90, running: false, phase: "work", round: 1, left: 40, total: 40, elapsed: 0, laps: [] };
let ticker = null, audioCtx = null;
function beep(freq = 880, dur = 0.12) {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.2, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
function resetTimer() {
  timer.running = false; timer.phase = "work"; timer.round = 1; timer.elapsed = 0; timer.laps = [];
  timer.left = timer.total = timer.mode === "interval" ? timer.work : timer.mode === "rest" ? timer.preset : 0;
  stopTicker();
}
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
function tick() {
  if (timer.mode === "stopwatch") { timer.elapsed++; return paintTimer(); }
  timer.left--;
  if (timer.left <= 3 && timer.left > 0) beep(660, 0.08);
  if (timer.left <= 0) {
    if (timer.mode === "rest") { beep(990, 0.4); notify(); timer.running = false; stopTicker(); timer.left = 0; return render(); }
    if (timer.phase === "work") { timer.phase = "rest"; timer.left = timer.total = timer.rest; beep(520, 0.3); haptic("heavy"); }
    else if (timer.round < timer.rounds) { timer.round++; timer.phase = "work"; timer.left = timer.total = timer.work; beep(990, 0.3); haptic("heavy"); }
    else { beep(990, 0.6); notify(); timer.running = false; stopTicker(); timer.phase = "done"; return render(); }
  }
  paintTimer();
}
function paintTimer() {
  const fg = document.getElementById("ring-fg"); if (!fg) return;
  const C = 2 * Math.PI * 140;
  const p = timer.mode === "stopwatch" ? (timer.elapsed % 60) / 60 : timer.total ? timer.left / timer.total : 0;
  fg.style.strokeDashoffset = C * (1 - p);
  fg.classList.toggle("rest", timer.phase === "rest");
  document.getElementById("t-time").textContent = fmt(timer.mode === "stopwatch" ? timer.elapsed : timer.left);
  const ph = document.getElementById("t-phase");
  if (ph) ph.textContent = timer.mode === "interval" ? (timer.phase === "done" ? "Готово!" : timer.phase === "work" ? "Работа" : "Отдых") : timer.mode === "rest" ? "Отдых" : "Секундомер";
  const rd = document.getElementById("t-round"); if (rd) rd.textContent = `Раунд ${timer.round} из ${timer.rounds}`;
}
function viewTimer() {
  const C = 2 * Math.PI * 140;
  return `
  <div class="top"><div><div class="eyebrow">Интервалы и отдых</div><div class="h1" style="margin-top:8px">Таймер</div></div></div>
  <div class="seg">
    <button data-mode="interval" class="${timer.mode === "interval" ? "active" : ""}">Интервалы</button>
    <button data-mode="rest" class="${timer.mode === "rest" ? "active" : ""}">Отдых</button>
    <button data-mode="stopwatch" class="${timer.mode === "stopwatch" ? "active" : ""}">Секундомер</button>
  </div>
  <div class="ring-wrap"><svg viewBox="0 0 300 300"><circle class="ring-bg" cx="150" cy="150" r="140"/>
    <circle id="ring-fg" class="ring-fg" cx="150" cy="150" r="140" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
    <div class="ring-center"><div class="phase" id="t-phase"></div><div class="time" id="t-time">00:00</div>
      ${timer.mode === "interval" ? `<div class="muted" id="t-round" style="font-weight:600"></div>` : ""}</div></div>
  <div class="controls">
    <button class="btn dark round-btn" data-t="reset" aria-label="Сброс">↺</button>
    <button class="btn" data-t="toggle">${timer.running ? "❚❚ Пауза" : "▶ Старт"}</button>
    ${timer.mode === "stopwatch" ? `<button class="btn dark round-btn" data-t="lap" aria-label="Круг">⚑</button>` : timer.mode === "interval" ? `<button class="btn dark round-btn" data-t="skip" aria-label="Пропустить">⏭</button>` : ""}
  </div>
  ${timer.mode === "interval" ? `<div class="steppers">${[["work", "Работа", 5, "с"], ["rest", "Отдых", 5, "с"], ["rounds", "Раунды", 1, ""]].map(([k, l, s, u]) => `
    <div class="stepper"><div class="eyebrow">${l}</div><div class="val">${timer[k]}${u}</div>
    <div class="pm"><button data-step="${k}" data-d="-${s}">−</button><button data-step="${k}" data-d="${s}">+</button></div></div>`).join("")}</div>` : ""}
  ${timer.mode === "rest" ? `<div class="presets">${[30, 60, 90, 120].map((s) => `<button data-preset="${s}" class="${timer.preset === s ? "active" : ""}">${s < 60 ? s + "с" : s / 60 + "м"}</button>`).join("")}</div>` : ""}
  ${timer.mode === "stopwatch" && timer.laps.length ? `<div class="card laps"><table class="set-table">${timer.laps.map((l, i) => `<tr><td>Круг ${timer.laps.length - i}</td><td>${fmt(l)}</td></tr>`).join("")}</table></div>` : ""}`;
}

// ===================== ИСТОРИЯ =====================
function viewHistory() {
  const H = store.history, R = store.runs || [];
  if (!H.length && !R.length) return `<div class="top"><div><div class="eyebrow">Твои занятия</div><div class="h1" style="margin-top:8px">История</div></div></div>
    <div class="empty"><div class="big">📭</div><b>Пока пусто</b><p>Здесь появятся твои тренировки и пробежки. Начни первую, и я буду следить за прогрессом.</p><button class="btn" data-gocoach>К тренировке</button></div>`;
  const mins = H.reduce((s, h) => s + h.m, 0) + Math.round(R.reduce((s, x) => s + x.s, 0) / 60), vol = H.reduce((s, h) => s + h.v, 0), runKm = R.reduce((s, x) => s + x.m, 0) / 1000;
  const days = new Map(), addDay = (d, m) => { const k = new Date(d).toDateString(); days.set(k, (days.get(k) || 0) + m); };
  H.forEach((h) => addDay(h.d, h.m)); R.forEach((x) => addDay(x.d, x.s / 60));
  const start = mondayOf(); start.setDate(start.getDate() - 7 * 11);
  const cells = []; const now = new Date();
  for (let i = 0; i < 84; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const m = days.get(d.toDateString()) || 0;
    cells.push(`<i class="${m > 50 ? "l3" : m > 25 ? "l2" : m > 0 ? "l1" : ""}" ${d > now ? 'style="opacity:.25"' : ""}></i>`); }
  const items = [...H.map((h) => ({ d: h.d, h })), ...R.map((x) => ({ d: x.d, x }))].sort((a, b) => new Date(b.d) - new Date(a.d)).slice(0, 80);
  const groups = {}; items.forEach((it) => { const d = new Date(it.d); const k = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; (groups[k] = groups[k] || []).push(it); });
  const n = H.length + R.length;
  return `
  <div class="top"><div><div class="eyebrow">Твои занятия</div><div class="h1" style="margin-top:8px">История</div></div></div>
  <div class="stats">
    <div class="stat"><div class="big-num lime">${n}</div><div class="eyebrow">${plural(n, "занятие", "занятия", "занятий")}</div></div>
    <div class="stat"><div class="big-num">${mins >= 120 ? Math.round(mins / 60) + "ч" : mins}</div><div class="eyebrow">${mins >= 120 ? "часов" : "минут"}</div></div>
    ${vol || !R.length ? `<div class="stat"><div class="big-num">${(vol / 1000).toFixed(1)}т</div><div class="eyebrow">поднято</div></div>` : `<div class="stat"><div class="big-num">${runKm.toFixed(1)}</div><div class="eyebrow">км бега</div></div>`}
  </div>
  <div class="card section" style="margin-top:12px"><div class="section-head"><div class="h3">Активность</div><span class="muted" style="font-size:12px">12 недель</span></div><div class="heat">${cells.join("")}</div></div>
  ${Object.entries(groups).map(([m, its]) => `<div class="h2 month">${m}</div><div class="list">${its.map((it) => { if (it.x) return runRow(it.x); const h = it.h, d = new Date(h.d); return `
    <div class="hist"><div class="date-box"><b>${d.getDate()}</b><small>${DAYS[dow(d)]}</small></div>
      <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(h.t)}</div>
      <div class="hist-meta"><span>⏱ <b>${h.m}</b> мин</span><span>📋 <b>${h.x.length}</b> упр.</span>${h.v ? `<span>🏋 <b>${(h.v / 1000).toFixed(1)}</b> т</span>` : ""}</div>
      <div class="muted" style="font-size:12px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.x.map((x) => (exById(x[0]) || { name: x[0] }).name).join(" · ")}</div></div></div>`; }).join("")}</div>`).join("")}`;
}

// ===================== ПРОГРЕСС =====================
function lineChart(values, labels, unit = "") {
  const W = 340, H = 180, P = { l: 34, r: 12, t: 16, b: 26 };
  let min = Math.min(...values), max = Math.max(...values); if (max === min) { max += 1; min = Math.max(0, min - 1); }
  min = Math.floor(min * 0.95); max = Math.ceil(max * 1.03);
  const x = (i) => P.l + (values.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (values.length - 1));
  const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min));
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" "), last = values.length - 1;
  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  const step = Math.max(1, Math.ceil(values.length / 4));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    <defs><linearGradient id="limeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ccff00" stop-opacity=".35"/><stop offset="1" stop-color="#ccff00" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((t) => `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join("")}
    <polygon class="area" points="${x(0)},${H - P.b} ${pts} ${x(last)},${H - P.b}"/><polyline class="line" points="${pts}"/>
    ${labels.map((l, i) => (i % step === 0 || i === last) ? `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${i === last && last ? "end" : "middle"}">${l}</text>` : "").join("")}
    <circle class="dot" cx="${x(last)}" cy="${y(values[last])}" r="6"/>
    <text class="val" x="${x(last) - 10}" y="${y(values[last]) - 12}" text-anchor="end">${values[last]}${unit}</text></svg>`;
}
function barChart(values, labels) {
  const W = 340, H = 170, P = { l: 6, r: 6, t: 20, b: 24 }, max = Math.max(1, ...values), bw = (W - P.l - P.r) / values.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${values.map((v, i) => { const h = Math.max(v ? 4 : 2, (H - P.t - P.b) * (v / max)); const hi = i === values.length - 1;
    return `<rect class="bar ${hi ? "hi" : ""}" x="${P.l + i * bw + 4}" y="${H - P.b - h}" width="${bw - 8}" height="${h}" rx="6"/>
    ${v ? `<text class="val" x="${P.l + i * bw + bw / 2}" y="${H - P.b - h - 6}" text-anchor="middle">${v}</text>` : ""}
    <text class="axis" x="${P.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`; }).join("")}</svg>`;
}
function runWeeks() {
  const mon = mondayOf(), kms = Array(8).fill(0), labels = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(mon); d.setDate(d.getDate() - i * 7); labels.push(i === 0 ? "эта" : String(d.getDate())); }
  (store.runs || []).forEach((x) => { const w = Math.floor((mon - mondayOf(new Date(x.d))) / (7 * 864e5)); if (w >= 0 && w < 8) kms[7 - w] += x.m / 1000; });
  return `<div class="card section" style="margin-top:10px"><div class="section-head"><div><div class="eyebrow">Бег, км в неделю</div><div class="big-num" style="margin-top:6px">${kms[7].toFixed(1)} <span style="font-size:18px">км</span></div></div><span class="muted" style="font-size:13px">8 недель</span></div>${barChart(kms.map((k) => Math.round(k * 10) / 10), labels)}</div>`;
}
function viewProgress() {
  const H = store.history;
  if (!H.length && store.runs && store.runs.length) return `<div class="top"><div><div class="eyebrow">Графики и рекорды</div><div class="h1" style="margin-top:8px">Прогресс</div></div></div>${runWeeks()}`;
  if (!H.length) return `<div class="top"><div><div class="eyebrow">Графики и рекорды</div><div class="h1" style="margin-top:8px">Прогресс</div></div></div>
    <div class="empty"><div class="big">📈</div><b>Данных пока нет</b><p>После первых тренировок здесь появятся графики: сколько ты занимаешься, какие мышцы прорабатываешь и как растут рабочие веса. Вписывай вес в подходах, чтобы видеть рекорды.</p><button class="btn" data-gocoach>К тренировке</button></div>`;
  // тренировки по неделям
  const mon = mondayOf(), counts = Array(8).fill(0), labels = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(mon); d.setDate(d.getDate() - i * 7); labels.push(i === 0 ? "эта" : String(d.getDate())); }
  H.forEach((h) => { const w = Math.floor((mon - mondayOf(new Date(h.d))) / (7 * 864e5)); if (w >= 0 && w < 8) counts[7 - w]++; });
  // мышцы за 30 дней
  const since = Date.now() - 30 * 864e5, bySets = {};
  H.filter((h) => new Date(h.d) >= since).forEach((h) => h.x.forEach(([id, sets]) => { const e = exById(id); if (e) bySets[e.group] = (bySets[e.group] || 0) + sets; }));
  const maxSets = Math.max(1, ...Object.values(bySets));
  // веса
  const lifts = {};
  [...H].reverse().forEach((h) => h.x.forEach(([id, , , w]) => { if (w > 0) { (lifts[id] = lifts[id] || []).push({ d: new Date(h.d), w }); } }));
  const liftIds = Object.keys(lifts).sort((a, b) => lifts[b].length - lifts[a].length);
  if (!state.liftEx || !lifts[state.liftEx]) state.liftEx = liftIds[0] || null;
  const L = state.liftEx ? lifts[state.liftEx] : null;
  const records = liftIds.map((id) => [id, Math.max(...lifts[id].map((x) => x.w))]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `
  <div class="top"><div><div class="eyebrow">Графики и рекорды</div><div class="h1" style="margin-top:8px">Прогресс</div></div></div>
  <div class="card"><div class="section-head"><div><div class="eyebrow">Тренировок в неделю</div><div class="big-num" style="margin-top:6px">${counts[7]} <span style="font-size:18px">из ${store.profile.days}</span></div></div><span class="muted" style="font-size:13px">8 недель</span></div>${barChart(counts, labels)}</div>
  ${store.runs && store.runs.length ? runWeeks() : ""}
  <div class="card section" style="margin-top:10px"><div class="section-head"><div class="eyebrow">Подходов по мышцам за 30 дней</div></div>
    <div class="bar-list">${Object.keys(GROUPS).map((g) => `<div class="br"><span>${GROUPS[g].name}</span><div class="tr"><i style="width:${((bySets[g] || 0) / maxSets) * 100}%"></i></div><span>${bySets[g] || 0}</span></div>`).join("")}</div></div>
  ${L ? `<div class="section"><div class="chips">${liftIds.map((id) => `<button class="chip ${id === state.liftEx ? "active" : ""}" data-lift="${id}">${exById(id).name}</button>`).join("")}</div>
    <div class="card" style="margin-top:12px"><div class="section-head"><div><div class="eyebrow">Рабочий вес</div><div class="big-num" style="margin-top:6px">${L[L.length - 1].w} <span style="font-size:18px">кг</span></div></div>
      ${L.length > 1 ? `<span class="delta">${L[L.length - 1].w >= L[0].w ? "▲ +" : "▼ "}${Math.round((L[L.length - 1].w - L[0].w) * 10) / 10} кг</span>` : ""}</div>
      ${lineChart(L.map((x) => x.w), L.map((x) => `${x.d.getDate()} ${MONTHS_SHORT[x.d.getMonth()]}`), " кг")}</div></div>
    <div class="section"><div class="section-head"><div class="h2">Личные рекорды</div></div>
    <div class="card">${records.map(([id, w]) => `<div class="pr"><div style="font-weight:700">${exById(id).name}</div><b class="lime">${w} кг</b></div>`).join("")}</div></div>`
  : `<div class="coach section"><div class="ava">AI</div><p>Вписывай рабочий вес в подходах с гантелями, гирей или штангой, и здесь появятся графики силы и личные рекорды.</p></div>`}`;
}

// ===================== СОБЫТИЯ =====================
function bind() {
  const on = (sel, fn) => $app.querySelectorAll(sel).forEach((el) => (el.onclick = (ev) => { haptic(); fn(el, ev); }));
  // анкета
  on("[data-place]", (el) => { const o = state.ob; o.place = el.dataset.place; if (!o.eqTouched) o.eq = [...PLACES.find((p) => p.id === o.place).eq]; render(); });
  on("[data-eq]", (el) => { const o = state.ob, id = el.dataset.eq; o.eqTouched = true; o.eq = o.eq.includes(id) ? o.eq.filter((x) => x !== id) : [...o.eq, id]; render(); });
  on("[data-goal]", (el) => { state.ob.goal = el.dataset.goal; render(); });
  on("[data-level]", (el) => { state.ob.level = +el.dataset.level; render(); });
  on("[data-days]", (el) => { state.ob.days = +el.dataset.days; render(); });
  on("[data-min]", (el) => { state.ob.minutes = +el.dataset.min; render(); });
  on("[data-ob]", (el) => {
    if (el.dataset.ob === "back") { state.obStep--; render(); return; }
    if (state.obStep < OB_STEPS - 1) { state.obStep++; render(); window.scrollTo(0, 0); } else finishOnboarding();
  });
  // главная
  on("[data-day]", (el) => { const i = +el.dataset.day; const w = dayWorkout(i); if (!w) { toast("В этот день по плану отдых"); return; } push({ type: "preview", w, day: i }); });
  on("[data-resume]", () => { state.stack = [{ type: "session" }]; render(); });
  on("[data-settings]", () => push({ type: "settings" }));
  on("[data-builder]", () => { state.builder = new Set(); push({ type: "builder" }); });
  on("[data-bg]", (el) => { const g = el.dataset.bg; state.builder.has(g) ? state.builder.delete(g) : state.builder.add(g); render(); });
  on("[data-build]", () => { const gs = [...state.builder]; const title = gs.map((g) => GROUPS[g].name).join(" + ");
    state.stack.pop(); push({ type: "preview", w: buildWorkout(title, gs, Date.now() & 0xffffff, store.profile) }); });
  on("[data-back]", () => pop());
  on("[data-gocoach]", () => go("coach"));
  // предпросмотр
  on("[data-swap]", (el) => { const v = state.stack[state.stack.length - 1]; swapItem(v.w, +el.dataset.swap); render(); });
  on("[data-reshuffle]", () => { const v = state.stack[state.stack.length - 1]; const k = `${weekNo()}-${v.day}`; store.shuffle[k] = (store.shuffle[k] || 0) + 1; save(); v.w = dayWorkout(v.day); render(); });
  on("[data-start]", () => { const v = state.stack[state.stack.length - 1];
    if (store.session) { toast("Сначала заверши текущую тренировку"); state.stack = [{ type: "session" }]; render(); return; } startSession(v.w); });
  on("[data-ex]", (el) => push({ type: "exercise", id: el.dataset.ex }));
  // тренировка
  on("[data-set]", (el) => { const [i, j] = el.dataset.set.split(":").map(Number); const it = store.session.items[i];
    it.done[j] = !it.done[j]; save(); if (it.done[j]) { haptic("medium"); startRest(it.rest); } render(); });
  $app.querySelectorAll("[data-w]").forEach((el) => (el.oninput = () => { store.session.items[+el.dataset.w].w = el.value; save(); }));
  on("[data-finish]", () => finishSession());
  on("[data-cancel]", () => { store.session = null; clearInterval(rest.timer); rest.left = 0; save(); go("coach"); toast("Тренировка отменена"); });
  // настройки
  on("[data-edit]", (el) => { state.ob = { ...store.profile, eq: [...store.profile.eq], eqTouched: true }; state.obStep = +el.dataset.edit; state.obReturn = true; render(); window.scrollTo(0, 0); });
  on("[data-reset]", (el) => { if (el.dataset.confirm) { resetAll(); toast("Данные сброшены"); } else { el.dataset.confirm = "1"; el.textContent = "Нажми ещё раз, чтобы удалить всё"; } });
  // каталог
  on("[data-group]", (el) => { state.group = el.dataset.group; state.limit = 40; render(); });
  on("[data-mine]", (el) => { state.onlyMine = el.dataset.mine === "1"; state.limit = 40; render(); });
  on("[data-q]", (el) => { state.query = el.dataset.q; state.group = "all"; state.limit = 40; render(); });
  on("[data-more]", () => { const y = window.scrollY; state.limit += 40; render(); window.scrollTo(0, y); });
  on("[data-basket]", (el) => { const id = el.dataset.basket, b = store.basket;
    store.basket = b.includes(id) ? b.filter((x) => x !== id) : [...b, id]; save(); notify(); render(); });
  const an = document.getElementById("anim");
  if (an) startDemo(an);
  // напоминания
  on("[data-remind]", (el) => { const k = el.dataset.remind, r = remindCfg();
    if (k === "on" && !r.on && tg && tg.requestWriteAccess) { try { tg.requestWriteAccess((ok) => { if (ok) { setRemind({ on: true }); toast("Буду напоминать 🔔"); } else toast("Без разрешения бот не сможет писать"); }); return; } catch (e) {} }
    setRemind({ [k]: !r[k] }); });
  on("[data-rtime]", (el) => { const [k, t] = el.dataset.rtime.split(/:(.+)/); setRemind({ [k]: t }); });
  on("[data-admin]", () => { push({ type: "admin" }); adminLoad(); });
  on("[data-admin-reload]", () => adminLoad());
  on("[data-admin-claim]", () => api({ action: "admin_claim" }).then((r) => {
    if (r && r.ok) { adm.flag = { admin: true, claimable: false }; try { localStorage.setItem("adm", JSON.stringify(adm.flag)); } catch (e) {} toast("Готово, админ-панель ваша"); push({ type: "admin" }); adminLoad(); }
    else toast(r && r.error === "taken" ? "Администратор уже назначен" : "Не получилось, попробуй ещё раз");
  }));
  on("[data-admin-webhook]", () => api({ action: "admin_webhook" }).then((r) => { toast(r && r.ok ? "Бот подключён" : "Не получилось подключить"); adminLoad(); }));
  on("[data-admin-btn]", () => { adm.button = !adm.button; render(); });
  on("[data-admin-test]", () => { if (!adm.text.trim()) { toast("Напишите текст"); return; } api({ action: "admin_send", test: 1, text: adm.text, button: adm.button ? "Открыть приложение" : "" }).then((r) => toast(r && r.ok ? "Отправил вам в чат" : "Не получилось отправить")); });
  on("[data-admin-send]", () => adminSend());
  const admText = document.getElementById("adm-text"); if (admText) admText.oninput = () => { adm.text = admText.value; };
  on("[data-remind-test]", () => syncRemind({ action: "test" }).then((res) => toast(res && res.ok ? "Отправил тестовое сообщение в чат" : "Не получилось, проверь, что бот не заблокирован")));
  // бег
  on("[data-run]", (el) => { const a = el.dataset.run;
    if (a === "start") { if (geo.err === "denied") { toast("Нужен доступ к геопозиции"); return; } runStart(); }
    if (a === "pause") runPause();
    if (a === "resume") runResume();
    if (a === "finish") { if (el.dataset.confirm) runFinish(); else { el.dataset.confirm = "1"; el.textContent = "Точно завершить?"; setTimeout(() => { if (el.isConnected) { delete el.dataset.confirm; el.textContent = "■ Завершить"; } }, 3000); } } });
  on("[data-wt]", (el) => { store.profile.weight = Math.max(30, Math.min(200, runWeight() + +el.dataset.wt)); save(); render(); });
  on("[data-voice]", () => { store.profile.voice = store.profile.voice === false; save(); render(); });
  on("[data-runview]", (el) => push({ type: "run", i: +el.dataset.runview }));
  on("[data-rundel]", (el) => { if (el.dataset.confirm) { store.runs.splice(+el.dataset.rundel, 1); save(); pop(); toast("Пробежка удалена"); } else { el.dataset.confirm = "1"; el.textContent = "Нажми ещё раз, чтобы удалить"; } });
  on("[data-unbasket]", (el) => { const v = state.stack[state.stack.length - 1], it = v.w.items.splice(+el.dataset.unbasket, 1)[0];
    store.basket = store.basket.filter((x) => x !== it.id); save(); render(); });
  on("[data-basket-go]", () => push({ type: "preview", w: basketWorkout(), basket: true }));
  on("[data-basket-clear]", () => { store.basket = []; save(); render(); toast("Подборка очищена"); });
  on("[data-video]", (el) => { const u = "https://www.youtube.com/results?search_query=" + encodeURIComponent(el.dataset.video + " exercise technique");
    try { tg && tg.openLink ? tg.openLink(u) : window.open(u, "_blank"); } catch (e) { window.open(u, "_blank"); } });
  const s = document.getElementById("search");
  let st = null;
  if (s) s.oninput = () => { clearTimeout(st); st = setTimeout(() => { state.query = s.value; state.limit = 40; const pos = s.selectionStart; render(); const n = document.getElementById("search"); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
  // прогресс
  on("[data-lift]", (el) => { state.liftEx = el.dataset.lift; render(); });
  // таймер
  on("[data-mode]", (el) => { timer.mode = el.dataset.mode; resetTimer(); render(); });
  on("[data-preset]", (el) => { timer.preset = +el.dataset.preset; resetTimer(); render(); });
  on("[data-step]", (el) => { const k = el.dataset.step; timer[k] = Math.max(k === "rounds" ? 1 : 5, timer[k] + +el.dataset.d); resetTimer(); render(); });
  on("[data-t]", (el) => {
    const a = el.dataset.t;
    if (a === "toggle") {
      if (timer.phase === "done" || (timer.mode === "rest" && timer.left === 0)) resetTimer();
      timer.running = !timer.running;
      if (timer.running) { beep(880, 0.05); ticker = setInterval(tick, 1000); } else stopTicker();
      render();
    }
    if (a === "reset") { resetTimer(); render(); }
    if (a === "skip") { timer.left = 1; tick(); }
    if (a === "lap") { timer.laps.unshift(timer.elapsed); render(); }
  });
  if (!state.ob && store.profile && state.tab === "timer" && !state.stack.length) { paintTimer(); if (timer.running && !ticker) ticker = setInterval(tick, 1000); }
  const clock = document.getElementById("s-clock");
  if (clock && store.session) sessionClock = setInterval(() => { if (store.session) clock.textContent = fmt(Math.floor((Date.now() - store.session.startedAt) / 1000)); }, 1000);
}

// @@RUN@@
// раз в день обновляем расписание на сервере напоминаний (план мог поменяться)
try { const today = new Date().toDateString(); if (remindCfg().on && localStorage.getItem("remind_sync") !== today) { syncRemind(); localStorage.setItem("remind_sync", today); } } catch (e) {}

render();
cloudLoad();
hello();
