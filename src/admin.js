// ===================== АДМИН-ПАНЕЛЬ =====================
// Видна только владельцу бота: сервер проверяет подпись Telegram и ID (worker/reminders.js).
const adm = {
  flag: (() => { try { return JSON.parse(localStorage.getItem("adm") || "{}"); } catch (e) { return {}; } })(),
  tab: "overview", data: null, loading: false, err: "",
  text: "", button: true, photo: false, hasPhoto: false, seg: "all", segN: null, when: "now", at: "", sending: null, scheduled: null,
  inbox: null, user: null, reply: "", q: "", cfg: null, bot: "", srcName: "",
};
function api(body) {
  if (!tg || !tg.initData) return Promise.resolve(null);
  return fetch(REMIND_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ initData: tg.initData, ...body }) }).then((x) => x.json()).catch(() => null);
}
const saveFlag = () => { try { localStorage.setItem("adm", JSON.stringify(adm.flag)); } catch (e) {} };

// раз в день (и после каждой новой тренировки) отправляем на сервер краткую карточку пользователя
function hello() {
  const H = store.history, R = store.runs || [];
  const stats = { w: H.length, r: R.length };
  const key = new Date().toDateString() + "|" + stats.w + "|" + stats.r;
  try { if (localStorage.getItem("hello") === key) return; } catch (e) {}
  const freq = {};
  H.slice(0, 30).forEach((h) => (h.x || []).forEach(([id]) => (freq[id] = (freq[id] || 0) + 1)));
  const ex = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 3);
  const p = store.profile;
  let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  const src = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || "";
  api({ action: "hello", stats, ex, tz, src,
    profile: p ? { goal: p.goal, level: p.level, place: p.place, eq: p.eq, days: p.days, minutes: p.minutes } : null,
    wk: H.slice(0, 15).map((h) => [String(h.d).slice(0, 10), h.t, h.m]),
    rn: R.slice(0, 10).map((r) => [String(r.d).slice(0, 10), Math.round(r.m || 0), Math.round(r.s || 0)]),
  }).then((res) => {
    if (!res || !res.ok) return;
    try { localStorage.setItem("hello", key); } catch (e) {}
    const f = { admin: !!res.admin, claimable: !!res.claimable, banned: !!res.banned };
    const changed = ["admin", "claimable", "banned"].some((k) => f[k] !== !!adm.flag[k]);
    adm.flag = f; saveFlag();
    if (changed) render();
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
function adminTab(t) {
  adm.tab = t; render(); window.scrollTo(0, 0);
  if (t === "inbox") api({ action: "admin_inbox" }).then((r) => { if (r && r.ok) { adm.inbox = r.list; render(); } });
  if (t === "send") {
    api({ action: "admin_photo" }).then((r) => { if (r && r.ok) { adm.hasPhoto = r.has; if (!r.has) adm.photo = false; render(); } });
    api({ action: "admin_scheduled" }).then((r) => { if (r && r.ok) { adm.scheduled = r.list; render(); } });
    segCount();
  }
  if (t === "more") api({ action: "admin_cfg" }).then((r) => { if (r && r.ok) { adm.cfg = r.cfg; adm.bot = r.bot || ""; render(); } });
}
function segCount() { adm.segN = null; api({ action: "admin_count", seg: adm.seg }).then((r) => { if (r && r.ok) { adm.segN = r.n; render(); } }); }
function openUser(id) {
  adm.user = { id, loading: true }; adm.reply = ""; push({ type: "admin_user", id });
  api({ action: "admin_user", id }).then((r) => { if (r && r.ok) { adm.user = r; render(); } else { adm.user = { id, err: true }; render(); } });
  api({ action: "admin_read", id }).then(() => { if (adm.inbox) adm.inbox.forEach((c) => c.id === id && (c.unread = 0)); if (adm.data) adm.data.unread = Math.max(0, (adm.data.unread || 0) - 1); });
}

function adminBlock() {
  if (adm.flag.admin) return `<button class="row" data-admin style="padding:16px;margin-top:16px"><div class="grow"><div class="title" style="font-size:15px">🛠 Админ-панель</div><div class="sub" style="margin:4px 0 0">Пользователи, сообщения, рассылка, статистика</div></div><span class="swap">Открыть</span></button>`;
  if (adm.flag.claimable) return `<div class="card" style="margin-top:16px"><b>Вы владелец бота?</b><p class="muted" style="font-size:13px;margin:6px 0 12px">Админ-панель пока ни за кем не закреплена. Нажмите, и она станет доступна только с вашего аккаунта Telegram.</p><button class="btn" data-admin-claim>Стать администратором</button></div>`;
  return "";
}

// ---------- помощники ----------
const ruN = (n, a, b, c) => { const m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); };
const ruDate = (d) => { if (!d) return "—"; const [y, m, dd] = String(d).slice(0, 10).split("-"); return `${+dd}.${m}.${y.slice(2)}`; };
const ruTime = (ts) => { const d = new Date(ts); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); };
const uName = (u) => esc([u.f, u.l].filter(Boolean).join(" ") || "Без имени");
const goalName = (id) => (GOALS.find((g) => g.id === id) || {}).name || id;
const levelName = (id) => (LEVELS.find((g) => String(g.id) === String(id)) || {}).name || id;
const placeName = (id) => (PLACES.find((g) => g.id === id) || {}).name || id;
const exName = (id) => { try { const e = exById(id); return e ? e.name : id; } catch (e) { return id; } };
const kv = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px"><span class="muted">${k}</span><b style="text-align:right">${v}</b></div>`;
const tile = (v, k) => `<div class="card" style="padding:14px"><div style="font:700 26px var(--display);color:var(--lime)">${v}</div><div class="muted" style="font-size:12px;margin-top:4px">${k}</div></div>`;
const grid3 = (a) => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${a.join("")}</div>`;
const field = "width:100%;box-sizing:border-box;background:var(--bg);color:inherit;border:1px solid var(--line);border-radius:12px;padding:12px;font:inherit;font-size:15px";

// столбики за 30 дней; нажатие на столбик показывает значение
function admBars(id, title, days, vals) {
  const max = Math.max(1, ...vals), W = 300, H = 90, bw = W / vals.length;
  const total = vals.reduce((a, b) => a + b, 0);
  const bars = vals.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * (H - 14)) : 0, x = i * bw;
    return `<g data-tip="${id}|${ruDate(days[i])}: ${v}"><rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"/>${h ? `<rect x="${x + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="2" fill="var(--lime)"/>` : ""}</g>`;
  }).join("");
  return `<div class="card" style="margin-top:8px"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:14px">${title}</b><span class="muted" style="font-size:12px" id="tip-${id}">за 30 дней: ${total}</span></div>
    <svg viewBox="0 0 ${W} ${H + 1}" style="width:100%;height:auto;margin-top:10px;display:block"><line x1="0" y1="${H + 0.5}" x2="${W}" y2="${H + 0.5}" stroke="var(--line)"/>${bars}</svg>
    <div class="muted" style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px"><span>${ruDate(days[0])}</span><span>макс. ${max} в день</span><span>сегодня</span></div></div>`;
}
// горизонтальные полоски «что популярнее»
function hBars(title, obj, nameFn, empty = "Пока нет данных") {
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8), max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="card" style="margin-top:8px"><b style="font-size:14px">${title}</b>${rows.length ? rows.map(([k, v]) => `
    <div style="margin-top:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(nameFn(k))}</span><b>${v}</b></div>
    <div style="height:6px;border-radius:4px;background:var(--surface-2);margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${(v / max) * 100}%;background:var(--lime);border-radius:4px"></i></div></div>`).join("") : `<p class="muted" style="font-size:13px;margin:8px 0 0">${empty}</p>`}</div>`;
}

// ---------- экраны ----------
function viewAdmin() {
  const D = adm.data;
  const head = `<div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button><div class="h1" style="margin-top:16px">Админ-панель</div></div>
    <button class="swap" data-admin-reload style="align-self:flex-end">${adm.loading ? "…" : "Обновить"}</button></div>`;
  if (!D) return head + `<div class="card" style="text-align:center;padding:32px">${adm.err ? `<p>${esc(adm.err)}</p><button class="btn" data-admin-reload style="margin-top:12px">Повторить</button>` : "Загружаю…"}</div>`;
  const tabs = [["overview", "Обзор"], ["inbox", "Сообщения" + (D.unread ? ` (${D.unread})` : "")], ["send", "Рассылка"], ["people", "Люди"], ["more", "Ещё"]];
  const bar = `<div class="chips" style="margin-bottom:12px">${tabs.map(([k, n]) => `<button class="chip ${adm.tab === k ? "active" : ""}" data-admin-tab="${k}">${n}</button>`).join("")}</div>`;
  const body = { overview: admOverview, inbox: admInbox, send: admSend, people: admPeople, more: admMore }[adm.tab](D);
  return head + bar + body;
}

function admOverview(D) {
  const R = D.ret, base = D.retBase;
  const ret = { "Один день": R.d0, "2–4 дня": R.d1_3, "5–8 дней": R.d4_7, "9–31 день": R.d8_30, "Больше месяца": R.d30 };
  return `
  ${grid3([tile(D.total, "всего"), tile(D.actWeek, "активны за неделю"), tile(D.reminders, "с напоминаниями")])}
  <div class="card" style="margin-top:8px;font-size:14px;line-height:1.9">
    ${kv("Новые: сегодня / неделя / месяц", `${D.newDay} / ${D.newWeek} / ${D.newMonth}`)}
    ${kv("Активные: сегодня / неделя / месяц", `${D.actDay} / ${D.actWeek} / ${D.actMonth}`)}
    ${kv("Тренировок / пробежек всего", `${D.workouts} / ${D.runs}`)}
    ${kv("Заблокировали бота / в бане", `${D.blocked} / ${D.banned}`)}
  </div>
  ${D.webhook ? "" : `<div class="card" style="margin-top:8px"><b>Бот пока не отвечает на /start</b><p class="muted" style="font-size:13px;margin:6px 0 12px">Подключите, чтобы бот здоровался с новыми людьми, принимал сообщения и записывал всех в список.</p><button class="btn" data-admin-webhook>Подключить</button></div>`}
  <div class="section"><div class="section-head"><div class="h2">Графики</div><span class="muted" style="font-size:12px">нажмите на столбик</span></div>
    ${admBars("new", "Новые пользователи", D.days, D.newBy)}
    ${admBars("dau", "Заходили в приложение", D.days, D.dau)}
    ${hBars("Сколько дней люди пользуются", Object.fromEntries(Object.entries(ret).filter(([, v]) => v)), (k) => k, "Появится через неделю: считаем тех, кто пришёл 7+ дней назад")}
    ${base ? `<p class="muted" style="font-size:12px;margin:6px 4px 0">Из ${ruN(base, "человека", "человек", "человек")}, пришедших неделю назад и раньше, ${D.ret.alive} всё ещё заходят.</p>` : ""}
  </div>
  <div class="section"><div class="section-head"><div class="h2">Популярное</div></div>
    ${hBars("Цели", D.goals, goalName)}
    ${hBars("Упражнения (топ у пользователей)", D.ex, exName, "Появится, когда люди начнут тренироваться")}
    ${hBars("Уровень", D.levels, levelName)}
    ${hBars("Где тренируются", D.places, placeName)}
    ${hBars("Откуда пришли", D.sources, (k) => k, "Создайте ссылки во вкладке «Ещё»")}
  </div>`;
}

function admInbox() {
  const L = adm.inbox;
  if (!L) return `<div class="card muted">Загружаю…</div>`;
  if (!L.length) return `<div class="card"><b>Пока нет сообщений</b><p class="muted" style="font-size:13px;margin:6px 0 0">Всё, что люди пишут боту, появится здесь. Бот также пришлёт вам уведомление в чат: ответьте на него свайпом влево, и ответ уйдёт человеку от лица бота.</p></div>`;
  return `<div class="list">${L.map((c) => `<button class="row" data-admin-user="${c.id}" style="padding:12px 16px;display:block;text-align:left;width:100%">
    <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${uName(c)}${c.unread ? ` <span style="background:var(--lime);color:#000;border-radius:999px;padding:1px 7px;font-size:12px">${c.unread}</span>` : ""}</b><span class="muted" style="font-size:12px;white-space:nowrap">${ruTime(c.last)}</span></div>
    <div class="muted" style="font-size:13px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.d === "out" ? "Вы: " : ""}${esc(c.t)}</div></button>`).join("")}</div>`;
}

function segOptions(D) {
  const o = [["all", "Все"], ["new7", "Новые за неделю"], ["act7", "Активные за неделю"], ["idle7", "Не заходили 7+ дней"], ["idle30", "Не заходили 30+ дней"], ["noapp", "Нажали /start, но не открыли приложение"]];
  GOALS.forEach((g) => o.push(["goal:" + g.id, "Цель: " + g.name]));
  LEVELS.forEach((g) => o.push(["level:" + g.id, "Уровень: " + g.name]));
  PLACES.forEach((g) => o.push(["place:" + g.id, "Место: " + g.name]));
  Object.keys(D.sources || {}).forEach((s) => o.push(["src:" + s, "Источник: " + s]));
  return o;
}
function admSend(D) {
  const S = adm.sending, busy = S && !S.done, opts = segOptions(D);
  const segName = (opts.find((o) => o[0] === adm.seg) || ["", "Все"])[1];
  const limit = adm.photo ? 1024 : 4096;
  const sch = adm.scheduled || [];
  const stLabel = (b) => b.status === "done" ? `отправлено ${b.sent}${b.failed ? `, не доставлено ${b.failed}` : ""}` : b.status === "run" ? `идёт: ${b.sent} отправлено` : "ждёт отправки";
  return `
  <div class="card">
    <div class="sub" style="margin:0 0 6px">Кому</div>
    <select id="adm-seg" style="${field};appearance:auto" ${busy ? "disabled" : ""}>${opts.map(([k, n]) => `<option value="${esc(k)}" ${adm.seg === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
    <div class="muted" style="font-size:13px;margin-top:6px">${adm.segN == null ? "Считаю получателей…" : `Получат: ${ruN(adm.segN, "человек", "человека", "человек")}`}</div>
    <div class="sub" style="margin:14px 0 6px">Текст</div>
    <textarea id="adm-text" rows="5" maxlength="${limit}" placeholder="Сообщение. {name} заменится на имя человека" style="${field};resize:vertical" ${busy ? "disabled" : ""}>${esc(adm.text)}</textarea>
    <div class="pr" style="padding:12px 0 0"><span>Кнопка «Открыть приложение»</span><button class="toggle ${adm.button ? "on" : ""}" data-admin-btn><i></i></button></div>
    <div class="pr" style="padding:12px 0 0"><div><span>Картинка</span><div class="muted" style="font-size:12px;margin-top:2px">${adm.hasPhoto ? "Последнее фото, которое вы прислали боту. До 1024 символов текста" : "Пришлите фото боту в чат, и оно появится здесь"}</div></div>
      <button class="toggle ${adm.photo ? "on" : ""}" data-admin-photo ${adm.hasPhoto ? "" : 'style="opacity:.4;pointer-events:none"'}><i></i></button></div>
    <div class="sub" style="margin:14px 0 6px">Когда</div>
    <div class="chips" style="margin:0;padding:0"><button class="chip ${adm.when === "now" ? "active" : ""}" data-admin-when="now">Сейчас</button><button class="chip ${adm.when === "later" ? "active" : ""}" data-admin-when="later">Запланировать</button></div>
    ${adm.when === "later" ? `<input type="datetime-local" id="adm-at" value="${esc(adm.at)}" style="${field};margin-top:10px"><div class="muted" style="font-size:12px;margin-top:6px">По вашему времени. Сервер рассылает партиями по ~40 человек каждые 15 минут.</div>` : ""}
    ${S ? `<p style="margin:12px 0 0">${S.done ? `Готово: доставлено ${S.sent}${S.failed ? `, не доставлено ${S.failed}` : ""}.` : `Отправляю… ${S.sent + S.failed} из ${S.total}. Не закрывайте приложение.`}</p>` : ""}
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" data-admin-test style="flex:1;background:var(--surface-2);color:inherit">Себе</button>
      <button class="btn" data-admin-send style="flex:2" ${busy ? "disabled" : ""}>${adm.when === "later" ? "Запланировать" : "Отправить"}</button></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Сегмент: ${esc(segName)}. Заблокировавшие бота и забаненные не получат.</div>
  </div>
  ${sch.length ? `<div class="section"><div class="section-head"><div class="h2">Запланированные и прошлые</div></div><div class="list">${sch.map((b) => `
    <div class="row" style="padding:12px 16px;display:block"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${ruTime(b.at)}</b>${b.status === "wait" ? `<button class="swap" data-admin-unsch="${esc(b.key)}">Отменить</button>` : ""}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">${esc(b.segName || b.seg)} · ${stLabel(b)}${b.photo ? " · с картинкой" : ""}</div>
    <div style="font-size:13px;margin-top:6px;white-space:pre-wrap">${esc(String(b.text).slice(0, 200))}</div></div>`).join("")}</div></div>` : ""}`;
}

function admPeople(D) {
  return `<input id="adm-q" placeholder="Поиск по имени, @нику или ID" value="${esc(adm.q)}" style="${field}">
  <div id="adm-people">${admPeopleList(D)}</div>`;
}
function admPeopleList(D) {
  const q = adm.q.trim().toLowerCase();
  const L = D.users.filter((u) => !q || [u.f, u.l, u.n, String(u.id)].join(" ").toLowerCase().includes(q)).slice(0, 200);
  return `<div class="muted" style="font-size:12px;margin:8px 4px">Найдено: ${L.length}. Сортировка по последней активности.</div>
  <div class="list">${L.map((u) => `<button class="row" data-admin-user="${u.id}" style="padding:12px 16px;display:block;text-align:left;width:100%">
    <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${uName(u)}${u.x ? ' <span class="muted">· бан</span>' : u.b ? ' <span class="muted">· заблокировал</span>' : ""}</b><span class="muted" style="font-size:12px;white-space:nowrap">${ruDate(u.a || u.s)}</span></div>
    <div class="muted" style="font-size:12px;margin-top:4px">${u.n ? "@" + esc(u.n) + " · " : ""}${ruN(u.w || 0, "тренировка", "тренировки", "тренировок")} · ${ruN(u.r || 0, "пробежка", "пробежки", "пробежек")}${u.g ? " · " + esc(goalName(u.g)) : ""}${!u.a ? " · приложение не открывал" : ""}</div></button>`).join("") || '<div class="card muted">Никого не нашли</div>'}</div>`;
}

function admMore() {
  const C = adm.cfg;
  if (!C) return `<div class="card muted">Загружаю…</div>`;
  const link = (s) => `https://t.me/${adm.bot}?start=${encodeURIComponent(s)}`;
  const srcs = Object.entries((adm.data && adm.data.sources) || {}).sort((a, b) => b[1] - a[1]);
  return `
  <div class="section" style="margin-top:0"><div class="section-head"><div class="h2">Автосообщения</div></div>
    <div class="card">
      <div class="pr" style="padding:0"><div><b>«Давно не тренировался»</b><div class="muted" style="font-size:12px;margin-top:4px">В 18:00 по времени человека, один раз после перерыва</div></div><button class="toggle ${C.nudge ? "on" : ""}" data-admin-cfg="nudge"><i></i></button></div>
      ${C.nudge ? `<div class="chips" style="margin:12px 0 0;padding:0">${[3, 5, 7, 14].map((d) => `<button class="chip ${C.nudgeDays === d ? "active" : ""}" data-admin-ndays="${d}" style="height:32px;padding:0 12px;font-size:13px">через ${d} дн.</button>`).join("")}</div>
      <textarea id="adm-ntext" rows="3" style="${field};margin-top:12px;resize:vertical">${esc(C.nudgeText)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><span class="muted" style="font-size:12px">{name} — имя, {days} — дней без тренировок</span><button class="swap" data-admin-ntext>Сохранить</button></div>` : ""}
      <div class="pr" style="padding:16px 0 0;margin-top:16px;border-top:1px solid var(--line)"><div><b>Поздравления с рубежами</b><div class="muted" style="font-size:12px;margin-top:4px">10, 25, 50, 100, 200, 300 и 500 тренировок</div></div><button class="toggle ${C.milestones ? "on" : ""}" data-admin-cfg="milestones"><i></i></button></div>
    </div></div>
  <div class="section"><div class="section-head"><div class="h2">Ссылки-источники</div></div>
    <div class="card">
      <p class="muted" style="font-size:13px;margin:0 0 10px">Создайте отдельную ссылку для каждого места, где рекламируетесь. В «Обзоре» будет видно, сколько людей пришло по каждой.</p>
      <input id="adm-src" placeholder="Название латиницей, например instagram" value="${esc(adm.srcName)}" style="${field}">
      <div id="adm-srclink">${srcLink()}</div>
    </div>
    ${srcs.length ? `<div class="list" style="margin-top:8px">${srcs.map(([s, n]) => `<div class="row" style="padding:12px 16px"><div class="grow"><b style="font-size:14px">${esc(s)}</b><div class="muted" style="font-size:12px;margin-top:2px">${ruN(n, "человек", "человека", "человек")}</div></div><button class="swap" data-admin-copy="${esc(link(s))}">Копировать</button></div>`).join("")}</div>` : ""}
  </div>
  <div class="section"><div class="section-head"><div class="h2">Выгрузка</div></div>
    <div class="card"><p class="muted" style="font-size:13px;margin:0 0 12px">Бот пришлёт вам в чат файл со всеми пользователями. Он открывается в Excel и Google Таблицах.</p><button class="btn" data-admin-export>Выгрузить в Excel</button></div>
  </div>`;
}

function srcLink() {
  const nm = adm.srcName.replace(/[^\w-]/g, ""), link = `https://t.me/${adm.bot}?start=${encodeURIComponent(nm)}`;
  return nm && adm.bot ? `<div style="margin-top:10px;font-size:14px;word-break:break-all">${esc(link)}</div><button class="btn" data-admin-copy="${esc(link)}" style="margin-top:10px">Скопировать ссылку</button>` : "";
}

function viewAdminUser() {
  const R = adm.user || {};
  const head = `<div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button></div></div>`;
  if (R.loading) return head + `<div class="card muted">Загружаю…</div>`;
  if (!R.user) return head + `<div class="card">Не удалось загрузить</div>`;
  const u = R.user, d = R.data || {}, p = d.pr;
  const status = u.x ? "В бане" : u.b ? "Заблокировал бота" : u.a ? `Заходил ${ruDate(u.a)}` : "Не открывал приложение";
  return head + `
  <div class="h1" style="margin:16px 0 4px">${uName(u)}</div>
  <div class="muted" style="font-size:14px">${u.n ? `<a href="#" data-admin-tg="${esc(u.n)}" style="color:var(--lime)">@${esc(u.n)}</a> · ` : ""}ID ${u.id} · ${status}</div>
  <div class="card" style="margin-top:12px;font-size:14px;line-height:1.9">
    ${kv("Первый вход", ruDate(u.s))}
    ${kv("Тренировок / пробежек", `${u.w || 0} / ${u.r || 0}`)}
    ${kv("Напоминания", R.reminders ? "включены" : "выключены")}
    ${u.src ? kv("Источник", esc(u.src)) : ""}
    ${p ? kv("Цель", esc(goalName(p.goal))) + kv("Уровень", esc(levelName(p.level))) + kv("Место", esc(placeName(p.place))) + kv("Расписание", `${p.days} × ${p.minutes} мин`) + kv("Инвентарь", esc((p.eq || []).map(eqName).join(", ") || "свой вес")) : kv("Анкета", "не заполнена")}
  </div>
  ${(d.wk || []).length ? `<div class="section"><div class="section-head"><div class="h2">Тренировки</div></div><div class="card" style="font-size:14px;line-height:1.9">${d.wk.map(([dt, t, m]) => kv(ruDate(dt), `${esc(t)} · ${m} мин`)).join("")}</div></div>` : ""}
  ${(d.rn || []).length ? `<div class="section"><div class="section-head"><div class="h2">Пробежки</div></div><div class="card" style="font-size:14px;line-height:1.9">${d.rn.map(([dt, m, s]) => kv(ruDate(dt), `${(m / 1000).toFixed(2)} км · ${fmt(s)}`)).join("")}</div></div>` : ""}
  <div class="section"><div class="section-head"><div class="h2">Переписка</div></div>
    ${(R.msgs || []).length ? `<div style="display:flex;flex-direction:column;gap:6px">${R.msgs.map((m) => `<div style="max-width:85%;align-self:${m.d === "out" ? "flex-end" : "flex-start"};background:${m.d === "out" ? "var(--lime)" : "var(--surface)"};color:${m.d === "out" ? "#000" : "inherit"};border-radius:16px;padding:10px 12px;font-size:14px;white-space:pre-wrap">${esc(m.t)}<div style="font-size:11px;opacity:.6;margin-top:4px">${ruTime(m.ts)}</div></div>`).join("")}</div>` : `<p class="muted" style="font-size:13px">Сообщений пока не было.</p>`}
    ${u.b ? `<p class="muted" style="font-size:13px;margin-top:12px">Человек заблокировал бота, написать ему нельзя.</p>` : `
    <textarea id="adm-reply" rows="3" placeholder="Написать от лица бота" style="${field};margin-top:12px;resize:vertical">${esc(adm.reply)}</textarea>
    <button class="btn block" data-admin-msg style="margin-top:8px">Отправить</button>`}
  </div>
  <button class="danger-link" data-admin-ban>${u.x ? "Снять бан" : "Забанить: бот перестанет отвечать, приложение закроется"}</button>`;
}

function viewBanned() {
  return `<div class="empty" style="padding-top:30vh"><div class="big">🚫</div><b>Доступ ограничен</b><p>Если это ошибка, напишите боту в чат.</p></div>`;
}

// ---------- действия ----------
function adminSend() {
  const text = adm.text.trim(); if (!text) { toast("Напишите текст"); return; }
  const segName = (segOptions(adm.data).find((o) => o[0] === adm.seg) || ["", ""])[1];
  const payload = { text, button: adm.button ? "Открыть приложение" : "", photo: adm.photo ? 1 : 0, seg: adm.seg };
  const ask = (q, fn) => (tg && tg.showConfirm ? tg.showConfirm(q, (ok) => ok && fn()) : confirm(q) && fn());
  if (adm.when === "later") {
    const at = adm.at && new Date(adm.at);
    if (!at || isNaN(at) || at < Date.now()) { toast("Выберите время в будущем"); return; }
    api({ action: "admin_schedule", ...payload, segName, at: at.toISOString() }).then((r) => {
      if (r && r.ok) { toast("Рассылка запланирована"); adm.text = ""; adminTab("send"); } else toast("Не получилось запланировать");
    });
    return;
  }
  const n = adm.segN == null ? "" : ` ${ruN(adm.segN, "человеку", "людям", "людям")}`;
  ask(`Отправить сообщение${n}?`, () => {
    adm.sending = { sent: 0, failed: 0, total: adm.segN || 0, done: false }; render();
    const step = (offset) => api({ action: "admin_send", ...payload, offset }).then((r) => {
      if (!r || !r.ok) { adm.sending.done = true; toast("Рассылка прервалась, проверь интернет"); render(); return; }
      adm.sending.sent += r.sent; adm.sending.failed += r.failed; adm.sending.total = r.total;
      if (r.done) { adm.sending.done = true; adm.text = ""; render(); } else { render(); step(r.next); }
    });
    step(0);
  });
}
function setCfg(set) {
  adm.cfg = { ...adm.cfg, ...set }; render();
  api({ action: "admin_cfg", set }).then((r) => { if (r && r.ok) { adm.cfg = r.cfg; render(); } else toast("Не сохранилось, проверь интернет"); });
}
function copyText(t) {
  const done = () => toast("Ссылка скопирована");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => toast("Скопируйте ссылку вручную"));
  else toast("Скопируйте ссылку вручную");
}

function bindAdmin(on) {
  on("[data-admin]", () => { adm.tab = "overview"; push({ type: "admin" }); adminLoad(); });
  on("[data-admin-reload]", () => { adminLoad(); if (adm.tab !== "overview") adminTab(adm.tab); });
  on("[data-admin-claim]", () => api({ action: "admin_claim" }).then((r) => {
    if (r && r.ok) { adm.flag = { admin: true, claimable: false }; saveFlag(); toast("Готово, админ-панель ваша"); push({ type: "admin" }); adminLoad(); }
    else toast(r && r.error === "taken" ? "Администратор уже назначен" : "Не получилось, попробуй ещё раз");
  }));
  on("[data-admin-webhook]", () => api({ action: "admin_webhook" }).then((r) => { toast(r && r.ok ? "Бот подключён" : "Не получилось подключить"); adminLoad(); }));
  on("[data-admin-tab]", (el) => adminTab(el.dataset.adminTab));
  on("[data-tip]", (el) => { const [id, t] = el.dataset.tip.split("|"); const c = document.getElementById("tip-" + id); if (c) c.textContent = t; });
  // рассылка
  on("[data-admin-btn]", () => { adm.button = !adm.button; render(); });
  on("[data-admin-photo]", () => { adm.photo = !adm.photo; render(); });
  on("[data-admin-when]", (el) => { adm.when = el.dataset.adminWhen; render(); });
  on("[data-admin-test]", () => { if (!adm.text.trim()) { toast("Напишите текст"); return; } api({ action: "admin_send", test: 1, text: adm.text, photo: adm.photo ? 1 : 0, button: adm.button ? "Открыть приложение" : "" }).then((r) => toast(r && r.ok ? "Отправил вам в чат" : "Не получилось отправить")); });
  on("[data-admin-send]", () => adminSend());
  on("[data-admin-unsch]", (el) => api({ action: "admin_unschedule", key: el.dataset.adminUnsch }).then(() => { toast("Рассылка отменена"); adminTab("send"); }));
  const $ = (id) => document.getElementById(id);
  if ($("adm-text")) $("adm-text").oninput = (e) => { adm.text = e.target.value; };
  if ($("adm-at")) $("adm-at").oninput = (e) => { adm.at = e.target.value; };
  if ($("adm-seg")) $("adm-seg").onchange = (e) => { adm.seg = e.target.value; segCount(); render(); };
  // люди
  if ($("adm-q")) $("adm-q").oninput = (e) => { adm.q = e.target.value; $("adm-people").innerHTML = admPeopleList(adm.data); bind(); };
  on("[data-admin-user]", (el) => openUser(+el.dataset.adminUser));
  on("[data-admin-tg]", (el, ev) => { ev.preventDefault(); const url = "https://t.me/" + el.dataset.adminTg; tg && tg.openTelegramLink ? tg.openTelegramLink(url) : window.open(url); });
  if ($("adm-reply")) $("adm-reply").oninput = (e) => { adm.reply = e.target.value; };
  on("[data-admin-msg]", () => {
    const text = adm.reply.trim(), id = adm.user.user.id; if (!text) { toast("Напишите текст"); return; }
    api({ action: "admin_msg", id, text }).then((r) => {
      if (r && r.ok) { adm.reply = ""; adm.user.msgs = [...(adm.user.msgs || []), { ts: Date.now(), d: "out", t: text }]; render(); toast("Отправлено"); }
      else toast(r && r.status === 403 ? "Человек заблокировал бота" : "Не получилось отправить");
    });
  });
  on("[data-admin-ban]", () => {
    const u = adm.user.user, ban = !u.x;
    const go2 = () => api({ action: "admin_ban", id: u.id, ban }).then((r) => { if (r && r.ok) { u.x = ban ? 1 : 0; const du = adm.data && adm.data.users.find((x) => x.id === u.id); if (du) du.x = u.x; render(); toast(ban ? "Забанен" : "Бан снят"); } });
    ban ? (tg && tg.showConfirm ? tg.showConfirm("Забанить пользователя?", (ok) => ok && go2()) : confirm("Забанить?") && go2()) : go2();
  });
  // ещё
  on("[data-admin-cfg]", (el) => { const k = el.dataset.adminCfg; setCfg({ [k]: !adm.cfg[k] }); });
  on("[data-admin-ndays]", (el) => setCfg({ nudgeDays: +el.dataset.adminNdays }));
  on("[data-admin-ntext]", () => { const t = $("adm-ntext"); if (t && t.value.trim()) { setCfg({ nudgeText: t.value.trim() }); toast("Текст сохранён"); } });
  if ($("adm-src")) $("adm-src").oninput = (e) => { adm.srcName = e.target.value; $("adm-srclink").innerHTML = srcLink(); bind(); };
  on("[data-admin-copy]", (el) => copyText(el.dataset.adminCopy));
  on("[data-admin-export]", () => api({ action: "admin_export" }).then((r) => toast(r && r.ok ? "Файл отправлен вам в чат с ботом" : "Не получилось выгрузить")));
}
