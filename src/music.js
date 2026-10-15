// ===================== МУЗЫКА ДЛЯ ТРЕНИРОВКИ =====================
// Треки Kevin MacLeod (incompetech.com), лицензия CC BY 4.0, лежат в репозитории (music/*.mp3).
// Список TRACKS собирает build.py из tools/music-log.txt. Мини-плеер сверху виден на всех экранах.
const music = { on: false, i: 0, playing: false, shuffle: true, order: [], audio: null };
try { Object.assign(music, JSON.parse(localStorage.getItem("music") || "{}"), { on: false, playing: false, audio: null }); } catch (e) {}
const saveMusic = () => { try { localStorage.setItem("music", JSON.stringify({ i: music.i, shuffle: music.shuffle })); } catch (e) {} };

function musicAudio() {
  if (music.audio) return music.audio;
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("ended", () => musicNext());
  a.addEventListener("play", () => { music.playing = true; renderMusicBar(); if (chatOpenMusic()) render(); });
  a.addEventListener("pause", () => { music.playing = false; renderMusicBar(); if (chatOpenMusic()) render(); });
  a.addEventListener("error", () => { if (music.on) setTimeout(musicNext, 400); });
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => musicPlay());
      navigator.mediaSession.setActionHandler("pause", () => a.pause());
      navigator.mediaSession.setActionHandler("nexttrack", () => musicNext());
      navigator.mediaSession.setActionHandler("previoustrack", () => musicPrev());
    } catch (e) {}
  }
  return (music.audio = a);
}
function musicLoad(i) {
  if (!TRACKS.length) return;
  music.i = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
  const t = TRACKS[music.i], a = musicAudio();
  a.src = "music/" + t.f + ".mp3";
  if ("mediaSession" in navigator && window.MediaMetadata) { try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.t, artist: "Kevin MacLeod", album: "AI-Тренер" }); } catch (e) {} }
  saveMusic();
}
function musicPlay() {
  if (!TRACKS.length) { toast("Музыка скоро появится"); return; }
  const a = musicAudio();
  if (!a.src) musicLoad(music.i || 0);
  music.on = true;
  const p = a.play(); if (p && p.catch) p.catch(() => toast("Нажми ▶ ещё раз, чтобы включить звук"));
  renderMusicBar();
}
function musicToggle() { const a = musicAudio(); if (music.playing) a.pause(); else musicPlay(); }
function musicNext() {
  const n = music.shuffle && TRACKS.length > 2 ? (music.i + 1 + Math.floor(Math.random() * (TRACKS.length - 1))) % TRACKS.length : music.i + 1;
  musicLoad(n); musicPlay();
}
function musicPrev() { const a = musicAudio(); if (a.currentTime > 5) { a.currentTime = 0; return; } musicLoad(music.i - 1); musicPlay(); }
function musicStop() { if (music.audio) music.audio.pause(); music.on = false; renderMusicBar(); if (chatOpenMusic()) render(); }
const chatOpenMusic = () => { const t = state.stack[state.stack.length - 1]; return t && t.type === "music"; };

function renderMusicBar() {
  let el = document.getElementById("musicbar");
  const show = music.on && store.profile && !chatOpenMusic();
  document.body.classList.toggle("has-musicbar", !!show);
  if (!show) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div"); el.id = "musicbar"; el.className = "musicbar"; document.body.appendChild(el);
    el.onclick = (e) => {
      const b = e.target.closest("[data-m]"); haptic();
      if (!b) { push({ type: "music" }); return; }
      ({ toggle: musicToggle, next: musicNext, close: musicStop })[b.dataset.m]();
    };
  }
  const t = TRACKS[music.i] || { t: "" };
  el.innerHTML = `<span class="mq ${music.playing ? "on" : ""}"><i></i><i></i><i></i></span><b>${esc(t.t)}</b>
    <button data-m="toggle" aria-label="Пауза">${music.playing ? ICO.pause : ICO.play}</button><button data-m="next" aria-label="Следующий">${ICO.next}</button><button data-m="close" aria-label="Выключить">${ICO.close}</button>`;
}

