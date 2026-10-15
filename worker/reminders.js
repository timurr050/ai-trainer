// Сервер напоминаний AI-Тренера для Cloudflare Workers (бесплатный тариф).
// Мини-приложение присылает сюда расписание пользователя, а cron раз в 15 минут
// отправляет в чат с ботом: накануне тренировки и в день тренировки.
//
// Настройки воркера:
//   Secret     BOT_TOKEN  — токен бота из @BotFather
//   Variable   APP_URL    — адрес мини-приложения (https://timurr050.github.io/ai-trainer/)
//   KV binding REMINDERS  — пространство KV для расписаний
//   Cron       */15 * * * *
//   Variable   ADMIN_IDS  — (необязательно) Telegram ID админов через запятую
//
// Ключи KV: u<id> — напоминания, p<id> — карточка пользователя (данные в metadata, чтобы список
// читался одним запросом), admin — ID владельца (первый, кто нажал «Стать администратором»).
// Бот: Telegram шлёт сюда обновления на /tg (вебхук ставится из админ-панели), отвечаем на /start.

import { ask, chatHistory, chatReset, makePdf, pdfTitle, looksLikePlan, toTelegram, splitMsg } from "./coach.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });

// Проверка подписи Telegram initData: так мы знаем, что запрос пришёл от этого пользователя из Telegram
async function checkInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const hmac = async (key, msg) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(msg)));
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const sig = [...(await hmac(secret, dataCheck))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (sig !== hash) return null;
  if (Date.now() / 1000 - Number(params.get("auth_date") || 0) > 86400 * 30) return null;
  try { return JSON.parse(params.get("user")); } catch { return null; }
}

const DAY = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];
function localParts(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return { dow, min: +p.hour * 60 + +p.minute, ymd: `${p.year}-${p.month}-${p.day}` };
}

async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

async function send(env, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Открыть тренировку", web_app: { url: env.APP_URL } }]] } }),
  });
  return r.status;
}

async function tick(env) {
  const now = new Date();
  const budget = { left: 45 }; // бесплатный воркер: до 50 внешних запросов за запуск
  let cursor;
  do {
    const page = await env.REMINDERS.list({ prefix: "u", cursor });
    for (const k of page.keys) {
      const u = await env.REMINDERS.get(k.name, "json");
      if (!u || !u.on) continue;
      let L; try { L = localParts(u.tz || "Europe/Moscow", now); } catch { L = localParts("Europe/Moscow", now); }
      const due = (hhmm) => { const [h, m] = hhmm.split(":").map(Number), t = h * 60 + m; return L.min >= t && L.min < t + 15; };
      const tomorrow = (L.dow + 1) % 7;
      let changed = false;
      if (u.before && u.days[tomorrow] && due(u.beforeAt || "20:00") && u.sentBefore !== L.ymd) {
        budget.left--;
        const st = await send(env, u.id, `Завтра тренировка: <b>${u.days[tomorrow]}</b>, около ${u.minutes || 45} мин 💪\nВыспись и подготовь форму, я соберу упражнения под твой инвентарь.`);
        u.sentBefore = L.ymd; changed = true; if (st === 403) u.on = false;
      }
      if (u.dayOf && u.days[L.dow] && due(u.dayOfAt || "09:00") && u.sentDay !== L.ymd) {
        budget.left--;
        const st = await send(env, u.id, `Сегодня тренировка: <b>${u.days[L.dow]}</b> 🔥\nПлан на ${DAY[L.dow]} уже готов, жми кнопку и начинай.`);
        u.sentDay = L.ymd; changed = true; if (st === 403) u.on = false;
      }
      if (changed) await env.REMINDERS.put(k.name, JSON.stringify(u), { metadata: { on: !!u.on } });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  await runScheduled(env, budget);
  await nudges(env, budget);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/tg") return onUpdate(req, env);
    if (url.pathname === "/setup" || url.pathname === "/aitest") return service(req, env, url);
    if (req.method !== "POST") return json({ ok: true, service: "ai-trainer reminders" });
    let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
    const user = await checkInitData(body.initData || "", env.BOT_TOKEN);
    if (!user) return json({ ok: false, error: "bad initData" }, 401);
    if (body.action === "hello") return hello(env, user, body);
    if (String(body.action || "").startsWith("admin")) return admin(env, user, body, url);
    if (String(body.action || "").startsWith("chat")) return chatApi(env, user, body);
    const key = "u" + user.id;
    if (body.action === "test") { const st = await send(env, user.id, "Напоминания работают ✅ Я напишу накануне тренировки и в её день."); return json({ ok: st === 200, status: st }); }
    const old = (await env.REMINDERS.get(key, "json")) || {};
    const days = Array.isArray(body.days) ? body.days.slice(0, 7).map((d) => (d ? String(d).slice(0, 40) : null)) : [];
    const clean = (t, def) => (/^\d{2}:\d{2}$/.test(t || "") ? t : def);
    const u = { ...old, id: user.id, on: !!body.on, before: body.before !== false, dayOf: body.dayOf !== false,
      beforeAt: clean(body.beforeAt, "20:00"), dayOfAt: clean(body.dayOfAt, "09:00"), tz: String(body.tz || "Europe/Moscow").slice(0, 64), days, minutes: +body.minutes || 45 };
    await env.REMINDERS.put(key, JSON.stringify(u), { metadata: { on: u.on } });
    await touch(env, user, {}, "app");
    return json({ ok: true });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); },
};

