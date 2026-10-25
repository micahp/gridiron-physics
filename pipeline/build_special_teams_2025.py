#!/usr/bin/env python3
"""Build league-level 2025 special-teams tables from nflverse play-by-play.

Reads data/raw/pbp_2025.csv.gz (hash-checked), regular season only, and writes
data/special_teams/2025-league.json. The simulator samples kick distances,
outcomes and return yards from these counts. They are league rates for the
whole 2025 season, not team or kicker rates.
"""
import collections
import csv
import gzip
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "pbp_2025.csv.gz")
OUT = os.path.join(ROOT, "data", "special_teams", "2025-league.json")
EXPECTED_SHA256 = "2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978"

FG_BUCKETS = [("<30", 0, 30), ("30-39", 30, 40), ("40-49", 40, 50), ("50-59", 50, 60), ("60+", 60, 200)]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pooled_blocked_resolution():
    with open(os.path.join(ROOT, "data", "special_teams", "blocked-punts-2022-2025.json")) as f:
        counts = json.load(f)["outcome_counts"]
    return {k: counts[k] for k in ("receiving_recovery", "kicking_recovery", "out_of_bounds", "safety")}


def pooled_blocked_touchdowns():
    with open(os.path.join(ROOT, "data", "special_teams", "blocked-punts-2022-2025.json")) as f:
        return json.load(f)["receiving_touchdown_counts"]


SAFETY_ONSIDE_MAX_YARDS = 30


