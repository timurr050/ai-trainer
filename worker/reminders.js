// Сервер напоминаний AI-Тренера для Cloudflare Workers (бесплатный тариф).
// Мини-приложение присылает сюда расписание пользователя, а cron раз в 15 минут
// отправляет в чат с ботом: накануне тренировки и в день тренировки.
//
// Настройки воркера:
//   Secret     BOT_TOKEN  — токен бота из @BotFather
//   Variable   APP_URL    — адрес мини-приложения (https://timurr050.github.io/ai-trainer/)
//   KV binding REMINDERS  — пространство KV для расписаний
//   Cron       */15 * * * *

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
    const page = await env.REMINDERS.list({ cursor });
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
      if (changed) await env.REMINDERS.put(k.name, JSON.stringify(u));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ ok: true, service: "ai-trainer reminders" });
    let body; try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
    const user = await checkInitData(body.initData || "", env.BOT_TOKEN);
    if (!user) return json({ ok: false, error: "bad initData" }, 401);
    const key = "u" + user.id;
    if (body.action === "test") { const st = await send(env, user.id, "Напоминания работают ✅ Я напишу накануне тренировки и в её день."); return json({ ok: st === 200, status: st }); }
    const old = (await env.REMINDERS.get(key, "json")) || {};
    const days = Array.isArray(body.days) ? body.days.slice(0, 7).map((d) => (d ? String(d).slice(0, 40) : null)) : [];
    const clean = (t, def) => (/^\d{2}:\d{2}$/.test(t || "") ? t : def);
    const u = { ...old, id: user.id, on: !!body.on, before: body.before !== false, dayOf: body.dayOf !== false,
      beforeAt: clean(body.beforeAt, "20:00"), dayOfAt: clean(body.dayOfAt, "09:00"), tz: String(body.tz || "Europe/Moscow").slice(0, 64), days, minutes: +body.minutes || 45 };
    await env.REMINDERS.put(key, JSON.stringify(u));
    return json({ ok: true });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); },
};
