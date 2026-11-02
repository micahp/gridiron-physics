import glob, json, os
from collections import Counter
V1 = "/root/gridiron-playbook-builds/historical-2022-2024"
V2 = "/root/gridiron-playbook-builds/historical-2022-2024-v2"

def collect(a, b, path, out):
    if type(a) is not type(b):
        out.append((path, "type")); return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                out.append((f"{path}/{k}", "key")); continue
            collect(a[k], b[k], f"{path}/{k}", out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append((path, "length")); return
        for i, (x, y) in enumerate(zip(a, b)):
            collect(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append((path, "value"))

summary = Counter(); unexplained = []
for season in (2022, 2023, 2024):
    for p in sorted(glob.glob(f"{V1}/*-{season}.json")):
        name = os.path.basename(p)
        if name.startswith("build"):
            continue
        old = json.load(open(p)); new = json.load(open(os.path.join(V2, name)))
        out = []
        collect(old, new, name, out)
        for path, kind in out:
            if path.endswith("/absolute_difference"):
                summary["absolute_difference (rounding)"] += 1
            elif "/shotgun_source/categories/" in path and name.split("-")[0] in ("DAL", "JAX") and str(season) == "2022":
                summary["shotgun_source, DAL/JAX 2022 (named correction)"] += 1
            else:
                unexplained.append((path, kind))
print(dict(summary))
print("unexplained profile changes:", len(unexplained), unexplained[:10])

# Set-level check on the named correction: which (game, play) moved between source categories.
def pairs(profile, side):
    cats = profile[side]["profile"]["shotgun_source"]["categories"]
    return {cat: {(s["game_id"], str(s["play_id"])) for s in v.get("source_ids", [])} for cat, v in cats.items()}
for team in ("DAL", "JAX"):
    side = "defense" if team == "DAL" else "offense"
    old = pairs(json.load(open(f"{V1}/{team}-2022.json")), side)
    new = pairs(json.load(open(f"{V2}/{team}-2022.json")), side)
    print(team, side, "participation removed:", sorted(old["participation"] - new["participation"]),
          "participation added:", sorted(new["participation"] - old["participation"]),
          "ftn removed:", sorted(old["ftn"] - new["ftn"]), "ftn added:", sorted(new["ftn"] - old["ftn"]))

# Report lines that changed.
for season in (2022, 2023, 2024):
    old = open(f"{V1}/BUILD-REPORT-{season}.md").read().splitlines()
    new = open(f"{V2}/BUILD-REPORT-{season}.md").read().splitlines()
    for i, (x, y) in enumerate(zip(old, new), 1):
        if x != y:
            print(season, "line", i, "OLD:", x[:160]); print(season, "line", i, "NEW:", y[:160])
