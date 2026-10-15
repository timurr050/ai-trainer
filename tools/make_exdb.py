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
fedb_rows = {}
for i, e in enumerate(ex):
    name, steps = tr[i]
    rows.append([
        e["id"], name, e["name"],
        "".join(chr(97 + MUSCLES.index(m)) for m in e["primaryMuscles"]),
        "".join(chr(97 + MUSCLES.index(m)) for m in e["secondaryMuscles"]),
        eq_of(e), LEVEL[e["level"]], CATS.index(e["category"]), 1 if e["mechanic"] == "compound" else 0,
        " / ".join(steps), len(e["images"]), "",
    ])
    fedb_rows[e["id"]] = rows[-1]

# ===== ExerciseDB v1 (1500 упражнений с GIF, static.exercisedb.dev) =====
# Перевод: tools/tr_edb/out*.txt «id|название|шаг / шаг». Совпавшие с free-exercise-db получают GIF, дубли не добавляются.
nrm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-zа-я0-9 ]", " ", s.lower().replace("ё", "е"))).strip()
edb = json.load(open(root / "exercisedb.json"))
etr = {}
for f in sorted((root / "tr_edb").glob("out[0-9].txt")):
    for line in f.read_text().splitlines():
        if line.strip():
            i, name, steps = line.split("|", 2)
            etr[i.strip()] = (name.strip(), [x.strip() for x in steps.split(" / ") if x.strip()])
E_MUS = {"abdominals": "abdominals", "pectorals": "chest", "glutes": "glutes", "biceps": "biceps", "triceps": "triceps", "deltoids": "shoulders",
         "rear deltoids": "shoulders", "rotator cuff": "shoulders", "upper back": "middle back", "rhomboids": "middle back", "back": "middle back",
         "latissimus dorsi": "lats", "calves": "calves", "soleus": "calves", "quadriceps": "quadriceps", "forearms": "forearms", "wrists": "forearms",
         "wrist flexors": "forearms", "wrist extensors": "forearms", "grip muscles": "forearms", "hands": "forearms", "brachialis": "biceps",
         "hamstrings": "hamstrings", "erector spinae": "lower back", "trapezius": "traps", "abductors": "abductors", "adductors": "adductors",
         "serratus anterior": "chest", "levator scapulae": "neck", "sternocleidomastoid": "neck", "core": "abdominals", "obliques": "abdominals",
         "hip flexors": "abdominals"}
E_EQ = {"bodyweight": "", "towel": "", "dumbbell": "dumbbells", "cable": "cable", "barbell": "barbell", "ez bar": "barbell", "olympic barbell": "barbell",
        "trap bar": "barbell", "stability ball": "fitball", "leverage machine": "machines", "smith machine": "machines", "sled machine": "machines",
        "assisted": "machines", "resistance band": "bands", "band": "bands", "kettlebell": "kettlebell", "weighted": "other", "medicine ball": "medball",
        "rope": "rope", "roller": "roller", "suspension trainer": "other", "bosu ball": "other", "ab wheel": "other", "tennis ball": "other",
        "tire": "other", "hammer": "other", "elliptical machine": "cardio", "stationary bike": "cardio", "stepmill machine": "cardio",
        "upper body ergometer": "cardio", "ski ergometer": "cardio", "skierg machine": "cardio"}
def mcodes(lst):
    out = []
    for m in lst:
        k = E_MUS.get(m.lower())
        if k and k not in out:
            out.append(k)
    return out
fedb_by_en = {nrm(e["name"]): e["id"] for e in ex}
fedb_by_ru = {}
for r in rows:
    fedb_by_ru.setdefault(nrm(r[1]), r)
