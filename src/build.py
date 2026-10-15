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
js = "\n".join((src / f).read_text() for f in ["data.js", "exdb.js"]) + "\n;\n" + (src / "app.js").read_text()

# один файл
full = t
for mark, body in [("/*STYLES*/", css), ("/*DATA*/\n/*EXDB*/", (src / "data.js").read_text() + "\n" + (src / "exdb.js").read_text()), ("/*APP*/", (src / "app.js").read_text())]:
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
shell = re.sub(r"<style>\n/\*STYLES\*/\n</style>", "<style>html,body{background:#000;margin:0}</style>", t)
shell = re.sub(r"<script>\n/\*DATA\*/\n/\*EXDB\*/\n</script>\n<script>\n/\*APP\*/\n</script>", loader, shell)
shell = shell.replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\">\n<meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">", 1)
assert "/*" not in shell, "маркеры не заменены"
(root / "index.html").write_text(shell)
print("version", ver, "| app.js", len(js), "| standalone.html", len(full))