// ===================== ПОЛЬЗОВАТЕЛИ =====================
// p<id>: metadata — короткая карточка (читается списком), value — анкета и последние тренировки.
// Поля metadata: f/l/n имя, фамилия, ник; s первый вход; a последняя активность в приложении; h дни активности (base36, до 30);
// w/r тренировок/пробежек; e топ упражнений; g/lv/pl цель, уровень, место; src источник; tz часовой пояс;
// st нажал /start; b заблокировал бота; x бан; nd дата последнего «возвращайся»; ms последний поздравленный рубеж.
const today = () => new Date().toISOString().slice(0, 10);
const dayN = () => Math.floor(Date.now() / 86400000);
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const MILESTONES = [10, 25, 50, 100, 200, 300, 500];
const LABELS = {
  g: { lose: "Похудеть", mass: "Набрать массу", strength: "Стать сильнее", endurance: "Выносливость", fit: "Быть в форме" },
  lv: { 1: "Новичок", 2: "Средний", 3: "Продвинутый" },
  pl: { home: "Дома", street: "На улице", gym: "В зале" },
};

async function getUser(env, id) {
  const r = await env.REMINDERS.getWithMetadata("p" + id, "json");
  return { meta: r.metadata || null, val: r.value || {} };
}
const putUser = (env, id, meta, val) => env.REMINDERS.put("p" + id, JSON.stringify(val || {}), { metadata: meta });
async function patchMeta(env, id, patch) {
  const { meta, val } = await getUser(env, id);
  if (!meta) return;
  await putUser(env, id, { ...meta, ...patch }, val);
}

async function getCfg(env) {
  return { nudge: false, nudgeDays: 5, nudgeText: "Привет! Ты не тренировался уже {days} дн. Давай вернёмся: план на сегодня готов 💪", milestones: true,
    ...((await env.REMINDERS.get("cfg", "json")) || {}) };
}

async function touch(env, user, body = {}, src = "app") {
  const { meta: m0, val: v0 } = await getUser(env, user.id);
  const m = m0 || {};
  const st = body.stats || {};
  const pr = body.profile || null;
  const isApp = src === "app";
  let h = String(m.h || "").split(".").filter(Boolean);
  if (isApp) { const d = dayN().toString(36); if (!h.includes(d)) h.push(d); h = h.slice(-30); }
  const n = {
    f: String(user.first_name || "").slice(0, 40), l: String(user.last_name || "").slice(0, 40), n: String(user.username || "").slice(0, 32),
    s: m.s || today(), a: isApp ? today() : m.a || "", h: h.join("."),
    w: st.w != null ? +st.w || 0 : m.w || 0, r: st.r != null ? +st.r || 0 : m.r || 0,
    e: Array.isArray(body.ex) ? body.ex.slice(0, 3).map((x) => String(x).slice(0, 30)).join(",") : m.e || "",
    g: pr ? String(pr.goal || "").slice(0, 12) : m.g || "", lv: pr ? +pr.level || 0 : m.lv || 0, pl: pr ? String(pr.place || "").slice(0, 10) : m.pl || "",
    src: m.src || (body.src ? String(body.src).replace(/[^\w-]/g, "").slice(0, 32) : ""),
    tz: body.tz ? String(body.tz).slice(0, 40) : m.tz || "",
    st: src === "start" ? 1 : m.st || 0, b: 0, x: m.x || 0, nd: m.nd || "", ms: m.ms || 0,
  };
  const val = { ...v0 };
  if (pr) val.pr = { goal: pr.goal, level: pr.level, place: pr.place, eq: (pr.eq || []).slice(0, 20), days: pr.days, minutes: pr.minutes };
  if (Array.isArray(body.wk)) val.wk = body.wk.slice(0, 15);
  if (Array.isArray(body.rn)) val.rn = body.rn.slice(0, 10);
  const same = m0 && Object.keys(n).every((k) => m[k] === n[k]) && !body.wk;
  // поздравление с рубежом
  if (isApp && !n.x) {
    const cfg = await getCfg(env);
    const hit = MILESTONES.filter((x) => n.w >= x && x > (m.ms || 0)).pop();
    if (hit) {
      n.ms = hit;
      if (cfg.milestones && m0) await tgApi(env, "sendMessage", { chat_id: user.id, text: `🏆 ${hit}-я тренировка! ${user.first_name || "Атлет"}, это серьёзно. Так держать, продолжаем 💪`, reply_markup: appBtn(env) });
    }
  }
  if (!same || n.ms !== m.ms) await putUser(env, user.id, n, val);
  return n;
}
const appBtn = (env, text = "Открыть AI-Тренер") => ({ inline_keyboard: [[{ text, web_app: { url: env.APP_URL } }]] });

