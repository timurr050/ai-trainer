# Собирает приложение:
#  index.html   — лёгкая оболочка: при каждом открытии спрашивает version.txt (без кэша)
#                 и подгружает app.css / app.js нужной версии, поэтому обновления приходят сразу;
#  app.css, app.js, version.txt — само приложение;
#  standalone.html — всё в одном файле (для Netlify и подобных, где удобнее один файл).
import hashlib, pathlib, re
src = pathlib.Path(__file__).parent
root = src.parent
t = (src / "index.template.html").read_text()
css = (src / "styles.css").read_text()
app = (src / "app.js").read_text()
assert app.count("// @@RUN@@") == 1
app = app.replace("// @@RUN@@", (src / "run.js").read_text())
assert app.count("// @@ADMIN@@") == 1
app = app.replace("// @@ADMIN@@", (src / "admin.js").read_text())
assert app.count("// @@MUSIC@@") == 1
# треки, которые скачал workflow fetch-music.yml: ok|файл|название|секунды|байты
tracks = []
log = root / "tools" / "music-log.txt"
if log.exists():
    for line in log.read_text().splitlines():
        p = line.split("|")
        if p[0] == "ok" and int(p[3] or 0) >= 90 and (root / "music" / (p[1] + ".mp3")).exists():  # короткие лупы не берём
            tracks.append({"f": p[1], "t": p[2], "d": int(p[3] or 0)})
import json as _json
# если workflow fetch-jamendo.yml скачал список deep house — играем его (поток с серверов Jamendo)
jam = root / "music" / "jamendo.json"
if jam.exists():
    jl = _json.loads(jam.read_text() or "[]")
    if jl:
        tracks = [{"u": t["u"], "t": t["t"], "a": t["a"], "d": t["d"], "s": t.get("s", ""), "l": t.get("l", "")} for t in jl]
app = app.replace("// @@MUSIC@@", "const TRACKS = " + _json.dumps(tracks, ensure_ascii=False) + ";\n" + (src / "music.js").read_text())
assert app.count("// @@CHAT@@") == 1
app = app.replace("// @@CHAT@@", (src / "chat.js").read_text())
js = "\n".join((src / f).read_text() for f in ["data.js", "exdb.js"]) + "\n;\n" + app

# один файл
full = t
for mark, body in [("/*STYLES*/", css), ("/*DATA*/\n/*EXDB*/", (src / "data.js").read_text() + "\n" + (src / "exdb.js").read_text()), ("/*APP*/", app)]:
    assert full.count(mark) == 1, mark
    full = full.replace(mark, body)
(root / "standalone.html").write_text(full)

# оболочка + файлы с версией
ver = hashlib.sha1((css + js).encode()).hexdigest()[:10]
(root / "app.css").write_text(css)
(root / "app.js").write_text(js)
(root / "version.txt").write_text(ver + "\n")
loader = """<script>
(function () {
  function load(v) {
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "app.css?v=" + v;
    l.onload = l.onerror = function () { var s = document.createElement("script"); s.src = "app.js?v=" + v; document.body.appendChild(s); };
    document.head.appendChild(l);
  }
  var done = false, fallback = setTimeout(function () { if (!done) { done = true; load("t" + Date.now()); } }, 4000);
  fetch("version.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
    .then(function (v) { if (!done) { done = true; clearTimeout(fallback); load(v.trim()); } },
          function () { if (!done) { done = true; clearTimeout(fallback); load("t" + Date.now()); } });
})();
</script>"""
# пока не загрузился app.css, показываем только чёрный фон и индикатор загрузки (без «голых» кнопок)
BOOT = ("<style>html,body{background:#000;margin:0}body:not(.ready) #tabbar{display:none}"
        ".boot{position:fixed;inset:0;display:grid;place-items:center}"
        ".boot i{width:34px;height:34px;border-radius:50%;border:3px solid #262626;border-top-color:#ccff00;animation:bs .8s linear infinite}"
        "@keyframes bs{to{transform:rotate(360deg)}}</style>")
shell = re.sub(r"<style>\n/\*STYLES\*/\n</style>", BOOT, t)
shell = shell.replace('<main id="app"></main>', '<main id="app"><div class="boot"><i></i></div></main>', 1)
shell = re.sub(r"<script>\n/\*DATA\*/\n/\*EXDB\*/\n</script>\n<script>\n/\*APP\*/\n</script>", loader, shell)
shell = shell.replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\">\n<meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">", 1)
assert "/*" not in shell, "маркеры не заменены"
(root / "index.html").write_text(shell)
print("version", ver, "| app.js", len(js), "| standalone.html", len(full))
