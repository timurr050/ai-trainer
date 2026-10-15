# Собирает src/* в один файл index.html (его и нужно загружать на хостинг).
import pathlib
src = pathlib.Path(__file__).parent
t = (src / "index.template.html").read_text()
for mark, f in [("/*STYLES*/", "styles.css"), ("/*DATA*/", "data.js"), ("/*EXDB*/", "exdb.js"), ("/*APP*/", "app.js")]:
    assert t.count(mark) == 1, mark
    t = t.replace(mark, (src / f).read_text())
(src.parent / "index.html").write_text(t)
print("index.html:", len(t), "bytes")