def classify_post_safety_kick(kick, follow=None):
    """Classify the kickoff row that follows a safety (kicking team's own 20).

    Rule, using only the play's own fields and text:
    - Onside label (desc says "kicks onside"): a genuine onside kick needs a
      positive kick_distance field no longer than SAFETY_ONSIDE_MAX_YARDS, and
      one of: fair catch (kickoff_fair_catch=1), kicking-team recovery
      (own_kickoff_recovery=1), or receiving-team recovery (own_kickoff_recovery=0,
      no touchback/downed/out-of-bounds, return_yards=0, no fumble). Any onside
      row failing these checks is a suspect label and is excluded, not reclassified.
    - No onside label: a touchback or a return is a normal free kick. A penalty
      or a fumble on the kick play is excluded because the receiving spot is not
      set by the kick alone.
    Spots are the receiving team's yardline_100 (yards to the kicking team's goal):
    a receiving-team yardline N is 100 - N, a kicking-team yardline N is N.
    Returns (category, record).
    """
    ref = {"game_id": kick["game_id"], "play_id": kick["play_id"]}
    desc = kick["desc"]
    kicking, receiving = kick["defteam"], kick["posteam"]
    m_from = re.search(r"kicks (onside )?(\d+) yards from (\w+) (\d+)", desc)
    if not m_from or m_from.group(3) != kicking or int(m_from.group(4)) != 20:
        raise SystemExit(f"post-safety kick {ref} is not from the kicking team's 20: {desc[:120]}")
    onside = bool(m_from.group(1))

    def spot_for(team, yd):
        if team == kicking:
            return int(yd)
        if team == receiving:
            return 100 - int(yd)
        raise SystemExit(f"post-safety kick {ref} spot team {team} is neither team: {desc[:120]}")

    if onside:
        dist = num(kick["kick_distance"])
        landing = re.search(r"kicks onside \d+ yards from \w+ \d+ to (\w+) (\d+)", desc)
        if dist <= 0:
            return "suspect_onside_label", {**ref, "reason":
                f"kick_distance field is {kick['kick_distance'] or 'empty'} but the text says {m_from.group(2)} yards"}
        if dist > SAFETY_ONSIDE_MAX_YARDS:
            return "suspect_onside_label", {**ref, "reason": f"deep kick ({int(dist)} yards) labelled onside"}
        if not landing:
            return "suspect_onside_label", {**ref, "reason": "no landing spot in the text"}
        if kick["kickoff_fair_catch"] == "1":
            outcome = "fair_catch"
        elif kick["own_kickoff_recovery"] == "1":
            outcome = "kicking_recovery"
        elif (kick["own_kickoff_recovery"] == "0" and kick["touchback"] == "0" and kick["kickoff_downed"] == "0"
              and kick["kickoff_out_of_bounds"] == "0" and num(kick["return_yards"]) == 0 and kick["fumble_lost"] == "0"):
            outcome = "receiving_recovery"
        else:
            return "suspect_onside_label", {**ref, "reason": "outcome fields are not consistent with an onside attempt"}
        if kick["penalty"] == "1":
            return "excluded_penalty_on_kick", {**ref, "reason": "penalty on the kick play; the spot is set by enforcement"}
        yl = spot_for(landing.group(1), landing.group(2))
        if outcome == "kicking_recovery":
            # Rule 7-3-1(e): the kicking team that legally recovers a free kick starts a
            # new series. The spot is the landing spot in the text; the next scrimmage
            # play must confirm kicking-team first and 10 at the same spot, or the build exits.
            if "RECOVERED by" not in desc or follow is None:
                raise SystemExit(f"kicking-team onside recovery {ref} has no recovery text or no following scrimmage play")
            if follow["posteam"] != kicking or follow["down"] != "1" or follow["ydstogo"] != "10" \
                    or int(num(follow["yardline_100"])) != 100 - yl:
                raise SystemExit(f"kicking-team onside recovery {ref} does not match its next play {follow['play_id']}")
            return "onside_kicking_recovery", {**ref, "outcome": outcome, "return_yards": 0,
                "offense_spot_yardline_100": 100 - yl, "kicking_team": kicking, "receiving_team": receiving,
                "next_play_id": follow["play_id"], "next_play_down": 1, "next_play_ydstogo": 10}
        cat = "onside_receiving_possession"
        return cat, {**ref, "outcome": outcome, "return_yards": 0, "receiving_spot_yardline_100": yl,
                     "kicking_team": kicking, "receiving_team": receiving}

    if kick["penalty"] == "1":
        return "excluded_penalty_on_kick", {**ref, "reason": "penalty on the kick play; the spot is set by enforcement"}
    if kick["fumble_lost"] == "1":
        return "excluded_return_fumble", {**ref, "reason": "fumble on the kick or return; the recovery spot has no down-and-distance rule in this table"}
    if kick["touchback"] == "1":
        m = re.search(r"Touchback to the (\w+) (\d+)", desc)
        if not m:
            raise SystemExit(f"touchback after safety {ref} has no spot in the text: {desc[:120]}")
        outcome, ret, team, yd = "touchback", 0, m.group(1), m.group(2)
    else:
        m = re.search(r"to (\w+) (\d+) for (-?\d+) yards", desc)
        if not m or int(m.group(3)) != int(num(kick["return_yards"])):
            raise SystemExit(f"post-safety return {ref} does not match its fields: {desc[:120]}")
        outcome, ret, team, yd = "returned", int(m.group(3)), m.group(1), m.group(2)
    if team != receiving:
        raise SystemExit(f"post-safety return {ref} spotted for {team}, not the receiving team {receiving}")
    return "normal_free_kick", {**ref, "outcome": outcome, "return_yards": ret,
                                "receiving_spot_yardline_100": spot_for(team, yd),
                                "kicking_team": kicking, "receiving_team": receiving}


