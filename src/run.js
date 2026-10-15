// ===================== БЕГ НА УЛИЦЕ =====================
// GPS-трек, секундомер, темп, калории, сплиты по км, карта маршрута (Leaflet + тайлы CARTO/OSM).
// Карта OpenStreetMap без ключа; тёмный вид делаем фильтром. Если тайлы не грузятся — запасной сервер Esri.
const RUN_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const RUN_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const RUN_TILES_2 = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const RUN_ATTR_2 = "&copy; Esri, OpenStreetMap";
if (!Array.isArray(store.runs)) store.runs = [];

// --- загрузка Leaflet по требованию (сначала своя копия, затем CDN) ---
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  const add = (src, css) => new Promise((ok, fail) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = css; document.head.appendChild(l);
    const s = document.createElement("script"); s.src = src; s.onload = () => ok(window.L); s.onerror = fail; document.head.appendChild(s);
  });
  leafletP = add("vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css")
    .catch(() => add("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"))
    .catch(() => { leafletP = null; return null; });
  return leafletP;
}

// --- математика ---
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const paceStr = (secPerKm) => (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600 ? "—" : `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`);
const hms = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600); return h ? `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : fmt(s); };
const km = (m) => (m / 1000).toFixed(2);
const runWeight = () => (store.profile && store.profile.weight) || 70;
// ккал: бег ≈ 1 ккал на кг на км, ходьба ≈ 0,6
const kcalFor = (meters, mps) => runWeight() * (meters / 1000) * (mps > 1.8 ? 1.03 : 0.62);

// --- состояние текущей пробежки (store.run сохраняется, чтобы пережить перезагрузку) ---
const geo = { watch: null, poll: null, fix: null, err: null, wake: null, tick: null };
const runElapsed = (r = store.run) => (r ? (r.acc + (r.seg ? Date.now() - r.seg : 0)) / 1000 : 0);
function runPacing(r) {
  // текущий темп по последним ~30 с движения
  const pts = r.segs[r.segs.length - 1] || [];
  if (pts.length < 2) return Infinity;
  const last = pts[pts.length - 1]; let d = 0, i = pts.length - 1;
  while (i > 0 && last[2] - pts[i - 1][2] <= 30) { d += distM(pts[i - 1], pts[i]); i--; }
  const t = last[2] - pts[i][2];
  if (runElapsed(r) - last[2] > 12) return Infinity; // давно не двигались
  return d > 15 && t > 0 ? t / (d / 1000) : Infinity;
}

function onFix(c) {
  geo.fix = c; geo.err = null;
  const r = store.run;
  if (r && r.seg) {
    const acc = c.accuracy || 99;
    const p = [c.latitude, c.longitude, Math.round(runElapsed(r) * 10) / 10, c.altitude != null ? Math.round(c.altitude * 10) / 10 : null];
    let seg = r.segs[r.segs.length - 1];
    if (!seg) { seg = []; r.segs.push(seg); }
    const prev = seg[seg.length - 1];
    if (acc <= (prev ? 30 : 50)) {
      if (!prev) { seg.push(p); runMapAdd(p, true); }
      else {
        const d = distM(prev, p), dt = Math.max(0.5, p[2] - prev[2]);
        if (d >= 5 && d / dt < 12) {
          seg.push(p); r.m += d; r.k += kcalFor(d, d / dt);
          if (p[3] != null && acc <= 20) { if (r.alt == null) r.alt = p[3]; else if (p[3] - r.alt > 3) { r.up += p[3] - r.alt; r.alt = p[3]; } else if (r.alt - p[3] > 3) r.alt = p[3]; }
          const kmDone = Math.floor(r.m / 1000);
          if (kmDone > r.sp.length) { const t = p[2] - r.sp.reduce((a, b) => a + b, 0); r.sp.push(Math.round(t)); runCue(kmDone, p[2], t); }
          runMapAdd(p, false);
          if (Date.now() - (geo.saved || 0) > 8000) { geo.saved = Date.now(); save(); }
        }
      }
    }
  }
  else if (!r && runDot && runMap) { runDot.setLatLng([c.latitude, c.longitude]); runMap.panTo([c.latitude, c.longitude]); }
  paintRun();
}
function onGeoErr(e) {
  geo.err = e && e.code === 1 ? "denied" : "nofix";
  if (e && e.code === 1 && tryTelegramLocation()) return;
  paintRun();
}
// В некоторых версиях Telegram браузерная геолокация закрыта — тогда берём координаты через LocationManager бота
function tryTelegramLocation() {
  const lm = tg && tg.LocationManager;
  if (!lm || geo.poll) return false;
  const go = () => {
    if (!lm.isLocationAvailable) { geo.err = "denied"; paintRun(); return; }
    const once = () => lm.getLocation((d) => { if (!d) { if (!lm.isAccessGranted) { geo.err = "denied"; clearInterval(geo.poll); geo.poll = null; paintRun(); } return; }
      onFix({ latitude: d.latitude, longitude: d.longitude, altitude: d.altitude, accuracy: d.horizontal_accuracy || 20 }); });
    once(); geo.poll = setInterval(once, 3000);
  };
  try { lm.inited ? go() : lm.init(go); return true; } catch (e) { return false; }
}
function geoStart() {
  if (geo.watch != null || geo.poll) return;
  if (navigator.geolocation) geo.watch = navigator.geolocation.watchPosition((p) => onFix(p.coords), onGeoErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  else if (!tryTelegramLocation()) { geo.err = "nogeo"; paintRun(); }
}
function geoStop() {
  if (geo.watch != null) { navigator.geolocation.clearWatch(geo.watch); geo.watch = null; }
  if (geo.poll) { clearInterval(geo.poll); geo.poll = null; }
}
async function wakeOn() { try { if (navigator.wakeLock && !geo.wake) { geo.wake = await navigator.wakeLock.request("screen"); geo.wake.addEventListener("release", () => (geo.wake = null)); } } catch (e) {} }
function wakeOff() { try { geo.wake && geo.wake.release(); } catch (e) {} geo.wake = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && store.run) { wakeOn(); paintRun(); } });

function speak(text) {
  if (!store.profile || store.profile.voice === false) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = "ru-RU"; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
const ruMin = (s) => { const m = Math.floor(s / 60), sec = Math.round(s % 60); return `${m} ${plural(m, "минута", "минуты", "минут")}${sec ? ` ${sec} ${plural(sec, "секунда", "секунды", "секунд")}` : ""}`; };
function runCue(kmN, total, split) { notify(); speak(`${kmN} ${plural(kmN, "километр", "километра", "километров")}. Время ${ruMin(total)}. Темп ${ruMin(split)} на километр.`); }

function runStart() {
  store.run = { d: new Date().toISOString(), acc: 0, seg: Date.now(), segs: [[]], m: 0, k: 0, up: 0, alt: null, sp: [] };
  save(); notify(); wakeOn(); geoStart();
  if (geo.fix) onFix(geo.fix);
  speak("Старт. Удачной пробежки!");
  render();
}
function runPause() { const r = store.run; if (!r || !r.seg) return; r.acc += Date.now() - r.seg; r.seg = null; save(); haptic("medium"); speak("Пауза"); render(); }
function runResume() { const r = store.run; if (!r || r.seg) return; r.seg = Date.now(); r.segs.push([]); save(); haptic("medium"); speak("Продолжаем"); render(); }
function simplify(pts, max) { if (pts.length <= max) return pts; const step = pts.length / max, out = []; for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]); out.push(pts[pts.length - 1]); return out; }
function runFinish(quiet) {
  const r = store.run; if (!r) return;
  if (r.seg) { r.acc += Date.now() - r.seg; r.seg = null; }
  const s = Math.round(r.acc / 1000);
  geoStop(); wakeOff(); store.run = null;
  if (s < 20 && r.m < 30) { save(); if (!quiet) { render(); toast("Слишком короткая пробежка, не сохранил"); } return; }
  const total = r.segs.reduce((a, g) => a + g.length, 0), maxPts = 900;
  const segs = r.segs.filter((g) => g.length).map((g) => simplify(g, Math.max(2, Math.round((g.length / Math.max(1, total)) * maxPts))).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, Math.round(p[2])]));
  const run = { d: r.d, s, m: Math.round(r.m), k: Math.round(r.k), up: Math.round(r.up), sp: r.sp, segs };
  store.runs.unshift(run); save(); notify();
  if (quiet) return;
  speak(`Пробежка завершена. ${km(r.m).replace(".", ",")} километра за ${ruMin(s)}.`);
  state.stack = [{ type: "run", i: 0, fresh: true }]; render(); window.scrollTo(0, 0);
}

// --- карта ---
let runMap = null, runLine = null, runDot = null;
function killMap() { if (runMap) { try { runMap.remove(); } catch (e) {} } runMap = runLine = runDot = null; }
function runMapAdd(p, newSeg) {
  if (!runMap || !window.L) return;
  if (newSeg || !runLine) runLine = L.polyline([], { color: "#ccff00", weight: 5, opacity: 0.95 }).addTo(runMap);
  runLine.addLatLng([p[0], p[1]]);
  if (runDot) runDot.setLatLng([p[0], p[1]]);
  runMap.panTo([p[0], p[1]], { animate: true });
}
let mapMounting = false;
async function mountMap(el, segs, opts = {}) {
  mapMounting = true;
  const Lf = await loadLeaflet();
  mapMounting = false;
  if (!Lf || !el.isConnected) { if (!Lf) el.innerHTML = `<div class="map-off">Карта не загрузилась. Маршрут сохранён и появится, когда будет интернет.</div>`; return; }
  killMap();
  el.innerHTML = "";
  runMap = Lf.map(el, { zoomControl: false, attributionControl: true, dragging: !opts.live, scrollWheelZoom: false, tap: false }).setView(opts.center || [55.75, 37.62], opts.center ? 16 : 11);
  runMap.attributionControl.setPrefix(false);
  const tl = Lf.tileLayer(RUN_TILES, { maxZoom: 19, attribution: RUN_ATTR, className: "tiles-dark" }).addTo(runMap);
  let bad = 0, ok = 0;
  tl.on("tileload", () => ok++);
  tl.on("tileerror", () => { if (++bad === 3 && !ok && runMap) { runMap.removeLayer(tl); Lf.tileLayer(RUN_TILES_2, { maxZoom: 19, attribution: RUN_ATTR_2, className: "tiles-dark" }).addTo(runMap); } });
  const all = [];
  segs.forEach((g) => { if (g.length) { runLine = Lf.polyline(g.map((p) => [p[0], p[1]]), { color: "#ccff00", weight: 5, opacity: 0.95 }).addTo(runMap); g.forEach((p) => all.push([p[0], p[1]])); } });
  if (opts.live) {
    const here = all.length ? all[all.length - 1] : opts.center;
    if (here) runDot = Lf.circleMarker(here, { radius: 8, color: "#000", weight: 3, fillColor: "#ccff00", fillOpacity: 1 }).addTo(runMap);
    if (here) runMap.setView(here, 16);
  } else if (all.length) {
    Lf.circleMarker(all[0], { radius: 7, color: "#000", weight: 3, fillColor: "#3ddc84", fillOpacity: 1 }).addTo(runMap).bindTooltip("Старт");
    Lf.circleMarker(all[all.length - 1], { radius: 7, color: "#000", weight: 3, fillColor: "#ff4d4d", fillOpacity: 1 }).addTo(runMap).bindTooltip("Финиш");
    runMap.fitBounds(all, { padding: [28, 28] });
  }
}

// --- экраны ---
function runStatsBlock(o) {
  return `<div class="run-grid">
    <div><span class="eyebrow">Дистанция</span><b id="r-dist">${km(o.m)}</b><small>км</small></div>
    <div><span class="eyebrow">${o.live ? "Темп сейчас" : "Средний темп"}</span><b id="r-pace">${paceStr(o.pace)}</b><small>мин/км</small></div>
    <div><span class="eyebrow">Калории</span><b id="r-kcal">${Math.round(o.k)}</b><small>ккал</small></div>
    <div><span class="eyebrow">${o.live ? "Ср. темп" : "Скорость"}</span><b id="r-avg">${o.live ? paceStr(o.s / (o.m / 1000)) : (o.m / 1000 / (o.s / 3600) || 0).toFixed(1)}</b><small>${o.live ? "мин/км" : "км/ч"}</small></div>
    <div><span class="eyebrow">${o.live ? "Скорость" : "Подъём"}</span><b id="r-speed">${o.live ? (o.m / 1000 / (o.s / 3600) || 0).toFixed(1) : o.up}</b><small>${o.live ? "км/ч" : "м"}</small></div>
    <div><span class="eyebrow">${o.live ? "Подъём" : "Шаги ≈"}</span><b id="r-up">${o.live ? Math.round(o.up) : Math.round(o.m / 1.05).toLocaleString("ru")}</b><small>${o.live ? "м" : "шагов"}</small></div>
  </div>`;
}
function gpsLabel() {
  if (geo.err === "denied") return `<span class="gps bad">● Нет доступа к геолокации</span>`;
  if (geo.err === "nogeo") return `<span class="gps bad">● Геолокация недоступна</span>`;
  if (!geo.fix) return `<span class="gps wait">● Ищу GPS…</span>`;
  const a = Math.round(geo.fix.accuracy || 0);
  return `<span class="gps ${a <= 15 ? "ok" : a <= 35 ? "wait" : "bad"}">● GPS ${a <= 15 ? "отличный" : a <= 35 ? "нормальный" : "слабый"} · ±${a} м</span>`;
}
function viewRun() {
  geoStart();
  const r = store.run;
  if (r) {
    const s = runElapsed(r);
    return `
    <div class="top"><div><div class="eyebrow" id="r-gps">${gpsLabel()}</div><div class="run-clock" id="r-time">${hms(s)}</div></div></div>
    <div class="run-map live" id="run-map"></div>
    ${runStatsBlock({ live: true, m: r.m, k: r.k, s, up: r.up, pace: runPacing(r) })}
    ${r.sp.length ? `<div class="muted" style="font-size:13px;margin-top:10px">Последний км: <b style="color:#fff">${paceStr(r.sp[r.sp.length - 1])}</b> мин/км</div>` : ""}
    <div class="run-ctl">${r.seg ? `<button class="btn dark" data-run="pause">❚❚ Пауза</button>` : `<button class="btn" data-run="resume">▶ Продолжить</button>`}
      <button class="btn outline" data-run="finish">■ Завершить</button></div>
    <div class="muted" style="font-size:12px;text-align:center;margin-top:12px">Не блокируй экран: при блокировке телефон приостанавливает Telegram, и GPS перестаёт писать маршрут.</div>`;
  }
  const R = store.runs, mon = mondayOf();
  const weekM = R.filter((x) => new Date(x.d) >= mon).reduce((a, x) => a + x.m, 0), allM = R.reduce((a, x) => a + x.m, 0);
  const best = R.filter((x) => x.m >= 1000).map((x) => x.s / (x.m / 1000)).sort((a, b) => a - b)[0];
  const p = store.profile;
  return `
  <div class="top"><div><div class="eyebrow" id="r-gps">${gpsLabel()}</div><div class="h1" style="margin-top:8px">Бег</div></div></div>
  <div class="run-map" id="run-map"></div>
  <button class="run-start" data-run="start" ${geo.err ? 'style="opacity:.5"' : ""}><span>Старт</span></button>
  ${geo.err === "denied" ? `<div class="coach"><div class="ava">!</div><p>Разреши Telegram доступ к геопозиции: на iPhone Настройки → Telegram → Геопозиция → «При использовании», на Android Настройки → Приложения → Telegram → Разрешения → Местоположение. Затем открой экран бега снова.</p></div>` : ""}
  <div class="stats" style="margin-top:16px">
    <div class="stat"><div class="big-num lime">${km(weekM)}</div><div class="eyebrow">км за неделю</div></div>
    <div class="stat"><div class="big-num">${km(allM)}</div><div class="eyebrow">км всего</div></div>
    <div class="stat"><div class="big-num">${best ? paceStr(best) : "—"}</div><div class="eyebrow">лучший темп</div></div>
  </div>
  <div class="card section" style="margin-top:12px">
    <div class="pr"><div>Вес для расчёта калорий</div><div class="wt-stepper"><button data-wt="-1">−</button><b>${runWeight()} кг</b><button data-wt="1">+</button></div></div>
    <div class="pr"><div>Голосовые подсказки каждый км</div><button class="toggle ${p.voice === false ? "" : "on"}" data-voice aria-label="Голос"><i></i></button></div>
  </div>
  ${R.length ? `<div class="section"><div class="section-head"><div class="h2">Пробежки</div></div><div class="list">${R.slice(0, 5).map(runRow).join("")}</div></div>` : ""}`;
}
function runRow(x) {
  const i = store.runs.indexOf(x), d = new Date(x.d);
  return `<button class="hist" style="width:100%;text-align:left" data-runview="${i}"><div class="date-box"><b>${d.getDate()}</b><small>${DAYS[dow(d)]}</small></div>
    <div style="flex:1;min-width:0"><div style="font-weight:700">🏃 Бег · ${km(x.m)} км</div>
    <div class="hist-meta"><span>⏱ <b>${hms(x.s)}</b></span><span>⚡ <b>${paceStr(x.s / (x.m / 1000))}</b> /км</span><span>🔥 <b>${x.k}</b> ккал</span></div></div></button>`;
}
function viewRunDetail(v) {
  const x = store.runs[v.i];
  if (!x) return `<div class="empty" style="margin-top:40px"><b>Пробежка не найдена</b></div>`;
  const d = new Date(x.d), maxSp = Math.max(...x.sp, 1), minSp = Math.min(...x.sp);
  const tail = x.m - x.sp.length * 1000;
  return `
  <div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button>
    <div class="eyebrow" style="margin-top:16px">${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}</div>
    <div class="h1" style="margin-top:8px">${v.fresh ? "Отличная <span class=\"lime\">пробежка!</span>" : "Пробежка"}</div></div></div>
  <div class="run-map big" id="run-map"></div>
  <div class="run-hero"><div><b>${km(x.m)}</b><span>км</span></div><div><b>${hms(x.s)}</b><span>время</span></div></div>
  ${runStatsBlock({ live: false, m: x.m, k: x.k, s: x.s, up: x.up, pace: x.s / (x.m / 1000) })}
  ${x.sp.length ? `<div class="section"><div class="section-head"><div class="h2">Темп по километрам</div></div>
    <div class="card"><div class="bar-list">${x.sp.map((t, i) => `<div class="br"><span>${i + 1} км</span><div class="tr"><i style="width:${(t / maxSp) * 100}%;${t === minSp && x.sp.length > 1 ? "" : "opacity:.55"}"></i></div><span>${paceStr(t)}</span></div>`).join("")}
    ${tail > 50 ? `<div class="br"><span>+${(tail / 1000).toFixed(2)}</span><div class="tr"></div><span></span></div>` : ""}</div>
    ${x.sp.length > 1 ? `<div class="muted" style="font-size:12px;margin-top:10px">Лучший километр: <b class="lime">${paceStr(minSp)}</b> мин/км</div>` : ""}</div></div>` : ""}
  <button class="danger-link" data-rundel="${v.i}">Удалить пробежку</button>`;
}
// обновление цифр без перерисовки всего экрана
function paintRun() {
  const g = document.getElementById("r-gps"); if (g) g.innerHTML = gpsLabel();
  const r = store.run; if (!r) { const top = state.stack[state.stack.length - 1]; if (!top && state.tab === "run" && !runMap && !mapMounting && geo.fix) afterRunRender(); return; }
  const s = runElapsed(r), set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("r-time", hms(s)); set("r-dist", km(r.m)); set("r-pace", paceStr(runPacing(r))); set("r-kcal", Math.round(r.k));
  set("r-avg", paceStr(s / (r.m / 1000))); set("r-speed", (r.m / 1000 / (s / 3600) || 0).toFixed(1)); set("r-up", Math.round(r.up));
  const rb = document.getElementById("runbar"); if (rb) rb.querySelector("b").textContent = `${hms(s)} · ${km(r.m)} км`;
}
function afterRunRender() {
  const el = document.getElementById("run-map");
  if (!el) { killMap(); return; }
  const top = state.stack[state.stack.length - 1];
  if (top && top.type === "run") { const x = store.runs[top.i]; if (x) mountMap(el, x.segs); return; }
  const r = store.run, here = geo.fix ? [geo.fix.latitude, geo.fix.longitude] : null;
  if (r) mountMap(el, r.segs, { live: true, center: here });
  else if (here) mountMap(el, [], { live: true, center: here });
  else el.innerHTML = `<div class="map-off">${geo.err ? "Без доступа к геопозиции карта не покажет, где ты" : "Определяю, где ты…"}</div>`;
}
function renderRunBar() {
  let el = document.getElementById("runbar");
  const top = state.stack[state.stack.length - 1];
  const show = store.run && store.profile && !(state.tab === "run" && !top) && !(top && top.type === "session");
  document.body.classList.toggle("has-runbar", !!show);
  if (!show) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("button"); el.id = "runbar"; el.className = "runbar"; document.body.appendChild(el);
    el.onclick = () => { haptic(); go("run"); }; }
  el.innerHTML = `<span>🏃 ${store.run.seg ? "Бег идёт" : "Пауза"}</span><b>${hms(runElapsed())} · ${km(store.run.m)} км</b>`;
}
setInterval(() => { if (store.run) paintRun(); }, 1000);
// вкладку «Бег» убрали в v3.11: незавершённую пробежку сохраняем в историю, прошлые пробежки там же
if (store.run) runFinish(true);