async function isAdmin(env, id) {
  const ids = String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.includes(String(id))) return true;
  return (await env.REMINDERS.get("admin")) === String(id);
}
async function adminIds(env) {
  const ids = String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const a = await env.REMINDERS.get("admin"); if (a) ids.push(a);
  return [...new Set(ids)];
}

async function hello(env, user, body) {
  const n = await touch(env, user, body, "app");
  if (n.x) return json({ ok: true, banned: true });
  const adm = await isAdmin(env, user.id);
  const free = !adm && !String(env.ADMIN_IDS || "").trim() && !(await env.REMINDERS.get("admin"));
  return json({ ok: true, admin: adm, claimable: free });
}

async function listAll(env, prefix) {
  const out = []; let cursor;
  do {
    const page = await env.REMINDERS.list({ prefix, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
async function users(env) {
  return (await listAll(env, "p")).filter((k) => k.metadata).map((k) => ({ id: +k.name.slice(1), ...k.metadata }));
}

// Сегменты для рассылки
function inSeg(u, seg) {
  if (u.b || u.x) return false;
  const [k, v] = String(seg || "all").split(":");
  const last = u.a || u.s;
  switch (k) {
    case "all": return true;
    case "new7": return u.s >= ago(6);
    case "act7": return !!u.a && u.a >= ago(6);
    case "idle7": return last < ago(7);
    case "idle30": return last < ago(30);
    case "noapp": return !u.a;
    case "goal": return u.g === v;
    case "level": return String(u.lv) === v;
    case "place": return u.pl === v;
    case "src": return (u.src || "") === (v || "");
    default: return false;
  }
}
async function recipients(env, seg) {
  return (await users(env)).filter((u) => inSeg(u, seg)).sort((x, y) => x.id - y.id);
}

const webhookSecret = async (env) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wh" + env.BOT_TOKEN)))].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
async function setWebhook(env, origin) {
  return tgApi(env, "setWebhook", { url: origin + "/tg", secret_token: await webhookSecret(env), allowed_updates: ["message", "my_chat_member", "callback_query"] });
}

// Отправка одного сообщения рассылки. 403 — человек заблокировал бота, отмечаем.
async function deliver(env, u, b) {
  const markup = b.button ? appBtn(env, String(b.button).slice(0, 40)) : undefined;
  const text = String(b.text || "").replace(/\{name\}/g, u.f || "друг");
  const r = b.photo
    ? await tgApi(env, "sendPhoto", { chat_id: u.id, photo: b.photo, caption: text.slice(0, 1024), reply_markup: markup })
    : await tgApi(env, "sendMessage", { chat_id: u.id, text: text.slice(0, 4096), reply_markup: markup });
  if (r.status === 403) await patchMeta(env, u.id, { b: 1 });
  return r.status === 200;
}

// ===================== СООБЩЕНИЯ =====================
// m<uid>:<время> — одно сообщение переписки, metadata {d: in|out, t: начало текста}
async function saveMsg(env, uid, dir, text) {
  const t = String(text || "").slice(0, 2000);
  await env.REMINDERS.put(`m${uid}:${Date.now().toString().padStart(14, "0")}`, t, { metadata: { d: dir, t: t.slice(0, 160) } });
}
async function conversations(env) {
  const keys = await listAll(env, "m");
  const seen = (await env.REMINDERS.get("seen", "json")) || {};
  const by = {};
  for (const k of keys) {
    const [uid, ts] = k.name.slice(1).split(":");
    const c = by[uid] || (by[uid] = { id: +uid, count: 0, unread: 0, last: 0 });
    c.count++;
    if (+ts > c.last) { c.last = +ts; c.t = k.metadata.t; c.d = k.metadata.d; }
    if (k.metadata.d === "in" && +ts > (seen[uid] || 0)) c.unread++;
  }
  return Object.values(by).sort((a, b) => b.last - a.last);
}

// ===================== АДМИНКА =====================
async function admin(env, user, body, url) {
  const a = body.action;
  if (a === "admin_claim") {
    if (String(env.ADMIN_IDS || "").trim() || (await env.REMINDERS.get("admin"))) return json({ ok: false, error: "taken" }, 403);
    await env.REMINDERS.put("admin", String(user.id));
    const wh = await setWebhook(env, url.origin);
    return json({ ok: true, webhook: wh.status === 200 });
  }
  if (!(await isAdmin(env, user.id))) return json({ ok: false, error: "forbidden" }, 403);

  if (a === "admin_stats") {
    const U = await users(env);
    const rem = await listAll(env, "u");
    let remOn = 0;
    for (const k of rem) {
      if (k.metadata && "on" in k.metadata) { if (k.metadata.on) remOn++; }
      else { const v = await env.REMINDERS.get(k.name, "json"); if (v && v.on) remOn++; }
    }
    const cnt = (f) => U.filter(f).length;
    const tally = (key) => { const o = {}; for (const u of U) { const v = u[key]; if (v !== "" && v != null && v !== 0) o[v] = (o[v] || 0) + 1; } return o; };
    // графики за 30 дней
    const D = dayN(), days = [...Array(30)].map((_, i) => D - 29 + i);
    const newBy = days.map((d) => cnt((u) => Math.floor(Date.parse(u.s) / 86400000) === d));
    const dau = days.map((d) => { const k = d.toString(36); return cnt((u) => String(u.h || "").split(".").includes(k)); });
    // сколько дней человек остаётся (для тех, кто пришёл неделю назад и раньше)
    const old = U.filter((u) => u.a && u.s <= ago(7));
    const life = (u) => Math.round((Date.parse(u.a) - Date.parse(u.s)) / 86400000);
    const ret = { d0: 0, d1_3: 0, d4_7: 0, d8_30: 0, d30: 0, alive: 0 };
    for (const u of old) { const L = life(u); if (u.a >= ago(6)) ret.alive++; if (L === 0) ret.d0++; else if (L <= 3) ret.d1_3++; else if (L <= 7) ret.d4_7++; else if (L <= 30) ret.d8_30++; else ret.d30++; }
    const ex = {}; for (const u of U) for (const e of String(u.e || "").split(",").filter(Boolean)) ex[e] = (ex[e] || 0) + 1;
    const wh = await tgApi(env, "getWebhookInfo", {});
    const conv = await conversations(env);
    return json({ ok: true,
      total: U.length, blocked: cnt((u) => u.b), banned: cnt((u) => u.x), reminders: remOn,
      newDay: cnt((u) => u.s >= ago(0)), newWeek: cnt((u) => u.s >= ago(6)), newMonth: cnt((u) => u.s >= ago(29)),
      actDay: cnt((u) => u.a >= ago(0)), actWeek: cnt((u) => u.a >= ago(6)), actMonth: cnt((u) => u.a >= ago(29)),
      workouts: U.reduce((s, u) => s + (u.w || 0), 0), runs: U.reduce((s, u) => s + (u.r || 0), 0),
      days: days.map((d) => new Date(d * 86400000).toISOString().slice(0, 10)), newBy, dau, ret, retBase: old.length,
      goals: tally("g"), levels: tally("lv"), places: tally("pl"), sources: tally("src"), ex,
      unread: conv.reduce((s, c) => s + c.unread, 0),
      webhook: !!(wh.j && wh.j.result && wh.j.result.url && wh.j.result.url.endsWith("/tg")),
      users: U.sort((x, y) => String(y.a || y.s).localeCompare(String(x.a || x.s))) });
  }
  if (a === "admin_webhook") { const wh = await setWebhook(env, url.origin); return json({ ok: wh.status === 200 }); }

  if (a === "admin_user") {
    const id = +body.id, { meta, val } = await getUser(env, id);
    if (!meta) return json({ ok: false, error: "not found" }, 404);
    const msgs = (await listAll(env, `m${id}:`)).slice(-50).map((k) => ({ ts: +k.name.split(":")[1], d: k.metadata.d, t: k.metadata.t }));
    for (const m of msgs) if (m.t.length >= 160) m.t = (await env.REMINDERS.get(`m${id}:${String(m.ts).padStart(14, "0")}`)) || m.t;
    const rem = await env.REMINDERS.get("u" + id, "json");
    return json({ ok: true, user: { id, ...meta }, data: val, msgs, reminders: !!(rem && rem.on) });
  }
  if (a === "admin_inbox") {
    const conv = await conversations(env);
    const U = Object.fromEntries((await users(env)).map((u) => [u.id, u]));
    return json({ ok: true, list: conv.map((c) => ({ ...c, f: (U[c.id] || {}).f || "", l: (U[c.id] || {}).l || "", n: (U[c.id] || {}).n || "" })) });
  }
  if (a === "admin_read") {
    const seen = (await env.REMINDERS.get("seen", "json")) || {};
    seen[+body.id] = Date.now(); await env.REMINDERS.put("seen", JSON.stringify(seen));
    return json({ ok: true });
  }
  if (a === "admin_msg") {
    const id = +body.id, text = String(body.text || "").trim().slice(0, 4000);
    if (!text) return json({ ok: false, error: "empty" }, 400);
    const r = await tgApi(env, "sendMessage", { chat_id: id, text });
    if (r.status === 403) await patchMeta(env, id, { b: 1 });
    if (r.status === 200) await saveMsg(env, id, "out", text);
    return json({ ok: r.status === 200, status: r.status });
  }
  if (a === "admin_ban") { await patchMeta(env, +body.id, { x: body.ban ? 1 : 0 }); return json({ ok: true }); }

  if (a === "admin_count") return json({ ok: true, n: (await recipients(env, body.seg)).length });
  if (a === "admin_send") {
    // Рассылка частями по 40 сообщений за запрос (лимит бесплатного воркера — 50 внешних запросов).
    const text = String(body.text || "").trim();
    if (!text) return json({ ok: false, error: "empty" }, 400);
    const photo = body.photo ? await env.REMINDERS.get("admin_photo") : null;
    const b = { text, button: body.button, photo };
    if (body.test) return json({ ok: await deliver(env, { id: user.id, f: user.first_name }, b) });
    const U = await recipients(env, body.seg);
    const from = +body.offset || 0, part = U.slice(from, from + 40);
    let sent = 0, failed = 0;
    for (const u of part) (await deliver(env, u, b)) ? sent++ : failed++;
    const next = from + part.length;
    return json({ ok: true, sent, failed, total: U.length, next, done: next >= U.length });
  }
  if (a === "admin_schedule") {
    const at = Date.parse(body.at);
    if (!body.text || !at) return json({ ok: false, error: "bad" }, 400);
    const photo = body.photo ? await env.REMINDERS.get("admin_photo") : null;
    const key = "bc" + Date.now();
    await env.REMINDERS.put(key, JSON.stringify({ text: String(body.text).slice(0, 4000), button: body.button || "", photo, seg: body.seg || "all", segName: String(body.segName || "").slice(0, 60), at, offset: 0, sent: 0, failed: 0, status: "wait" }));
    return json({ ok: true });
  }
  if (a === "admin_scheduled") {
    const out = [];
    for (const k of await listAll(env, "bc")) { const v = await env.REMINDERS.get(k.name, "json"); if (v) out.push({ key: k.name, ...v, photo: !!v.photo }); }
    return json({ ok: true, list: out.sort((x, y) => y.at - x.at).slice(0, 20) });
  }
  if (a === "admin_unschedule") { if (String(body.key).startsWith("bc")) await env.REMINDERS.delete(body.key); return json({ ok: true }); }
  if (a === "admin_photo") return json({ ok: true, has: !!(await env.REMINDERS.get("admin_photo")) });
  if (a === "admin_photo_clear") { await env.REMINDERS.delete("admin_photo"); return json({ ok: true }); }

  if (a === "admin_cfg") {
    const cfg = await getCfg(env);
    if (body.set) {
      const s = body.set;
      if ("nudge" in s) cfg.nudge = !!s.nudge;
      if ("milestones" in s) cfg.milestones = !!s.milestones;
      if ("nudgeDays" in s) cfg.nudgeDays = Math.min(30, Math.max(2, +s.nudgeDays || 5));
      if ("nudgeText" in s) cfg.nudgeText = String(s.nudgeText).slice(0, 1000);
      await env.REMINDERS.put("cfg", JSON.stringify(cfg));
    }
    let bot = await env.REMINDERS.get("botname");
    if (!bot) { const r = await tgApi(env, "getMe", {}); bot = r.j && r.j.result && r.j.result.username; if (bot) await env.REMINDERS.put("botname", bot); }
    return json({ ok: true, cfg, bot });
  }
  if (a === "admin_export") {
    const U = await users(env);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["ID", "Имя", "Фамилия", "Ник", "Первый вход", "Последняя активность", "Тренировок", "Пробежек", "Цель", "Уровень", "Место", "Источник", "Нажал /start", "Заблокировал бота", "Бан"]];
    for (const u of U) rows.push([u.id, u.f, u.l, u.n ? "@" + u.n : "", u.s, u.a, u.w || 0, u.r || 0, LABELS.g[u.g] || "", LABELS.lv[u.lv] || "", LABELS.pl[u.pl] || "", u.src, u.st ? "да" : "", u.b ? "да" : "", u.x ? "да" : ""]);
    const csv = "﻿" + rows.map((r) => r.map(q).join(";")).join("\r\n");
    const fd = new FormData();
    fd.append("chat_id", String(user.id));
    fd.append("caption", `Пользователи AI-Тренера: ${U.length}. Откройте файл в Excel или Google Таблицах.`);
    fd.append("document", new Blob([csv], { type: "text/csv" }), `users-${today()}.csv`);
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: "POST", body: fd });
    return json({ ok: r.status === 200 });
  }
  return json({ ok: false, error: "unknown action" }, 400);
}

// ===================== ПО РАСПИСАНИЮ =====================
async function runScheduled(env, budget) {
  for (const k of await listAll(env, "bc")) {
    if (budget.left <= 0) return;
    const b = await env.REMINDERS.get(k.name, "json");
    if (!b || b.status === "done" || b.at > Date.now()) continue;
    const U = await recipients(env, b.seg);
    const part = U.slice(b.offset, b.offset + budget.left);
    for (const u of part) { budget.left--; (await deliver(env, u, b)) ? b.sent++ : b.failed++; }
    b.offset += part.length; b.status = b.offset >= U.length ? "done" : "run";
    await env.REMINDERS.put(k.name, JSON.stringify(b));
  }
  // старые выполненные рассылки храним 30 дней
  for (const k of await listAll(env, "bc")) if (+k.name.slice(2) < Date.now() - 30 * 86400000) await env.REMINDERS.delete(k.name);
}

// «Ты давно не тренировался» — в 18:00 по времени человека, один раз после каждого перерыва
async function nudges(env, budget) {
  const cfg = await getCfg(env);
  if (!cfg.nudge || budget.left <= 0) return;
  for (const u of await users(env)) {
    if (budget.left <= 0) return;
    if (u.b || u.x || !u.a) continue;
    const idle = Math.floor((Date.now() - Date.parse(u.a)) / 86400000);
    if (idle < cfg.nudgeDays || (u.nd && u.nd >= u.a)) continue;
    let L; try { L = localParts(u.tz || "Europe/Moscow"); } catch { L = localParts("Europe/Moscow"); }
    if (L.min < 18 * 60 || L.min >= 18 * 60 + 15) continue;
    budget.left--;
    const text = cfg.nudgeText.replace(/\{days\}/g, idle).replace(/\{name\}/g, u.f || "друг");
    const r = await tgApi(env, "sendMessage", { chat_id: u.id, text, reply_markup: appBtn(env) });
    await patchMeta(env, u.id, r.status === 403 ? { b: 1, nd: today() } : { nd: today() });
  }
}

// ===================== БОТ (вебхук) =====================
async function onUpdate(req, env) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env))) return new Response("forbidden", { status: 403 });
  let up; try { up = await req.json(); } catch { return new Response("ok"); }
  try {
    const cm = up.my_chat_member;
    if (cm && cm.chat.type === "private") {
      const blocked = cm.new_chat_member.status === "kicked";
      const { meta } = await getUser(env, cm.from.id);
      if (meta) await patchMeta(env, cm.from.id, { b: blocked ? 1 : 0 });
      else if (!blocked) await touch(env, cm.from, {}, "start");
    }
    if (up.callback_query) await onCallback(env, up.callback_query);
    const m = up.message;
    if (m && m.chat.type === "private" && m.from) await onMessage(env, m);
  } catch (e) { console.log("update error", e && e.stack); }
  return new Response("ok");
}