def build_safety_kicks(reg_rows):
    by_game = collections.defaultdict(list)
    for r in reg_rows:
        by_game[r["game_id"]].append(r)
    for seq in by_game.values():
        seq.sort(key=lambda r: int(r["play_id"]))
    cats = collections.defaultdict(list)
    no_kick = []
    safeties = 0
    for gid, seq in by_game.items():
        for i, r in enumerate(seq):
            if r["safety"] != "1":
                continue
            safeties += 1
            nxt = seq[i + 1] if i + 1 < len(seq) else None
            if nxt is None or nxt["play_type"] != "kickoff" or nxt["kickoff_attempt"] != "1":
                no_kick.append({"game_id": gid, "play_id": r["play_id"], "reason": "no kickoff follows the safety (game ended)"})
                continue
            if nxt["defteam"] != r["posteam"]:
                raise SystemExit(f"kicking team after safety {gid} {r['play_id']} is not the team scored on")
            follow = next((x for x in seq[i + 2:] if x["kickoff_attempt"] == "0" and x["play_type"] in ("pass", "run")), None)
            cat, rec = classify_post_safety_kick(nxt, follow)
            cats[cat].append(rec)
    names = ["normal_free_kick", "onside_receiving_possession", "onside_kicking_recovery"]
    sampled = {}
    for name in names:
        rows = cats[name]
        sampled[name] = {"n": len(rows),
                         "outcomes": dict(collections.Counter(x["outcome"] for x in rows)),
                         "rows": rows}
    return {
        "scope": "2025 regular-season kickoffs that follow a safety (safety=1 rows). Every post-safety kick in the data is taken from the kicking team's own 20. League-wide counts, not team or kicker rates.",
        "classification_rule": (
            "Each REG safety row is paired with the next play in the same game. A kickoff with kickoff_attempt=1 by the team scored on is a post-safety kick. "
            f"Onside label (desc 'kicks onside'): genuine only if kick_distance > 0 and <= {SAFETY_ONSIDE_MAX_YARDS} yards and the fields show a fair catch, a kicking-team recovery, or a receiving-team recovery; otherwise suspect. "
            "No onside label: touchback or return is a normal free kick; a penalty or fumble on the kick play is excluded. "
            "Spots are the receiving team's yardline_100 (yards to the kicking team's goal). A kicking-team onside recovery (Rule 7-3-1(e)) keeps the ball with the kicking team at first and 10; its spot is the offense-view yardline_100 and is checked against the next scrimmage play."),
        "safeties": safeties,
        "no_kick_after_safety": {"n": len(no_kick), "rows": no_kick},
        "categories": sampled,
        "suspect_onside_labels": {"n": len(cats["suspect_onside_label"]), "rows": cats["suspect_onside_label"]},
        "excluded": {
            "penalty_on_kick": {"n": len(cats["excluded_penalty_on_kick"]), "rows": cats["excluded_penalty_on_kick"]},
            "return_fumble": {"n": len(cats["excluded_return_fumble"]), "rows": cats["excluded_return_fumble"]},
        },
    }


