// AI-тренер: ответы на вопросы о тренировках и питании, история диалога и PDF с планом.
//
// Провайдер выбирается переменной AI_PROVIDER:
//   "workers" (по умолчанию) — бесплатный Cloudflare Workers AI (binding AI), 10 000 нейронов в сутки
//   "claude"                 — Claude API, нужен секрет ANTHROPIC_API_KEY (модель — переменная CLAUDE_MODEL)
// История диалога хранится в KV по ключу c<id>: { d: дата, n: сообщений за день, h: [{ r, c, t }] }.
// Одна запись в KV на каждый вопрос: лимиты бесплатного KV (1000 записей в сутки) берегём.

import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import FONT from "./fonts/DejaVuSans.ttf";
import FONT_BOLD from "./fonts/DejaVuSans-Bold.ttf";

const WORKERS_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DAILY_LIMIT = 20; // вопросов в сутки на пользователя (админ — без лимита)
const KEEP = 12; // сколько последних сообщений помнить
const MAX_IN = 2000; // длина вопроса

const GOAL_RU = { gto: "сдать нормативы ГТО", lose: "похудеть", mass: "набрать мышечную массу", strength: "стать сильнее", endurance: "выносливость", fit: "быть в форме" };
const LEVEL_RU = { 1: "новичок", 2: "средний", 3: "продвинутый" };
const PLACE_RU = { gym: "тренажёрный зал", home: "дома", outdoor: "на улице" };

function systemPrompt(user, card) {
  const p = (card && card.pr) || {};
  const wk = (card && card.wk) || [], rn = (card && card.rn) || [];
  const about = [
    user.first_name && `Имя: ${user.first_name}`,
    p.age && `Возраст: ${p.age >= 18 ? "18 лет или старше" : p.age + " лет"}`,
    p.goal && `Цель: ${GOAL_RU[p.goal] || p.goal}`,
    p.level && `Уровень: ${LEVEL_RU[p.level] || p.level}`,
    p.place && `Где тренируется: ${PLACE_RU[p.place] || p.place}`,
    Array.isArray(p.eq) && p.eq.length && `Инвентарь: ${p.eq.join(", ")}`,
    p.days && `Тренировок в неделю: ${p.days}, по ${p.minutes || 45} мин`,
    p.weight && `Вес (указан для подсчёта калорий на пробежке): ${p.weight} кг`,
    wk.length && `Последние тренировки: ${wk.slice(0, 6).map((w) => `${w[0]} ${w[1]}${w[2] ? ` (${w[2]} мин)` : ""}`).join("; ")}`,
    rn.length && `Последние пробежки: ${rn.slice(0, 4).map((r) => `${r[0]} ${(r[1] / 1000).toFixed(1)} км`).join("; ")}`,
  ].filter(Boolean).join("\n");
  const today = new Date().toISOString().slice(0, 10);
  return `Ты — AI-тренер в Telegram-приложении «AI-Тренер»: опытный тренер по фитнесу и спортивный нутрициолог. Сегодня ${today}.
Отвечай по-русски, дружелюбно и по делу, на «ты». Темы: тренировки, техника упражнений, бег, восстановление, сон, питание, похудение и набор массы, мотивация. На вопросы не по теме вежливо скажи, что помогаешь только со спортом, здоровым образом жизни и питанием.

Как отвечать:
- Короткий вопрос — короткий ответ (3–8 предложений). Планы питания и тренировок — подробно, со структурой.
- Пиши в Markdown: заголовки ##, списки «- », **жирный** для важного. Для плана питания делай таблицу (| Приём пищи | Блюдо | Ккал | Б/Ж/У |) по каждому приёму пищи и итог за день.
- Указывай граммовки продуктов и калорийность, следи, чтобы сумма сходилась с запрошенной.
- Если для точного плана не хватает данных (пол, возраст, вес, рост, активность), всё равно составь план по разумным допущениям, явно их назови и предложи уточнить.
- Без эмодзи в таблицах и заголовках.
- Ты умеешь присылать ответы PDF-файлом: если просят PDF, приложение само отправит файл с твоим ответом. Никогда не говори, что не можешь сделать PDF, просто дай полный ответ.

Безопасность:
- Калорийность ниже ~1200 ккал для женщин и ~1500 ккал для мужчин без контроля врача не рекомендуй как долгосрочную: если просят меньше, составь план, но предупреди о рисках и предложи безопасный вариант.
- При боли, травмах, болезнях, беременности, приёме лекарств — дай общие советы и порекомендуй обратиться к врачу. Не ставь диагнозы.
- Не советуй стероиды, допинг, жёсткие голодовки и рецептурные препараты.

Подростки (младше 18 лет — по возрасту из профиля или если это видно из разговора, например упоминает класс в школе):
- Никаких планов с дефицитом калорий, «сушки», подсчёта калорий для похудения и низкокалорийных меню. На просьбу похудеть — сбалансированное питание без запретов, режим, сон, активность, и совет обсудить вес с родителями и педиатром. Если просят план питания, составляй его на возрастную норму калорий для растущего организма, не ниже.
- Не советуй спортивное питание: протеин, гейнеры, креатин, жиросжигатели, предтренировочные комплексы, энергетики, любые добавки и витамины без врача.
- До 16 лет — упражнения со своим весом, резинками и лёгкими гантелями, упор на технику; без штанги, работы на максимум и «отказа». Силовые для подростков — не меньше 8–10 повторений.
- Пиши проще и поддерживающе, без оценок внешности и веса. Если видишь признаки расстройства пищевого поведения (голодает, вызывает рвоту, боится есть, сильно недоволен телом) — мягко посоветуй поговорить со взрослым, которому доверяет, и с врачом, и дай Детский телефон доверия 8-800-2000-122 (бесплатно, анонимно).
- Нормативы ГТО зависят от ступени (возраста) и пола: если пол неизвестен, спроси или дай оба варианта; напоминай, что точные актуальные значения есть на сайте gto.ru.

Что известно о пользователе (из приложения):
${about || "пока ничего"}`;
}