seen_en, added, merged, dup_ru = set(), 0, 0, []
for e in edb:
    en = nrm(e["name"])
    if en in seen_en:
        continue
    seen_en.add(en)
    gid = e["exerciseId"]
    if en in fedb_by_en:
        r = fedb_rows[fedb_by_en[en]]
        if not r[11]:
            r[11] = gid; merged += 1
        continue
    if gid not in etr:
        continue
    name, steps = etr[gid]
    if nrm(name) in fedb_by_ru:
        r = fedb_by_ru[nrm(name)]
        if r[0].startswith("e_"):
            dup_ru.append(name)
        elif not r[11]:
            r[11] = gid; merged += 1
        continue
    prim = mcodes(e["targetMuscles"])
    sec = [m for m in mcodes(e["secondaryMuscles"]) if m not in prim]
    eqs = [E_EQ.get(x.lower(), "other") for x in e["equipments"]]
    eqs = [x for x in dict.fromkeys(eqs) if x]
    n = e["name"].lower()
    if not eqs or eqs == ["other"]:
        if re.search(r"pull-?up|chin-?up|hanging|muscle up|toes to bar", n): eqs = ["pullup"]
        elif re.search(r"\bdips?\b", n) and "hip" not in n: eqs = ["dips"]
    if eqs[:1] in (["dumbbells"], ["barbell"]) and re.search(r"\bbench\b|incline|decline", n): eqs.append("bench")
    cardio = "cardio" in [b.lower() for b in e["bodyParts"]] or "cardiovascular system" in [m.lower() for m in e["targetMuscles"]]
    cat = 6 if cardio else 1 if re.search(r"stretch|mobility|circles", n) else 2 if re.search(r"jump|hop|plyo|burpee|skater", n) else 0
    if cat == 6 and "cardio" in eqs: eqs = []
    level = 1 if not eqs or eqs[0] in ("bands", "fitball", "roller") else 2
    if re.search(r"one arm|single arm|pistol|muscle up|handstand|one leg|archer|clap|plyo|snatch|clean|jerk", n): level = 3 if not eqs else 2 if level == 1 else 3
    comp = 1 if len(prim) + len(sec) >= 3 or re.search(r"squat|deadlift|press|row|pull-?up|chin-?up|lunge|dip|clean|snatch|burpee|thruster", n) else 0
    if not prim and cat != 6:
        bp = (e["bodyParts"] or ["waist"])[0].lower()
        prim = [{"waist": "abdominals", "upper legs": "quadriceps", "lower legs": "calves", "upper arms": "biceps", "lower arms": "forearms",
                 "back": "middle back", "chest": "chest", "shoulders": "shoulders", "neck": "neck"}.get(bp, "abdominals")]
    rows.append(["e_" + gid, name, e["name"][:1].upper() + e["name"][1:],
                 "".join(chr(97 + MUSCLES.index(m)) for m in prim), "".join(chr(97 + MUSCLES.index(m)) for m in sec),
                 ",".join(eqs), level, cat, comp, " / ".join(steps), 0, gid])
    fedb_by_ru[nrm(name)] = rows[-1]
    added += 1
print(f"ExerciseDB: добавлено {added}, GIF к существующим {merged}, одинаковых русских названий {len(dup_ru)} {dup_ru[:10]}, без перевода {len([e for e in edb if e['exerciseId'] not in etr])}")
# кураторские упражнения: GIF по совпадению английского названия их фото из free-exercise-db + ручные
cur_gif = {}
by_en = {nrm(e["name"]): e["exerciseId"] for e in edb}
for cid, en in {"burpee": "burpee", "shadow": "left hook (boxing)", "pushup_knee": "push-up on lower arms"}.items():
    if nrm(en) in by_en:
        cur_gif[cid] = by_en[nrm(en)]
out = ("// Сгенерировано tools/make_exdb.py из free-exercise-db (Unlicense, github.com/yuhonas/free-exercise-db) и ExerciseDB v1 (GIF: static.exercisedb.dev)\n"
       "const DB_RAW = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n"
       "const CURATED_GIF = " + json.dumps(cur_gif) + ";\n")
(root.parent / "src" / "exdb.js").write_text(out)
print("exdb.js:", len(out.encode()), "bytes,", len(rows), "exercises")