// ровные SVG-иконки вместо эмодзи (эмодзи на iPhone рисуются цветными квадратами)
const ICO = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 6.2v11.6a.8.8 0 0 0 1.23.67L15 12.67a.8.8 0 0 0 0-1.34L6.23 5.53A.8.8 0 0 0 5 6.2z"/><rect x="16.5" y="5.5" width="2.6" height="13" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M19 6.2v11.6a.8.8 0 0 1-1.23.67L9 12.67a.8.8 0 0 1 0-1.34l8.77-5.8A.8.8 0 0 1 19 6.2z"/><rect x="4.9" y="5.5" width="2.6" height="13" rx="1"/></svg>',
  close: '<svg viewBox="0 0 24 24" class="st"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" class="st"><path d="M3 7h3.5c2 0 3.2 1 4.2 2.6l2.6 4.8c1 1.6 2.2 2.6 4.2 2.6H21M17.5 13.5 21 17l-3.5 3.5M3 17h3.5c1.4 0 2.4-.5 3.2-1.3M13.3 8.3c.8-.8 1.8-1.3 3.2-1.3H21M17.5 3.5 21 7l-3.5 3.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6 1.7 1.7 0 0 0 9.93 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.25.4-1.51 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 17.5V6.3a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 20 4.05V15.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/></svg>',
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function viewMusic() {
  const cur = TRACKS[music.i];
  return `
  <div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button><div class="h1" style="margin-top:16px">Музыка</div></div></div>
  ${TRACKS.length ? `
  <div class="card music-now">
    <div class="eyebrow">${music.playing ? "Сейчас играет" : "Пауза"}</div>
    <div class="title">${esc(cur ? cur.t : "")}</div><div class="sub">Kevin MacLeod</div>
    <div class="music-ctl"><button data-mc="prev" aria-label="Назад">${ICO.prev}</button><button data-mc="toggle" class="big" aria-label="Играть">${music.playing ? ICO.pause : ICO.play}</button><button data-mc="next" aria-label="Дальше">${ICO.next}</button></div>
    <button class="chip ${music.shuffle ? "active" : ""}" data-mc="shuffle" style="margin-top:16px"><span class="ico">${ICO.shuffle}</span>Вперемешку</button>
  </div>
  <div class="list section">${TRACKS.map((t, i) => `<button class="row track ${i === music.i && music.on ? "cur" : ""}" data-track="${i}"><div class="grow"><div class="title">${esc(t.t)}</div><div class="sub">Kevin MacLeod · ${mmss(t.d)}</div></div><span class="trk-ico ${i === music.i && music.playing ? "on" : ""}">${i === music.i && music.playing ? '<span class="mq on"><i></i><i></i><i></i></span>' : ICO.play}</span></button>`).join("")}</div>
  <div class="muted" style="font-size:12px;margin-top:16px;line-height:1.5">Музыка: Kevin MacLeod (incompetech.com), лицензия Creative Commons Attribution 4.0. Играет, пока открыто приложение.</div>`
  : `<div class="empty"><div class="big">🎧</div><b>Музыка скоро появится</b></div>`}`;
}
function bindMusic(on) {
  on("[data-music]", () => { if (!music.on) musicPlay(); push({ type: "music" }); });
  on("[data-mc]", (el) => {
    const k = el.dataset.mc;
    if (k === "shuffle") { music.shuffle = !music.shuffle; saveMusic(); }
    else ({ prev: musicPrev, toggle: musicToggle, next: musicNext })[k]();
    setTimeout(render, 50);
  });
  on("[data-track]", (el) => { musicLoad(+el.dataset.track); musicPlay(); setTimeout(render, 50); });
}
