// ===================== ЧАТ С AI-ТРЕНЕРОМ =====================
// История общая с чатом бота: что спросил в боте, видно здесь, и наоборот. Хранится на сервере.
const chat = { h: [], left: null, limit: 20, loaded: false, loading: false, sending: false, draft: "", err: "" };
const CHAT_IDEAS = [
  "Составь план питания на 1800 ккал",
  "Как быстрее восстановиться после тренировки?",
  "Что съесть до и после тренировки?",
  "Как начать бегать с нуля?",
  "Сколько белка мне нужно в день?",
];

function chatLoad() {
  if (chat.loading) return;
  chat.loading = true;
  api({ action: "chat_history" }).then((r) => {
    chat.loading = false; chat.loaded = true;
    // сообщения, отправленные до загрузки истории, оставляем в конце
    if (r && r.ok) { chat.h = [...(r.h || []), ...chat.h]; chat.left = r.left; chat.limit = r.limit; chat.err = ""; }
    else chat.err = tg && tg.initData ? "Не удалось загрузить чат, проверь интернет" : "Чат работает внутри Telegram";
    if (chatOpen()) { render(); chatScroll(); }
  });
}
const chatOpen = () => { const t = state.stack[state.stack.length - 1]; return t && t.type === "chat"; };
const chatScroll = () => requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));

// контекст для ответа: профиль словами и последние тренировки
function chatCtx() {
  const p = store.profile || {};
  return {
    pr: { age: p.age, goal: p.goal, level: p.level, place: p.place, eq: (p.eq || []).map(eqName), days: p.days, minutes: p.minutes, weight: p.weight },
    wk: store.history.slice(0, 8).map((h) => [String(h.d).slice(0, 10), h.t, h.m]),
    rn: (store.runs || []).slice(0, 5).map((r) => [String(r.d).slice(0, 10), Math.round(r.m || 0), Math.round(r.s || 0)]),
  };
}

function chatSend(text) {
  text = String(text || "").trim();
  if (!text || chat.sending) return;
  const t = Date.now();
  chat.h.push({ r: "u", c: text, t });
  chat.sending = true; chat.draft = ""; chat.err = "";
  render(); chatScroll();
  api({ action: "chat", q: text, ctx: chatCtx() }).then((r) => {
    chat.sending = false;
    if (r && r.ok) {
      chat.h.push({ r: "a", c: r.text, t: r.t });
      if (r.note) { try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) {} }
      else chat.left = r.left;
      if (r.pdfSent) chat.h.push({ r: "a", c: "📄 PDF с этим ответом отправил в чат с ботом.", t: r.t + 1 });
    }
    else { chat.h.push({ r: "e", c: (r && r.text) || "Нет связи с тренером. Проверь интернет и попробуй ещё раз.", t: Date.now() }); if (r && r.error === "limit") chat.left = 0; }
    if (chatOpen()) { render(); chatScroll(); }
  });
}

// Markdown ответа → HTML (заголовки, списки, жирный, таблицы)
function mdHtml(md) {
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const lines = md.split("\n"), out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (/^\s*\|.*\|\s*$/.test(l)) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^[\s|:-]+$/.test(lines[i])) rows.push(cells(lines[i])); i++; }
      i--;
      out.push(`<div class="md-table"><table>${rows.map((r, ri) => `<tr>${r.map((c) => (ri ? `<td${c.length <= 12 ? ' class="n"' : ""}>${inl(c)}</td>` : `<th>${inl(c.replace(/\*\*/g, ""))}</th>`)).join("")}</tr>`).join("")}</table></div>`);
    } else if ((m = /^\s*#{1,6}\s+(.*)$/.exec(l))) { closeList(); out.push(`<div class="md-h">${inl(m[1].replace(/\*\*/g, ""))}</div>`); }
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inl(m[1])}</li>`); }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inl(m[1])}</li>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) { closeList(); out.push("<hr>"); }
    else if (!l.trim()) closeList();
    else { closeList(); out.push(`<p>${inl(l)}</p>`); }
  }
  closeList();
  return out.join("");
}

function viewChat() {
  if (!chat.loaded && !chat.loading) chatLoad();
  const msgs = chat.h.map((m) => {
    if (m.r === "u") return `<div class="msg me">${esc(m.c).replace(/\n/g, "<br>")}</div>`;
    if (m.r === "e") return `<div class="msg ai err">${esc(m.c)}</div>`;
    return `<div class="msg ai"><div class="md">${mdHtml(m.c)}</div></div>`;
  }).join("");
  const empty = !chat.h.length && !chat.loading
    ? `<div class="coach" style="margin-top:4px"><div class="ava">AI</div><p>Привет, ${userName}! Я AI-тренер. Спрашивай про тренировки, технику, бег, восстановление и питание. Могу составить план питания, а если напишешь «пришли в pdf», пришлю его файлом.</p></div>
       <div class="eyebrow" style="margin:18px 0 10px">Например</div>
       <div class="chat-ideas">${CHAT_IDEAS.map((q) => `<button class="chip" data-chat-idea="${esc(q)}">${esc(q)}</button>`).join("")}</div>`
    : "";
  const typing = chat.sending ? `<div class="msg ai typing"><i></i><i></i><i></i></div>` : "";
  const left = chat.left != null && chat.left <= 5 ? `<div class="muted chat-left">${chat.left ? `Осталось вопросов на сегодня: ${chat.left}` : "Вопросы на сегодня закончились, лимит обновится в 03:00 по Москве"}</div>` : "";
  return `
  <div class="top"><div><div class="eyebrow">Чат</div><div class="h1" style="margin-top:8px">AI-<span class="lime">тренер</span></div></div>
    ${chat.h.length ? `<button class="icon-btn ico-btn" data-chat-reset aria-label="Начать заново" title="Начать заново">${ICO.trash}</button>` : ""}</div>
  ${chat.loading && !chat.h.length ? `<div class="muted" style="text-align:center;padding:30px 0">Загружаю…</div>` : ""}
  ${chat.err ? `<div class="muted" style="text-align:center;padding:12px 0">${esc(chat.err)}</div>` : ""}
  ${empty}<div class="chat">${msgs}${typing}</div>${left}
  <div class="muted" style="font-size:11px;text-align:center;margin-top:14px">Ответы ИИ могут ошибаться. При болях и болезнях обратись к врачу.</div>
  <div style="height:84px"></div>
  <div class="chat-bar"><textarea id="chat-in" rows="1" placeholder="Спроси тренера…" maxlength="2000">${esc(chat.draft)}</textarea>
    <button data-chat-send aria-label="Отправить" ${chat.sending ? "disabled" : ""}>➤</button></div>`;
}

function bindChat(on) {
  const ta = document.getElementById("chat-in");
  if (!ta) return;
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; };
  ta.oninput = () => { chat.draft = ta.value; grow(); };
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !/Android|iPhone|iPad/i.test(navigator.userAgent)) { e.preventDefault(); chatSend(ta.value); } };
  grow();
  on("[data-chat-send]", () => chatSend(ta.value));
  on("[data-chat-idea]", (el) => chatSend(el.dataset.chatIdea));
  on("[data-chat-reset]", () => { chat.h = []; render(); api({ action: "chat_reset" }); });
}