def main():
    digest = sha256(RAW)
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"hash mismatch for {RAW}: {digest}")

    fg = {name: {"attempts": 0, "made": 0} for name, _, _ in FG_BUCKETS}
    xp = collections.Counter()
    punt_dist = collections.Counter()
    punt_cats = collections.Counter()
    punt_ret = collections.Counter()
    ko_cats = collections.Counter()
    ko_ret = collections.Counter()
    # Touchback sub-split. 2026 Rule 6-1-5: a kick that touches the landing
    # zone before it reaches the end zone is spotted at the receiving team's
    # 20; a kick that reaches the end zone in the air is spotted at its 35.
    ko_tb_zone = 0
    ko_tb_air = 0
    punts = kickoffs = 0
    blocked_res = collections.Counter()
    fg_missed = fg_blocked = 0
    fg_blocked_res = collections.Counter()
    fg_blocked_td = collections.Counter()

    with gzip.open(RAW, "rt") as f:
        all_reg = [r for r in csv.DictReader(f) if r["season_type"] == "REG"]
    for r in all_reg:
        pt = r["play_type"]
        if pt == "field_goal" and r["field_goal_attempt"] == "1":
            d = num(r["kick_distance"])
            name = next(n for n, lo, hi in FG_BUCKETS if lo <= d < hi)
            fg[name]["attempts"] += 1
            if r["field_goal_result"] == "made":
                fg[name]["made"] += 1
            elif r["field_goal_result"] == "missed":
                fg_missed += 1
            elif r["field_goal_result"] == "blocked":
                fg_blocked += 1
                recovered = re.search(r"recovered by (\w+)-", r["desc"], re.I)
                if not recovered:
                    fg_blocked_res["no_recovery"] += 1
                elif recovered.group(1) == r["posteam"]:
                    fg_blocked_res["kicking_recovery"] += 1
                else:
                    fg_blocked_res["receiving_recovery"] += 1
                    fg_blocked_td["touchdown" if "TOUCHDOWN" in r["desc"].upper() else "no_touchdown"] += 1
        elif pt == "extra_point" and r["extra_point_attempt"] == "1":
            xp[r["extra_point_result"] or "unknown"] += 1
        elif pt == "punt" and r["punt_attempt"] == "1" and r["kick_distance"]:
            punts += 1
            punt_dist[int(num(r["kick_distance"]))] += 1
            if r["punt_blocked"] == "1":
                recovered = re.search(r"recovered by (\w+)-", r["desc"], re.I)
                if recovered:
                    blocked_res["kicking_recovery" if recovered.group(1) == r["posteam"] else "receiving_recovery"] += 1
                elif "SAFETY" in r["desc"]:
                    blocked_res["safety"] += 1
                elif "out of bounds" in r["desc"].lower():
                    blocked_res["out_of_bounds"] += 1
                else:
                    raise SystemExit(f"unclassified blocked punt {r['game_id']} {r['play_id']}: {r['desc'][:120]}")
            if r["touchback"] == "1":
                cat = "touchback"
            elif r["punt_fair_catch"] == "1":
                cat = "fair_catch"
            elif r["punt_downed"] == "1":
                cat = "downed"
            elif r["punt_out_of_bounds"] == "1":
                cat = "out_of_bounds"
            elif r["punt_blocked"] == "1":
                cat = "blocked"
            else:
                cat = "returned"
                punt_ret[int(num(r["return_yards"]))] += 1
            punt_cats[cat] += 1
        elif pt == "kickoff" and r["kickoff_attempt"] == "1" and r["kick_distance"]:
            kickoffs += 1
            if r["touchback"] == "1":
                cat = "touchback"
                # "to landing zone to end zone" means the kick touched the
                # landing zone before reaching the end zone (Rule 6-1-5).
                if "to landing zone" in r["desc"]:
                    ko_tb_zone += 1
                else:
                    ko_tb_air += 1
            elif r["kickoff_out_of_bounds"] == "1":
                cat = "out_of_bounds"
            elif r["kickoff_fair_catch"] == "1":
                cat = "fair_catch"
            elif r["kickoff_downed"] == "1":
                cat = "downed"
            else:
                cat = "returned"
                ko_ret[int(num(r["return_yards"]))] += 1
            ko_cats[cat] += 1

    out = {
        "schema_version": "gridiron.special-teams-league.v1",
        "season": 2025,
        "season_type": "REG",
        "source": {
            "name": "nflverse play_by_play_2025.csv.gz",
            "path": os.path.basename(RAW),
            "sha256": digest,
        },
        "scope": "League-wide 2025 regular-season rates. Not team or kicker rates.",
        "field_goals": {
            "distance_is_yards_to_goal_plus": 18,
            "buckets": [
                {"name": name, "attempts": fg[name]["attempts"], "made": fg[name]["made"]}
                for name, _, _ in FG_BUCKETS
            ],
            "non_make_split": {"blocked": fg_blocked, "missed": fg_missed,
                               "source": "nflverse play_by_play_2025 REG field_goal_result"},
            "blocked_resolution": {k: fg_blocked_res[k] for k in ("receiving_recovery", "kicking_recovery", "no_recovery")},
            "blocked_receiving_touchdown": {k: fg_blocked_td[k] for k in ("touchdown", "no_touchdown")},
        },
        "extra_points": dict(xp),
        "punts": {
            "n": punts,
            "distance_yards": {str(k): v for k, v in sorted(punt_dist.items())},
            "outcomes": dict(punt_cats),
            "blocked_resolution": {k: blocked_res[k] for k in ("receiving_recovery", "kicking_recovery", "out_of_bounds", "safety")},
            "blocked_resolution_pooled": pooled_blocked_resolution(),
            "blocked_receiving_touchdown_pooled": pooled_blocked_touchdowns(),
            "return_yards": {str(k): v for k, v in sorted(punt_ret.items())},
        },
        "kickoffs": {
            "n": kickoffs,
            "outcomes": dict(ko_cats),
            "return_yards": {str(k): v for k, v in sorted(ko_ret.items())},
            # Touchback sub-split used to place the spot under 2026 Rule 6-1-5.
            # landing_zone -> receiving team's 20; in_air -> receiving team's 35.
            "touchback_spot": {
                "landing_zone": ko_tb_zone,
                "in_air": ko_tb_air,
            },
        },
    }
    out["safety_kicks"] = build_safety_kicks(all_reg)
    if blocked_res["unclassified"]:
        sys.exit(f"{blocked_res['unclassified']} blocked punts have no recognized resolution; refusing to write {OUT}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT}: punts {punts}, kickoffs {kickoffs}, field goals {sum(b['attempts'] for b in out['field_goals']['buckets'])}")


if __name__ == "__main__":
    main()