async function onMessage(env, m) {
  const from = m.from, text = m.text || m.caption || "";
  const admins = await adminIds(env);
  const isAdm = admins.includes(String(from.id));
  if (isAdm) {
    // фото от админа — картинка для рассылки
    if (m.photo && m.photo.length) {
      await env.REMINDERS.put("admin_photo", m.photo[m.photo.length - 1].file_id);
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: "🖼 Картинка сохранена для рассылки. Включите «Картинка» в админ-панели." });
      return;
    }
    // ответ на уведомление о сообщении пользователя
    const ref = m.reply_to_message && (m.reply_to_message.text || m.reply_to_message.caption || "").match(/#id(\d+)/);
    if (ref && text) {
      const id = +ref[1];
      const r = await tgApi(env, "sendMessage", { chat_id: id, text });
      if (r.status === 200) await saveMsg(env, id, "out", text);
      if (r.status === 403) await patchMeta(env, id, { b: 1 });
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: r.status === 200 ? "✅ Отправлено" : "❌ Не доставлено: пользователь заблокировал бота" });
      return;
    }
  }
  const { meta } = await getUser(env, from.id);
  if (meta && meta.x) return; // бан
  const start = /^\/start(?:\s+(\S+))?/.exec(text);
  if (start) {
    await touch(env, from, { src: start[1] || "" }, "start");
    const name = from.first_name ? `, ${from.first_name}` : "";
    await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: `Привет${name}! Я AI-Тренер 💪\nСоставлю тренировки под твой инвентарь и цель, проведу по ним с таймером, посчитаю пробежку и напомню о занятиях.\n\nЖми кнопку, чтобы начать. А если есть вопрос про тренировки или питание, просто напиши его сюда: отвечу как AI-тренер. Например: «Составь план питания на 1800 ккал».`, reply_markup: appBtn(env) });
    return;
  }
  if (!meta) await touch(env, from, {}, "start");
  const kind = m.photo ? "[фото] " : m.video ? "[видео] " : m.voice ? "[голосовое] " : m.document ? "[файл] " : m.sticker ? "[стикер] " : "";
  // текстовый вопрос — отвечает AI-тренер
  if (m.text && !kind && !/^\/(?!coach|trainer)/.test(m.text)) { await botAsk(env, m, isAdm); return; }
  if (/^\/(new|reset)\b/.test(text)) { await chatReset(env, from.id); await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: "Начали разговор заново. Спрашивай 🙂" }); return; }
  if (isAdm) { await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: "Вы администратор. Пришлите фото, чтобы использовать его в рассылке, или ответьте на уведомление о сообщении пользователя. Текстовые вопросы отвечает AI-тренер.", reply_markup: appBtn(env) }); return; }
  // фото, голосовые и файлы — в «Сообщения» админ-панели и уведомление админу
  const body = (kind + text).trim() || "[сообщение]";
  await saveMsg(env, from.id, "in", body);
  const who = [from.first_name, from.last_name].filter(Boolean).join(" ") + (from.username ? ` (@${from.username})` : "");
  for (const aid of admins) {
    await tgApi(env, "sendMessage", { chat_id: aid, text: `✉️ ${who} #id${from.id}\n\n${body}\n\nОтветьте на это сообщение (свайп влево), чтобы написать в ответ.` });
    if (kind) await tgApi(env, "forwardMessage", { chat_id: aid, from_chat_id: m.chat.id, message_id: m.message_id });
  }
  await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: "Получил, передал тренеру. Ответ придёт сюда 👌" });
}

