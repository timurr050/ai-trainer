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
        const st = await send(env, u.id, `Завтра тренировка: <b>${u.days[tomorrow]}</b>, около ${u.minutes || 45} мин 💪\nВыспись и подготовь форму, я соберу упражнения под твой инвентарь.`);
        u.sentBefore = L.ymd; changed = true; if (st === 403) u.on = false;
      }
      if (u.dayOf && u.days[L.dow] && due(u.dayOfAt || "09:00") && u.sentDay !== L.ymd) {
        const st = await send(env, u.id, `Сегодня тренировка: <b>${u.days[L.dow]}</b> 🔥\nПлан на ${DAY[L.dow]} уже готов, жми кнопку и начинай.`);
        u.sentDay = L.ymd; changed = true; if (st === 403) u.on = false;
      }
      if (changed) await env.REMINDERS.put(k.name, JSON.stringify(u), { metadata: { on: !!u.on } });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/tg") return onUpdate(req, env);
    if (req.method !== "POST") return json({ ok: true, service: "ai-trainer reminders" });
    let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
    const user = await checkInitData(body.initData || "", env.BOT_TOKEN);
    if (!user) return json({ ok: false, error: "bad initData" }, 401);
    if (body.action === "hello") return hello(env, user, body);
    if (String(body.action || "").startsWith("admin")) return admin(env, user, body, url);
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
const today = () => new Date().toISOString().slice(0, 10);
// Обновляет карточку пользователя. Пишем в KV не чаще раза в день на человека (лимит бесплатного KV — 1000 записей в сутки).
async function touch(env, user, stats = {}, src = "app") {
  const key = "p" + user.id;
  const old = await env.REMINDERS.getWithMetadata(key);
  const m = old.metadata || {};
  const n = {
    f: String(user.first_name || "").slice(0, 40), l: String(user.last_name || "").slice(0, 40), n: String(user.username || "").slice(0, 32),
    s: m.s || today(), a: src === "app" ? today() : m.a || "",
    w: stats.w != null ? +stats.w || 0 : m.w || 0, r: stats.r != null ? +stats.r || 0 : m.r || 0,
    st: src === "start" ? 1 : m.st || 0, b: 0,
  };
  const same = old.value && Object.keys(n).every((k) => m[k] === n[k]);
  if (!same) await env.REMINDERS.put(key, "1", { metadata: n });
  return n;
}

async function isAdmin(env, id) {
  const ids = String(env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.includes(String(id))) return true;
  return (await env.REMINDERS.get("admin")) === String(id);
}

async function hello(env, user, body) {
  await touch(env, user, body.stats || {}, "app");
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
  return (await listAll(env, "p")).map((k) => ({ id: +k.name.slice(1), ...(k.metadata || {}) }));
}

const webhookSecret = async (env) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wh" + env.BOT_TOKEN)))].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");

async function setWebhook(env, origin) {
  return tgApi(env, "setWebhook", { url: origin + "/tg", secret_token: await webhookSecret(env), allowed_updates: ["message", "my_chat_member"] });
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
    const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const cnt = (f) => U.filter(f).length;
    const wh = await tgApi(env, "getWebhookInfo", {});
    const list = U.sort((x, y) => String(y.a || y.s).localeCompare(String(x.a || x.s))).slice(0, 300);
    return json({ ok: true,
      total: U.length, blocked: cnt((u) => u.b), reminders: remOn,
      newDay: cnt((u) => u.s >= ago(0)), newWeek: cnt((u) => u.s >= ago(6)), newMonth: cnt((u) => u.s >= ago(29)),
      actDay: cnt((u) => u.a >= ago(0)), actWeek: cnt((u) => u.a >= ago(6)), actMonth: cnt((u) => u.a >= ago(29)),
      workouts: U.reduce((s, u) => s + (u.w || 0), 0), runs: U.reduce((s, u) => s + (u.r || 0), 0),
      webhook: !!(wh.j && wh.j.result && wh.j.result.url && wh.j.result.url.endsWith("/tg")),
      users: list });
  }
  if (a === "admin_webhook") { const wh = await setWebhook(env, url.origin); return json({ ok: wh.status === 200 }); }

  if (a === "admin_send") {
    // Рассылка частями по 40 сообщений за запрос (лимит бесплатного воркера — 50 внешних запросов).
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!text) return json({ ok: false, error: "empty" }, 400);
    const markup = body.button ? { inline_keyboard: [[{ text: String(body.button).slice(0, 40), web_app: { url: env.APP_URL } }]] } : undefined;
    const msg = (id) => tgApi(env, "sendMessage", { chat_id: id, text, reply_markup: markup });
    if (body.test) { const r = await msg(user.id); return json({ ok: r.status === 200 }); }
    const U = (await users(env)).filter((u) => !u.b).sort((x, y) => x.id - y.id);
    const from = +body.offset || 0, part = U.slice(from, from + 40);
    let sent = 0, failed = 0;
    for (const u of part) {
      const r = await msg(u.id);
      if (r.status === 200) sent++;
      else { failed++; if (r.status === 403) { const { id, ...m } = u; await env.REMINDERS.put("p" + id, "1", { metadata: { ...m, b: 1 } }); } }
    }
    const next = from + part.length;
    return json({ ok: true, sent, failed, total: U.length, next, done: next >= U.length });
  }
  return json({ ok: false, error: "unknown action" }, 400);
}

// ===================== БОТ (вебхук) =====================
async function onUpdate(req, env) {
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env))) return new Response("forbidden", { status: 403 });
  let up; try { up = await req.json(); } catch { return new Response("ok"); }
  try {
    const cm = up.my_chat_member;
    if (cm && cm.chat.type === "private") {
      const key = "p" + cm.from.id, old = await env.REMINDERS.getWithMetadata(key);
      const blocked = cm.new_chat_member.status === "kicked";
      if (old.value || !blocked) await env.REMINDERS.put(key, "1", { metadata: { ...(old.metadata || { s: today(), a: "", w: 0, r: 0, st: 0 }), f: cm.from.first_name || "", n: cm.from.username || "", b: blocked ? 1 : 0 } });
    }
    const m = up.message;
    if (m && m.chat.type === "private" && m.from) {
      await touch(env, m.from, {}, "start");
      const name = m.from.first_name ? `, ${m.from.first_name}` : "";
      const hi = /^\/start/.test(m.text || "")
        ? `Привет${name}! Я AI-Тренер 💪\nСоставлю тренировки под твой инвентарь и цель, проведу по ним с таймером, посчитаю пробежку и напомню о занятиях.\n\nЖми кнопку, чтобы начать.`
        : "Все тренировки внутри приложения, жми кнопку 👇";
      await tgApi(env, "sendMessage", { chat_id: m.chat.id, text: hi, reply_markup: { inline_keyboard: [[{ text: "Открыть AI-Тренер", web_app: { url: env.APP_URL } }]] } });
    }
  } catch (e) {}
  return new Response("ok");
}
