# Собирает src/exdb.js из free-exercise-db (tools/free-exercise-db.json) и русских переводов tools/tr/tr*.txt
import json, pathlib, re
root = pathlib.Path(__file__).parent
ex = json.load(open(root / "free-exercise-db.json"))
tr = {}
for f in sorted((root / "tr").glob("tr*.txt")):
    for line in f.read_text().splitlines():
        if not line.strip():
            continue
        i, name, steps = line.split("|", 2)
        tr[int(i)] = (name.strip(), [s.strip() for s in steps.split(" / ") if s.strip()])
missing = [i for i in range(len(ex)) if i not in tr]
assert not missing, f"нет перевода: {missing[:20]}… ({len(missing)})"

MUSCLES = ["chest", "lats", "middle back", "lower back", "traps", "shoulders", "neck", "biceps", "triceps", "forearms",
           "abdominals", "quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"]
CATS = ["strength", "stretching", "plyometrics", "powerlifting", "olympic weightlifting", "strongman", "cardio"]
LEVEL = {"beginner": 1, "intermediate": 2, "expert": 3}
EQ = {None: "", "body only": "", "dumbbell": "dumbbells", "barbell": "barbell", "e-z curl bar": "barbell", "cable": "cable",
      "machine": "machines", "kettlebells": "kettlebell", "bands": "bands", "medicine ball": "medball",
      "exercise ball": "fitball", "foam roll": "roller", "other": "other"}

def eq_of(e):
    n = e["name"].lower()
    reqs = [EQ[e["equipment"]]] if EQ[e["equipment"]] else []
    if reqs == ["other"] or not reqs:
        if re.search(r"pull-?up|chin-?up|hanging|muscle up|toes to bar", n):
            reqs = ["pullup"]
        elif re.search(r"\bdips?\b", n) and "hip" not in n:
            reqs = ["dips"]
    if reqs[:1] in (["dumbbells"], ["barbell"]) and re.search(r"\bbench\b|incline|decline", n):
        reqs.append("bench")
    return ",".join(reqs)

rows = []
for i, e in enumerate(ex):
    name, steps = tr[i]
    rows.append([
        e["id"], name, e["name"],
        "".join(chr(97 + MUSCLES.index(m)) for m in e["primaryMuscles"]),
        "".join(chr(97 + MUSCLES.index(m)) for m in e["secondaryMuscles"]),
        eq_of(e), LEVEL[e["level"]], CATS.index(e["category"]), 1 if e["mechanic"] == "compound" else 0,
        " / ".join(steps), len(e["images"]),
    ])
out = "// Сгенерировано tools/make_exdb.py из free-exercise-db (Unlicense, github.com/yuhonas/free-exercise-db)\nconst DB_RAW = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n"
(root.parent / "src" / "exdb.js").write_text(out)
print("exdb.js:", len(out.encode()), "bytes,", len(rows), "exercises")