// ---------- вызов модели ----------
async function askModel(env, system, messages) {
  if (env.AI_PROVIDER === "claude" && env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({ model: env.CLAUDE_MODEL || "claude-opus-5-5", max_tokens: 4000, system, messages });
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  const r = await env.AI.run(WORKERS_MODEL, {
    messages: [{ role: "system", content: system }, ...messages],
    max_completion_tokens: 2500, temperature: 0.6,
    chat_template_kwargs: { enable_thinking: false },
  });
  const text = typeof r === "string" ? r : r.response ?? (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ?? "";
  return String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

const dateKey = () => new Date().toISOString().slice(0, 10);

export async function chatHistory(env, uid) {
  const c = (await env.REMINDERS.get("c" + uid, "json")) || { h: [] };
  const left = c.d === dateKey() ? Math.max(0, DAILY_LIMIT - (c.n || 0)) : DAILY_LIMIT;
  return { h: c.h || [], left, limit: DAILY_LIMIT };
}

export async function chatReset(env, uid) {
  const c = (await env.REMINDERS.get("c" + uid, "json")) || {};
  await env.REMINDERS.put("c" + uid, JSON.stringify({ d: c.d, n: c.n, h: [] }));
}

// Главная функция: вопрос → ответ. Возвращает { ok, text, t, left } или { ok:false, error, text }.
export async function ask(env, user, question, card, unlimited) {
  question = String(question || "").trim().slice(0, MAX_IN);
  if (!question) return { ok: false, error: "empty", text: "Напиши вопрос 🙂" };
  const key = "c" + user.id;
  const c = (await env.REMINDERS.get(key, "json")) || { h: [] };
  const today = dateKey();
  if (c.d !== today) { c.d = today; c.n = 0; }
  if (!unlimited && c.n >= DAILY_LIMIT) return { ok: false, error: "limit", text: `На сегодня вопросы закончились (${DAILY_LIMIT} в сутки). Лимит обновится в 03:00 по Москве 💪`, left: 0 };
  const hist = (c.h || []).slice(-KEEP).map((m) => ({ role: m.r === "u" ? "user" : "assistant", content: m.c }));
  let text;
  try {
    text = await askModel(env, systemPrompt(user, card), [...hist, { role: "user", content: question }]);
  } catch (e) {
    const s = String(e && e.message || e);
    console.log("ai error", s);
    if (/4006|neuron|quota|limit/i.test(s)) return { ok: false, error: "quota", text: "Тренер сегодня ответил уже очень многим и устал 😅 Бесплатный лимит обновится в 03:00 по Москве, попробуй завтра." };
    return { ok: false, error: "ai", text: "Не получилось ответить, попробуй ещё раз через минуту." };
  }
  if (!text) return { ok: false, error: "ai", text: "Не получилось ответить, попробуй переформулировать вопрос." };
  const t = Date.now();
  c.n = (c.n || 0) + 1;
  c.h = [...(c.h || []), { r: "u", c: question, t: t - 1 }, { r: "a", c: text, t }].slice(-KEEP * 2);
  await env.REMINDERS.put(key, JSON.stringify(c));
  return { ok: true, text, t, q: question, left: unlimited ? DAILY_LIMIT : DAILY_LIMIT - c.n };
}

// Просьба прислать PDF: "only" — только файл с прошлым ответом («пришли в пдф»), "also" — новый вопрос + файл
const PDF_RE = /(^|[^a-zа-яё])(pdf|пдф)(?![a-zа-яё])/i;
const FILLER = new Set("пришли пришлите отправь отправьте скинь скиньте сделай сделайте дай дайте можно можешь мне нам в во формате формат файл файлом файле виде это этот эту его её ее план планом ответ ответом пожалуйста плиз please pls а и тоже ещё еще сохрани сохранить скачать получить хочу нужен нужно надо сюда как на с то же самое всё все выше".split(" "));
export function pdfIntent(q) {
  if (!PDF_RE.test(q)) return null;
  const rest = q.toLowerCase().replace(/pdf|пдф/g, " ").split(/[^a-zа-яё0-9]+/).filter((w) => w && !FILLER.has(w));
  return rest.length <= 1 ? "only" : "also";
}

// Ответ, похожий на план (таблица, заголовки, длинный) — предлагаем PDF
export const looksLikePlan = (t) => t.length > 700 || /^\s*\|.*\|/m.test(t) || /^#{1,3}\s/m.test(t);

// ---------- Markdown → HTML для Telegram ----------
const escH = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inlineH = (s) => escH(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
const isSep = (l) => /^\s*\|?\s*:?-{2,}/.test(l) && /^[\s|:-]+$/.test(l);

export function toTelegram(md) {
  const out = [];
  let head = null;
  for (const line of md.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (isSep(line)) continue;
      const c = cells(line);
      if (!head) { head = c; continue; }
      const first = c[0] || "";
      const rest = c.slice(1).map((v, i) => (head[i + 1] && !/блюдо|продукт|что/i.test(head[i + 1]) ? `${head[i + 1]}: ${v}` : v)).filter((v) => v && !/:\s*$/.test(v));
      out.push(`▪️ <b>${inlineH(first.replace(/\*\*/g, ""))}</b>${rest.length ? " — " + inlineH(rest.join(" · ")) : ""}`);
      continue;
    }
    head = null;
    let m;
    if ((m = /^\s*#{1,6}\s+(.*)$/.exec(line))) out.push(`\n<b>${inlineH(m[1].replace(/\*\*/g, ""))}</b>`);
    else if ((m = /^(\s*)[-*•]\s+(.*)$/.exec(line))) out.push(`${m[1] ? "   " : ""}• ${inlineH(m[2])}`);
    else if (/^\s*(---|\*\*\*)\s*$/.test(line)) out.push("");
    else out.push(inlineH(line));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Telegram: сообщение до 4096 символов — режем по абзацам
export function splitMsg(s, max = 3900) {
  const parts = [];
  while (s.length > max) {
    let i = s.lastIndexOf("\n\n", max); if (i < max / 2) i = s.lastIndexOf("\n", max); if (i < max / 2) i = max;
    parts.push(s.slice(0, i)); s = s.slice(i).trimStart();
  }
  if (s) parts.push(s);
  return parts;
}

// ---------- Markdown → PDF ----------
const LIME = rgb(0.55, 0.75, 0.05), INK = rgb(0.1, 0.1, 0.12), GREY = rgb(0.45, 0.45, 0.5), LINE = rgb(0.86, 0.86, 0.88), ZEBRA = rgb(0.96, 0.97, 0.94);

export async function makePdf(md, title, who) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const R = await doc.embedFont(FONT, { subset: true }), B = await doc.embedFont(FONT_BOLD, { subset: true });
  doc.setTitle(title); doc.setAuthor("AI-Тренер"); doc.setCreator("AI-Тренер");
  const W = 595, H = 842, M = 48, CW = W - M * 2;
  // символы, которых нет в шрифте (эмодзи), убираем
  const okChar = (ch) => { try { return R.encodeText(ch) && R.widthOfTextAtSize(ch, 10) > 0; } catch { return false; } };
  const cache = {};
  const clean = (s) => [...s].filter((ch) => (cache[ch] ??= okChar(ch))).join("").replace(/\s{2,}/g, " ");
  let page, y;
  const newPage = () => {
    page = doc.addPage([W, H]); y = H - M;
    page.drawText("AI-Тренер", { x: M, y: 24, size: 8, font: B, color: GREY });
    page.drawText(`стр. ${doc.getPageCount()}`, { x: W - M - 30, y: 24, size: 8, font: R, color: GREY });
  };
  const need = (h) => { if (y - h < M) newPage(); };
  // runs: [{ t, b }] → строки по ширине
  const runsOf = (s) => clean(s).split(/\*\*/).map((t, i) => ({ t: t.replace(/`/g, ""), b: i % 2 === 1 })).filter((r) => r.t);
  const wrap = (runs, size, width) => {
    const words = [];
    for (const r of runs) r.t.split(/(\s+)/).forEach((w) => w && words.push({ t: w, b: r.b }));
    const lines = []; let cur = [], w = 0;
    for (const wd of words) {
      const f = wd.b ? B : R, ww = f.widthOfTextAtSize(wd.t, size);
      if (/^\s+$/.test(wd.t)) { if (cur.length) { cur.push(wd); w += ww; } continue; }
      if (w + ww > width && cur.length) { while (cur.length && /^\s+$/.test(cur[cur.length - 1].t)) cur.pop(); lines.push(cur); cur = []; w = 0; }
      cur.push(wd); w += ww;
    }
    if (cur.length) lines.push(cur);
    return lines;
  };
  const drawLine = (line, x, size, color) => {
    for (const wd of line) { const f = wd.b ? B : R; page.drawText(wd.t, { x, y, size, font: f, color }); x += f.widthOfTextAtSize(wd.t, size); }
  };
  const para = (s, { size = 10.5, x = M, width = CW, color = INK, bold = false, gap = 4 } = {}) => {
    const runs = bold ? [{ t: clean(s.replace(/\*\*/g, "")), b: true }] : runsOf(s);
    for (const line of wrap(runs, size, width)) { need(size * 1.45); y -= size * 1.45; drawLine(line, x, size, color); }
    y -= gap;
  };
  const table = (rows) => {
    const n = Math.max(...rows.map((r) => r.length)), size = 9, pad = 4;
    rows = rows.map((r) => Array.from({ length: n }, (_, i) => r[i] || ""));
    // ширины колонок пропорционально длине текста, с минимумом
    const len = Array.from({ length: n }, (_, i) => Math.max(...rows.map((r) => clean(r[i]).length), 3));
    const tot = len.reduce((a, b) => a + Math.min(b, 60), 0);
    const minW = Array.from({ length: n }, (_, i) => Math.min(CW / 3, Math.max(...rows.map((r) => Math.max(...clean(r[i].replace(/\*\*/g, "")).split(/\s+/).map((w) => B.widthOfTextAtSize(w, size))))) + pad * 2 + 2));
    const cw = len.map((l, i) => Math.max(minW[i], (Math.min(l, 60) / tot) * CW));
    const k = CW / cw.reduce((a, b) => a + b, 0); for (let i = 0; i < n; i++) cw[i] *= k;
    rows.forEach((r, ri) => {
      const wrapped = r.map((c, i) => wrap(ri === 0 ? [{ t: clean(c.replace(/\*\*/g, "")), b: true }] : runsOf(c), size, cw[i] - pad * 2));
      const h = Math.max(...wrapped.map((w) => w.length || 1)) * size * 1.35 + pad * 2;
      need(h);
      if (ri === 0) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: rgb(0.93, 0.96, 0.85) });
      else if (ri % 2 === 0) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: ZEBRA });
      let x = M; const top = y;
      wrapped.forEach((lines, i) => { y = top - pad; for (const l of lines) { y -= size * 1.35; drawLine(l, x + pad, size, INK); } x += cw[i]; });
      y = top - h;
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: LINE });
    });
    y -= 8;
  };

  newPage();
  page.drawRectangle({ x: M, y: y - 4, width: 36, height: 4, color: LIME });
  y -= 30;
  para(title, { size: 20, bold: true, gap: 2 });
  para(`${who ? who + " · " : ""}${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" })}`, { size: 9, color: GREY, gap: 14 });

  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!isSep(lines[i])) rows.push(cells(lines[i])); i++; }
      i--; table(rows); continue;
    }
    let m;
    if (!line.trim()) { y -= 4; continue; }
    if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line)) && pdfTitle(line, "") === title) continue;
    if (m) { y -= 6; need(40); para(m[2], { size: m[1].length <= 2 ? 14 : 12, bold: true, gap: 4 }); continue; }
    if ((m = /^(\s*)[-*•]\s+(.*)$/.exec(line))) {
      const ind = m[1].length ? 28 : 14;
      need(16); page.drawCircle({ x: M + ind - 8, y: y - 10.5 * 1.45 + 3.5, size: 1.8, color: LIME });
      para(m[2], { x: M + ind, width: CW - ind, gap: 2 }); continue;
    }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { para(`**${m[1]}.** ${m[2]}`, { x: M + 6, width: CW - 6, gap: 2 }); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { need(12); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: LINE }); y -= 6; continue; }
    para(line);
  }
  y -= 10; need(30);
  para("Рекомендации носят общий характер и не заменяют консультацию врача.", { size: 8, color: GREY });
  return await doc.save();
}

// Заголовок для PDF из ответа или вопроса
export function pdfTitle(answer, question) {
  const h = /^\s*#{1,3}\s+(.+)$/m.exec(answer);
  let t = (h ? h[1] : question || "План от AI-Тренера").replace(/\*\*/g, "").replace(/[^\p{L}\p{N}\s.,:;()«»"+\-–—\/]/gu, "").trim();
  if (t.length > 70) t = t.slice(0, 67).trimEnd() + "…";
  return t ? t[0].toUpperCase() + t.slice(1) : "План от AI-Тренера";
}