// ===================== AI-ТРЕНЕР =====================
async function botAsk(env, m, isAdm) {
  const from = m.from;
  await tgApi(env, "sendChatAction", { chat_id: m.chat.id, action: "typing" });
  const { val } = await getUser(env, from.id);
  const q = m.text.replace(/^\/(coach|trainer)(@\w+)?\s*/, "");
  if (!q.trim()) { await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: "Напиши вопрос про тренировки, бег или питание, я отвечу 💪" }); return; }
  const r = await ask(env, from, q, val, isAdm);
  if (!r.ok) { await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: r.text }); return; }
  const parts = splitMsg(toTelegram(r.text));
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const kb = last && looksLikePlan(r.text) ? { inline_keyboard: [[{ text: "📄 Скачать PDF", callback_data: "pdf:" + r.t }]] } : undefined;
    const res = await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: parts[i], parse_mode: "HTML", reply_markup: kb });
    // если HTML не прошёл проверку Telegram — отправляем обычным текстом
    if (res.status === 400) await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: parts[i].replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), reply_markup: kb });
  }
}

async function sendPdf(env, chatId, user, msgT) {
  const { h } = await chatHistory(env, user.id);
  const i = msgT ? h.findIndex((x) => x.t === +msgT && x.r === "a") : h.map((x) => x.r).lastIndexOf("a");
  if (i < 0) return false;
  const ans = h[i].c, q = i > 0 && h[i - 1].r === "u" ? h[i - 1].c : "";
  const title = pdfTitle(ans, q);
  const bytes = await makePdf(ans, title, [user.first_name, user.last_name].filter(Boolean).join(" "));
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("caption", `📄 ${title}`);
  const name = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "plan";
  fd.append("document", new Blob([bytes], { type: "application/pdf" }), `${name}.pdf`);
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, { method: "POST", body: fd });
  return r.status === 200;
}

