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
  el.innerHTML = `<span class="eq ${music.playing ? "on" : ""}"><i></i><i></i><i></i></span><b>${esc(t.t)}</b>
    <button data-m="toggle" aria-label="Пауза">${music.playing ? "❚❚" : "▶"}</button><button data-m="next" aria-label="Следующий">⏭</button><button data-m="close" aria-label="Выключить">✕</button>`;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function viewMusic() {
  const cur = TRACKS[music.i];
  return `
  <div class="top"><div><button class="back" data-back style="background:var(--surface)">‹ Назад</button><div class="h1" style="margin-top:16px">Музыка</div></div></div>
  ${TRACKS.length ? `
  <div class="card music-now">
    <div class="eyebrow">${music.playing ? "Сейчас играет" : "Пауза"}</div>
    <div class="title">${esc(cur ? cur.t : "")}</div><div class="sub">Kevin MacLeod</div>
    <div class="music-ctl"><button data-mc="prev" aria-label="Назад">⏮</button><button data-mc="toggle" class="big" aria-label="Играть">${music.playing ? "❚❚" : "▶"}</button><button data-mc="next" aria-label="Дальше">⏭</button></div>
    <button class="chip ${music.shuffle ? "active" : ""}" data-mc="shuffle" style="margin-top:14px">🔀 Вперемешку</button>
  </div>
  <div class="list section">${TRACKS.map((t, i) => `<button class="row track ${i === music.i && music.on ? "cur" : ""}" data-track="${i}"><div class="grow"><div class="title">${esc(t.t)}</div><div class="sub">Kevin MacLeod · ${mmss(t.d)}</div></div><span class="chev">${i === music.i && music.playing ? "🔊" : "▶"}</span></button>`).join("")}</div>
  <div class="muted" style="font-size:12px;margin-top:16px;line-height:1.5">Музыка: Kevin MacLeod (incompetech.com), лицензия Creative Commons Attribution 4.0. Играет, пока открыто приложение.</div>`
  : `<div class="empty"><div class="big">🎵</div><b>Музыка скоро появится</b></div>`}`;
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
