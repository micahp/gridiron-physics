"""Machine-readable before and after comparison of two historical build directories (2022 to 2024).

For each season it compares every team profile, the observation stream, the build manifest and the build report. JSON is
compared field by field; the observation stream is compared line by line; the report is compared as text. Each difference
is counted by field path with the list indexes replaced, and the first few examples are kept. Reads both directories and
writes one JSON file.

Usage: python3 pipeline/compare_historical_builds.py <old build dir> <new build dir> <output json>
"""
import glob
import json
import os
import re
import sys
from collections import Counter

SEASONS = (2022, 2023, 2024)
EXAMPLES = 5


def pattern(path):
    return re.sub(r"\[\d+\]", "[]", path)


def diff(a, b, path, counts, examples):
    if type(a) is not type(b):
        note(path, ("type", type(a).__name__, type(b).__name__), counts, examples)
    elif isinstance(a, dict):
        for key in sorted(set(a) | set(b), key=str):
            if key not in a:
                note(f"{path}/{key}", ("added",), counts, examples)
            elif key not in b:
                note(f"{path}/{key}", ("removed",), counts, examples)
            else:
                diff(a[key], b[key], f"{path}/{key}", counts, examples)
    elif isinstance(a, list):
        if len(a) != len(b):
            note(path, ("length", len(a), len(b)), counts, examples)
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, f"{path}[{i}]", counts, examples)
    elif a != b:
        note(path, ("value", a, b), counts, examples)


def note(path, detail, counts, examples):
    counts[pattern(path)] += 1
    if len(examples.setdefault(pattern(path), [])) < EXAMPLES:
        examples[pattern(path)].append({"path": path, "old_new": detail[1:] if detail[0] == "value" else detail})


def compare_profiles(old_dir, new_dir, season, out):
    suffix = f"-{season}.json"
    names = sorted(os.path.basename(p) for p in glob.glob(os.path.join(old_dir, f"*{suffix}"))
                   if not os.path.basename(p).startswith("build"))
    total_counts, total_examples = Counter(), {}
    for name in names:
        with open(os.path.join(old_dir, name), encoding="utf-8") as stream:
            old = json.load(stream)
        with open(os.path.join(new_dir, name), encoding="utf-8") as stream:
            new = json.load(stream)
        counts, examples = Counter(), {}
        diff(old, new, name, counts, examples)
        out["profiles"][name] = dict(sorted(counts.items()))
        total_counts.update(counts)
        for pat, rows in examples.items():
            total_examples.setdefault(pat, []).extend(rows[:EXAMPLES])
    out["profile_totals"][str(season)] = {"files": len(names), "changed_fields": sum(total_counts.values()),
                                          "by_pattern": dict(sorted(total_counts.items()))}
    for pat, rows in total_examples.items():
        out["profile_examples"].setdefault(str(season), {})[pat] = rows[:EXAMPLES]


def compare_observations(old_dir, new_dir, season, out):
    old_path = os.path.join(old_dir, f"observations-{season}.jsonl")
    new_path = os.path.join(new_dir, f"observations-{season}.jsonl")
    counts, examples, lines, changed = Counter(), {}, 0, 0
    with open(old_path, encoding="utf-8") as old_stream, open(new_path, encoding="utf-8") as new_stream:
        for old_line, new_line in zip(old_stream, new_stream):
            lines += 1
            if old_line == new_line:
                continue
            changed += 1
            diff(json.loads(old_line), json.loads(new_line), "", counts, examples)
    with open(old_path, encoding="utf-8") as stream:
        old_count = sum(1 for _ in stream)
    with open(new_path, encoding="utf-8") as stream:
        new_count = sum(1 for _ in stream)
    out["observations"][str(season)] = {
        "records_old": old_count, "records_new": new_count, "compared": lines, "changed_records": changed,
        "by_pattern": dict(sorted(counts.items())),
        "examples": {pat: rows[:EXAMPLES] for pat, rows in examples.items()},
    }


def compare_text(old_path, new_path):
    with open(old_path, encoding="utf-8") as stream:
        old = stream.read().splitlines()
    with open(new_path, encoding="utf-8") as stream:
        new = stream.read().splitlines()
    changed = [i + 1 for i, (x, y) in enumerate(zip(old, new)) if x != y]
    return {"old_lines": len(old), "new_lines": len(new), "changed_line_numbers": changed[:50],
            "changed_line_count": len(changed) + abs(len(old) - len(new))}


def main(argv):
    old_dir, new_dir, out_path = argv[1], argv[2], argv[3]
    out = {"profiles": {}, "profile_totals": {}, "profile_examples": {}, "observations": {}, "reports": {},
           "manifests": {}}
    for season in SEASONS:
        compare_profiles(old_dir, new_dir, season, out)
        compare_observations(old_dir, new_dir, season, out)
        out["reports"][str(season)] = compare_text(os.path.join(old_dir, f"BUILD-REPORT-{season}.md"),
                                                   os.path.join(new_dir, f"BUILD-REPORT-{season}.md"))
        with open(os.path.join(old_dir, f"build-manifest.{season}.json"), encoding="utf-8") as stream:
            old_manifest = json.load(stream)
        with open(os.path.join(new_dir, f"build-manifest.{season}.json"), encoding="utf-8") as stream:
            new_manifest = json.load(stream)
        counts, examples = Counter(), {}
        diff(old_manifest, new_manifest, "", counts, examples)
        out["manifests"][str(season)] = {"by_pattern": dict(sorted(counts.items())),
                                         "examples": {pat: rows[:EXAMPLES] for pat, rows in examples.items()}}
    with open(out_path, "w", encoding="utf-8") as stream:
        json.dump(out, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps({"profile_totals": out["profile_totals"],
                      "observations": {s: {k: v[k] for k in ("compared", "changed_records")}
                                       for s, v in out["observations"].items()},
                      "reports": out["reports"]}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv)