async function onCallback(env, cq) {
  const m = /^pdf:(\d+)$/.exec(cq.data || "");
  if (!m) { await tgApi(env, "answerCallbackQuery", { callback_query_id: cq.id }); return; }
  await tgApi(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Готовлю PDF…" });
  await tgApi(env, "sendChatAction", { chat_id: cq.from.id, action: "upload_document" });
  const ok = await sendPdf(env, cq.from.id, cq.from, m[1]);
  if (!ok) await tgApi(env, "sendMessage", { chat_id: cq.from.id, text: "Этот ответ уже не найден в истории. Попроси план ещё раз, и я пришлю PDF." });
}

async function chatApi(env, user, body) {
  const { meta, val } = await getUser(env, user.id);
  if (meta && meta.x) return json({ ok: false, error: "banned" }, 403);
  if (body.action === "chat_history") return json({ ok: true, ...(await chatHistory(env, user.id)) });
  if (body.action === "chat_reset") { await chatReset(env, user.id); return json({ ok: true }); }
  if (body.action === "chat_pdf") return json({ ok: await sendPdf(env, user.id, user, body.t) });
  if (body.action === "chat") {
    if (!meta) await touch(env, user, {}, "app");
    // приложение присылает свежий профиль и последние тренировки; если нет — берём карточку с сервера
    const ctx = body.ctx && typeof body.ctx === "object" && JSON.stringify(body.ctx).length < 6000 ? body.ctx : val;
    const r = await ask(env, user, body.q, ctx, await isAdmin(env, user.id));
    return json({ ...r, plan: r.ok && looksLikePlan(r.text) });
  }
  return json({ ok: false, error: "unknown action" }, 400);
}

// Служебные адреса для GitHub Actions после деплоя: защищены тем же секретом, что и вебхук
async function service(req, env, url) {
  if (req.headers.get("X-Service-Key") !== (await webhookSecret(env))) return new Response("forbidden", { status: 403 });
  if (url.pathname === "/setup") { const r = await setWebhook(env, url.origin); return json({ ok: r.status === 200, tg: r.j }); }
  const q = url.searchParams.get("q") || "Составь план питания на 1800 ккал на день для мужчины 30 лет";
  const t0 = Date.now();
  const r = await ask(env, { id: 0, first_name: "Тест" }, q, {}, true);
  let pdf = 0, pdfErr = "";
  if (r.ok) try { pdf = (await makePdf(r.text, pdfTitle(r.text, q), "Тест")).length; } catch (e) { pdfErr = String(e && e.stack || e); }
  await env.REMINDERS.delete("c0");
  return json({ ok: r.ok, ms: Date.now() - t0, pdfBytes: pdf, pdfErr, text: r.text, tg: r.ok ? toTelegram(r.text).slice(0, 1500) : "" });
}
