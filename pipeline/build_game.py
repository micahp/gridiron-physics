"""Turn ESPN play-by-play into simulation scripts.

ESPN supplies the play list, text, clock, score, drives and *participants*
(passer, rusher, receiver, tacklers, sackers, returners, ...). nflverse's
public charting of the same plays adds what ESPN text leaves out: air yards,
yards after catch, run gap, pass location, kick distance and win probability.
The two join exactly: ESPN play id == ESPN event id + nflverse play_id.

Each play becomes a script for the physics engine: where the ball is snapped,
which 22 players are on the field and in which slot, and the *outcome
constraints* the simulated play must honour (catch point, end spot, who makes
the tackle, ...). Everything between those anchors is physics.

Coordinates: x in yards along the field, 0 = left goal line, 100 = right goal
line (end zones extend to -10 / 110); y in yards across, 0..53.33. Teams swap
ends every quarter.

Usage: python3 pipeline/build_game.py -> web/data/game.json
"""
import csv
import gzip
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "data", "raw")
OUT = os.path.join(HERE, "..", "web", "data", "game.json")
EVENT = "401872995"
NV_GAME = "2026_06_SEA_DEN"


def load(name):
    return json.load(open(os.path.join(RAW, name)))


def ref_id(ref):
    m = re.search(r"/(athletes|teams)/(\d+)", ref or "")
    return m.group(2) if m else None


def num(s, d=None):
    try:
        return float(s)
    except (TypeError, ValueError):
        return d


# ------------------------------------------------------------------ teams

summary = load("summary.json")
comp = summary["header"]["competitions"][0]
TEAM = {}
for c in comp["competitors"]:
    t = c["team"]
    TEAM[t["id"]] = {
        "id": t["id"], "abbr": t["abbreviation"], "name": t["displayName"],
        "short": t.get("name") or t["abbreviation"], "homeAway": c["homeAway"],
        "color": "#" + t.get("color", "333333"), "alt": "#" + t.get("alternateColor", "ffffff"),
        "logo": (t.get("logos") or [{}])[0].get("href") or t.get("logo"), "score": int(c.get("score") or 0),
        "record": (c.get("record") or [{}])[0].get("summary"),
    }
ABBR2ID = {v["abbr"]: k for k, v in TEAM.items()}
HOME = next(k for k, v in TEAM.items() if v["homeAway"] == "home")
AWAY = next(k for k, v in TEAM.items() if v["homeAway"] == "away")


def attack_dir(team_id, quarter):
    """+1 if team_id drives toward x=100 in this quarter."""
    home_plus = quarter in (1, 3, 5)
    return 1 if (team_id == HOME) == home_plus else -1


def x_from_ytg(team_id, quarter, ytg):
    """Yards-to-opponent-endzone for team_id -> absolute x."""
    return 100 - ytg if attack_dir(team_id, quarter) > 0 else ytg


SPOT_RE = re.compile(r"\b(DEN|SEA|50)(?: (\d{1,2}))?\b")


def spot_x(text_spot, quarter):
    """'SEA 29' -> absolute x (own-goal-relative yard line of that team)."""
    if text_spot.strip() == "50":
        return 50.0
    abbr, yl = text_spot.split()
    tid = ABBR2ID[abbr]
    yl = float(yl)
    # yard line yl measured from tid's own goal line, which it defends
    own_goal = 0 if attack_dir(tid, quarter) > 0 else 100
    return own_goal + yl if own_goal == 0 else 100 - yl


def find_spot(text, after_word, quarter):
    m = re.search(after_word + r"\s+((?:DEN|SEA) \d{1,2}|50)", text)
    return spot_x(m.group(1), quarter) if m else None


# --------------------------------------------------------------- players

ratings = json.load(open(os.path.join(HERE, "..", "data", "ratings.json")))["players"]


def depth_chart(team_id):
    d = load(f"depth_{team_id}.json")
    out = {}
    for item in d["items"]:
        for slot, v in item["positions"].items():
            ids = [ref_id(a["athlete"]["$ref"]) for a in sorted(v["athletes"], key=lambda a: a["slot"])]
            out.setdefault(slot, [])
            out[slot] += [i for i in ids if i in ratings and i not in out[slot]]
    return out


DEPTH = {tid: depth_chart(tid) for tid in TEAM}
ROSTER = {tid: [pid for pid, p in ratings.items() if p["team"] == TEAM[tid]["abbr"]] for tid in TEAM}


def grp(pid):
    return ratings[pid]["group"]


# Which lineup slots a player of each group may fill when he must be on field
SLOT_FAMILY = {
    "QB": ["QB"], "RB": ["RB", "WR3"], "FB": ["RB", "TE", "WR3"], "WR": ["WR3", "WR2", "WR1"], "TE": ["TE", "WR3"],
    "OT": ["LT", "RT"], "IOL": ["LG", "RG", "C"], "LS": ["C"],
    "EDGE": ["LEDGE", "REDGE", "LDT"], "IDL": ["LDT", "RDT"], "LB": ["MLB", "WLB"],
    "CB": ["NB", "RCB", "LCB"], "S": ["SS", "FS", "NB"], "K": [], "P": [],
}


def first(tid, slot, used, n=0):
    for pid in DEPTH[tid].get(slot, [])[n:]:
        if pid not in used:
            return pid
    return None


def offense_lineup(tid, must, heavy=False):
    """11 offensive players: 5 OL, QB, RB, TE, 3 WR (12 personnel if heavy)."""
    used, L = set(), {}

    def put(slot, pid):
        if pid:
            L[slot] = pid
            used.add(pid)

    for slot, key in (("LT", "lt"), ("LG", "lg"), ("C", "c"), ("RG", "rg"), ("RT", "rt"), ("QB", "qb"), ("RB", "rb"), ("TE", "te")):
        put(slot, first(tid, key, used))
    wrs = [p for p in DEPTH[tid].get("wr", []) if p not in used]
    for i, slot in enumerate(("WR1", "WR2", "WR3")):
        if i < len(wrs):
            put(slot, wrs[i])
    if heavy:
        put("WR3", first(tid, "te", used) or first(tid, "fb", used) or L.get("WR3"))
    fill_must(tid, L, must, used)
    return L


def defense_lineup(tid, must, goal_line=False):
    """Nickel by default (2 DL, 2 EDGE, 2 LB, 3 CB, 2 S); base 3-4 near goal."""
    used, L = set(), {}
    order = [("LEDGE", "wlb"), ("LDT", "lde"), ("RDT", "rde"), ("REDGE", "slb"), ("MLB", "lilb"), ("WLB", "rilb"),
             ("LCB", "lcb"), ("RCB", "rcb"), ("SS", "ss"), ("FS", "fs"), ("NB", "nb")]
    if goal_line:
        order[-1] = ("NB", "nt")  # nose tackle in, nickel out
    for slot, key in order:
        pid = first(tid, key, used)
        if pid:
            L[slot] = pid
            used.add(pid)
    fill_must(tid, L, must, used)
    return L


def fill_must(tid, L, must, used):
    """Force every player the play-by-play names onto the field."""
    for pid in must:
        if pid in used or pid not in ratings or ratings[pid]["team"] != TEAM[tid]["abbr"]:
            continue
        fam = SLOT_FAMILY.get(grp(pid), [])
        protected = {L.get(s) for s in ()} | set(must)
        slot = next((s for s in fam if L.get(s) not in protected), None)
        if slot is None:  # any slot whose occupant isn't also required
            slot = next((s for s in L if L[s] not in protected and s not in ("QB", "LT", "RT", "C")), None)
        if slot:
            used.discard(L.get(slot))
            L[slot] = pid
            used.add(pid)


ST_PRIORITY = ("LB", "S", "CB", "TE", "FB", "RB", "WR", "EDGE")


def special_unit(tid, core, must, size=11):
    """Kick coverage / return units: specialists + backups by ST priority."""
    starters_off = set(DEPTH[tid].get("qb", [])[:1] + sum((DEPTH[tid].get(k, [])[:1] for k in ("lt", "lg", "c", "rg", "rt")), []))
    chosen = [p for p in core if p] + [p for p in must if p in ROSTER[tid] and p not in core]
    pool = sorted((p for p in ROSTER[tid] if p not in chosen and p not in starters_off and grp(p) in ST_PRIORITY),
                  key=lambda p: (ST_PRIORITY.index(grp(p)), -ratings[p]["ratings"]["SPD"]))
    # starters are mostly rested on teams: use depth beyond slot 1 first
    starters = {ids[0] for k, ids in DEPTH[tid].items() if ids}
    pool.sort(key=lambda p: p in starters)
    for p in pool:
        if len(chosen) >= size:
            break
        chosen.append(p)
    return chosen[:size]


# ------------------------------------------------------------------ plays

core = {p["id"]: p for p in load("core_plays.json")["items"]}
nv = {}
with gzip.open(os.path.join(RAW, "pbp_2026.csv.gz"), "rt") as f:
    for r in csv.DictReader(f):
        if r["game_id"] == NV_GAME:
            nv[EVENT + r["play_id"]] = r

ADMIN = {"Official Timeout", "Timeout", "End Period", "Two-minute warning", "End of Half", "End of Regulation",
         "End of Game", "Coin Toss"}


def parts(cp):
    """{role: [espn ids]} in ESPN order."""
    out = {}
    for p in cp.get("participants", []):
        out.setdefault(p["type"], []).append(ref_id(p["athlete"]["$ref"]))
    return out


def location(text, nvrow, key):
    v = (nvrow or {}).get(key)
    if v:
        return v
    m = re.search(r"\b(left|middle|right)\b", text)
    return m.group(1) if m else "middle"


def build_play(i, dp, drive_idx, drive):
    cp = core.get(dp["id"], {})
    r = nv.get(dp["id"])
    text = dp.get("text", "")
    q = dp["period"]["number"]
    ptype = dp["type"]["text"]
    st = dp.get("start", {})
    off = (st.get("team") or {}).get("id") or drive["team"]["id"]
    deff = AWAY if off == HOME else HOME
    ytg = st.get("yardsToEndzone")
    P = parts(cp)
    play = {
        "id": dp["id"], "drive": drive_idx, "q": q, "clock": dp["clock"]["displayValue"], "type": ptype,
        "text": text, "off": off, "def": deff, "down": st.get("down"), "dist": st.get("distance"),
        "downText": st.get("shortDownDistanceText") or "", "posText": st.get("possessionText") or "",
        "score": [dp.get("awayScore", 0), dp.get("homeScore", 0)], "scoring": dp.get("scoringPlay", False),
        "dir": attack_dir(off, q), "homeWp": num((r or {}).get("home_wp")),
        "endText": (dp.get("end") or {}).get("downDistanceText"),
    }
    if ptype in ADMIN or ytg is None:
        play["kind"] = "admin"
        return play

    los = x_from_ytg(off, q, ytg)
    play["los"] = los
    d = play["dir"]
    ny = lambda k, dflt=0.0: num((r or {}).get(k), dflt)
    flag = (r or {}).get("penalty") == "1" or "PENALTY" in text
    no_play = "No Play" in text
    if flag:
        m = re.search(r"PENALTY on (\w+)-?([\w.' -]*?), ([^,]+), (\d+) yards", text)
        play["penalty"] = {"text": text[text.index("PENALTY"):], "team": m.group(1) if m else None,
                           "type": m.group(3) if m else (r or {}).get("penalty_type"),
                           "yards": int(m.group(4)) if m else None, "noPlay": no_play,
                           "player": (P.get("penalized") or [None])[0]}

    must_off, must_def = [], []

    def S(role):
        return P.get(role, [])

    nv_type = (r or {}).get("play_type")
    gained = ny("yards_gained")
    tacklers = S("tackler") + S("assistedBy")

    if ptype == "Kickoff" or nv_type == "kickoff":
        kd = ny("kick_distance", 65)
        returner = (S("returner") or [None])[0]
        land = los + d * kd
        catch_x = find_spot(text, r"kicks \d+ yards from \w+ \d+ to", q)
        if catch_x is not None:
            land = catch_x
        end = find_spot(text, r"(?:to|at)", q) if returner else None
        m = re.search(r"(?:ob at|to) ((?:DEN|SEA) \d{1,2}|50) for", text)
        end = spot_x(m.group(1), q) if m else None
        tb = (r or {}).get("touchback") == "1" or "Touchback" in text
        play.update(kind="kickoff", kicker=(S("kicker") or [None])[0], returner=returner, land=land,
                    touchback=tb, oob="out of bounds" in text and not returner,
                    end=(los + d * 65 if tb else end if end is not None else land),
                    tacklers=tacklers, retOob="ob at" in text,
                    fumble=bool(S("fumbler")), forcedBy=(S("forcedBy") or [None])[0])
        kick_team, ret_team = off, deff
        play["units"] = {
            kick_team: special_unit(kick_team, [play["kicker"]], tacklers + S("forcedBy")),
            ret_team: special_unit(ret_team, [returner], S("fumbler")),
        }
        return play

    if ptype == "Punt" or nv_type == "punt":
        kd = ny("kick_distance", 45)
        returner = (S("returner") or [None])[0]
        land = los + d * kd
        m = re.search(r"punts \d+ yards to ((?:DEN|SEA) \d{1,2}|50)", text)
        if m:
            land = spot_x(m.group(1), q)
        m = re.search(r"(?:ob at|to) ((?:DEN|SEA) \d{1,2}|50) for", text)
        end = spot_x(m.group(1), q) if m else land
        punter = (S("punter") or [None])[0]
        play.update(kind="punt", punter=punter, returner=returner, land=land, end=end,
                    fairCatch="fair catch" in text, oob="out of bounds" in text, downed="downed" in text,
                    touchback="Touchback" in text, tacklers=tacklers, retOob="ob at" in text)
        ls = (DEPTH[off].get("ls") or [None])[0]
        play["units"] = {
            off: special_unit(off, [punter, ls], tacklers),
            deff: special_unit(deff, [returner] + (DEPTH[deff].get("pr") or [])[:0], []),
        }
        play["longSnapper"] = ls
        return play

    if ptype.startswith("Field Goal") or nv_type in ("field_goal", "extra_point") or "Extra Point" in ptype:
        is_xp = nv_type == "extra_point" or "extra point" in text.lower()
        dist = ny("kick_distance") or (int(re.search(r"(\d+) yard", text).group(1)) if re.search(r"(\d+) yard", text) else 33)
        good = "GOOD" in text.upper() and "NO GOOD" not in text.upper()
        miss = None
        for k in ("wide left", "wide right", "short", "blocked"):
            if k in text.lower():
                miss = k
        holder = (S("holder") or DEPTH[off].get("h") or [None])[0]
        play.update(kind="xp" if is_xp else "fg", kicker=(S("kicker") or [None])[0], holder=holder,
                    snapper=(S("snapper") or DEPTH[off].get("ls") or [None])[0], distance=dist, good=good, miss=miss,
                    spotX=los - d * 7)
        ol = [first(off, k, set()) for k in ("lt", "lg", "c", "rg", "rt")]
        play["units"] = {
            off: [play["kicker"], holder, play["snapper"]] + [p for p in ol if p and p != play["snapper"]][:4]
            + special_unit(off, [], [], 4),
            deff: list(defense_lineup(deff, [], goal_line=True).values()),
        }
        play["units"][off] = list(dict.fromkeys(p for p in play["units"][off] if p))[:11]
        return play

    # ------------------------------------------------ scrimmage plays
    passer = (S("passer") or [None])[0]
    rusher = (S("rusher") or [None])[0]
    receiver = (S("receiver") or [None])[0]
    must_off = [p for p in (passer, rusher, receiver, *S("fumbler"), play.get("penalty", {}).get("player")) if p]
    must_def = tacklers + S("sackedBy") + S("passDefender") + S("forcedBy") + S("recoverer") + S("returner") + S("other")
    goal_line = ytg <= 3
    shotgun = "Shotgun" in text or (r or {}).get("shotgun") == "1"
    play.update(shotgun=shotgun, noHuddle="No Huddle" in text, tacklers=tacklers)

    if ptype == "Penalty" and (no_play and not (passer or rusher)):
        play["kind"] = "presnap"
    elif "kneel" in text.lower() or nv_type == "qb_kneel":
        play.update(kind="kneel", qb=passer or rusher, gain=gained)
    elif "spike" in text.lower():
        play.update(kind="spike", qb=passer)
    elif ptype == "Sack" or (r or {}).get("sack") == "1":
        play.update(kind="sack", qb=passer, sackers=S("sackedBy"), gain=gained if r else
                    num(re.search(r"for (-?\d+) yards", text).group(1), 0), oob="sacked ob" in text)
    elif (r or {}).get("qb_scramble") == "1" or (rusher and passer is None and rusher == (DEPTH[off].get("qb") or [None])[0]
                                                     and "scramble" in text.lower()):
        play.update(kind="scramble", carrier=rusher, gain=gained, oob="ob at" in text or "pushed ob" in text,
                    loc=location(text, r, "run_location"))
    elif rusher:
        play.update(kind="run", carrier=rusher, gain=gained if r and not no_play else
                    num((re.search(r"for (-?\d+) yards", text) or [None, 0])[1] if re.search(r"for (-?\d+) yards", text) else 0, 0),
                    loc=location(text, r, "run_location"), gap=(r or {}).get("run_gap") or
                    ("end" if " end " in text else "tackle" if "tackle" in text else "guard" if "guard" in text else "middle"),
                    oob="ob at" in text or "pushed ob" in text, td="TOUCHDOWN" in text)
    elif passer:
        loc = location(text, r, "pass_location")
        deep = "deep" in text
        air = ny("air_yards", None)
        if air is None:
            air = 22.0 if deep else 6.0
        base = dict(qb=passer, target=receiver, loc=loc, air=air)
        if "INTERCEPTED" in text:
            ix = find_spot(text, r"INTERCEPTED by [\w.'\- ]+? at", q)
            interceptor = (S("returner") or S("passDefender") or [None])[0]
            m = re.search(r"(?:ob at|to) ((?:DEN|SEA) \d{1,2}|50) for", text)
            play.update(kind="int", **base, interceptor=interceptor, catchX=ix,
                        end=spot_x(m.group(1), q) if m else ix, retOob="ob at" in text)
        elif "incomplete" in text:
            play.update(kind="incomplete", **base, defender=(S("passDefender") or [None])[0],
                        thrownAway=receiver is None)
        else:
            yac = ny("yards_after_catch", None)
            g = gained
            if no_play or r is None:
                m = re.search(r"for (-?\d+) yards", text)
                g = num(m.group(1), 0) if m else 0
            if yac is None:
                yac = max(0.0, g - air)
            play.update(kind="complete", **base, gain=g, yac=yac, oob="ob at" in text or "pushed ob" in text,
                        td="TOUCHDOWN" in text)
    else:
        play["kind"] = "presnap" if flag else "admin"

    if "fumble" in text.lower() and S("fumbler"):
        play["fumble"] = {"by": S("fumbler")[0], "forcedBy": (S("forcedBy") or [None])[0],
                          "recoveredBy": (S("recoverer") or [None])[0],
                          "lost": (r or {}).get("fumble_lost") == "1" or "RECOVERED by " + TEAM[deff]["abbr"] in text}

    heavy = goal_line or "Run formation" in text or ("Jumbo" in text)
    play["lineup"] = {off: offense_lineup(off, must_off, heavy=heavy),
                      deff: defense_lineup(deff, must_def, goal_line=goal_line)}
    return play


plays, drives = [], []
for di, drive in enumerate(summary["drives"]["previous"]):
    dteam = drive["team"]["id"] if "id" in drive["team"] else ABBR2ID[drive["team"]["abbreviation"]]
    drive["team"]["id"] = dteam
    drives.append({"idx": di, "team": dteam, "desc": drive.get("description"), "result": drive.get("displayResult") or drive.get("result"),
                   "start": (drive.get("start") or {}).get("text"), "end": (drive.get("end") or {}).get("text"),
                   "q": (drive.get("start") or {}).get("period", {}).get("number"), "first": len(plays)})
    for dp in drive["plays"]:
        pl_ = build_play(len(plays), dp, di, drive)
        plays.append(pl_)
        m = re.search(r"([\w.'-]+) extra point is (GOOD|No Good)", dp.get("text", ""), re.I)
        if m and pl_.get("los") is not None:
            # ESPN folds the PAT into the touchdown row; give it its own snap
            off_ = pl_["off"]
            q_ = pl_["q"]
            k = (DEPTH[off_].get("pk") or [None])[0]
            ol = [first(off_, kk, set()) for kk in ("lt", "lg", "c", "rg", "rt")]
            hold = (DEPTH[off_].get("h") or [None])[0]
            ls = (DEPTH[off_].get("ls") or [None])[0]
            unit = list(dict.fromkeys(x for x in [k, hold, ls] + ol + special_unit(off_, [], [], 6) if x))[:11]
            plays.append({
                "id": dp["id"] + "x", "drive": di, "q": q_, "clock": pl_["clock"], "type": "Extra Point",
                "text": m.group(0) + ".", "off": off_, "def": pl_["def"], "down": 0, "dist": 0, "downText": "PAT",
                "posText": "", "score": pl_["score"], "scoring": True, "dir": pl_["dir"], "homeWp": pl_["homeWp"],
                "los": x_from_ytg(off_, q_, 15), "kind": "xp", "kicker": k, "holder": hold, "snapper": ls,
                "distance": 33, "good": m.group(2).upper() == "GOOD", "miss": None,
                "units": {off_: unit, pl_["def"]: list(defense_lineup(pl_["def"], [], goal_line=True).values())},
            })
    drives[-1]["last"] = len(plays) - 1


def slim(p):
    keep = ("id", "team", "name", "short", "jersey", "pos", "group", "height_in", "weight_lb", "age", "experience",
            "college", "headshot", "ovr", "ratings", "physics", "measurables", "imputed_drills", "t10", "draft_round",
            "draft_pick", "confidence")
    return {k: p.get(k) for k in keep}


on_field = set()
for p in plays:
    for side in (p.get("lineup") or {}).values():
        on_field |= set(side.values())
    for side in (p.get("units") or {}).values():
        on_field |= set(x for x in side if x)

game = {
    "event": EVENT, "date": comp.get("date"), "venue": summary.get("gameInfo", {}).get("venue", {}).get("fullName"),
    "home": HOME, "away": AWAY, "teams": TEAM,
    "players": {pid: slim(ratings[pid]) for pid in sorted(on_field | set(ratings))},
    "drives": drives, "plays": plays,
    "sources": {
        "espn_summary": f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={EVENT}",
        "espn_plays": f"https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{EVENT}/competitions/{EVENT}/plays",
        "nflverse": "https://github.com/nflverse/nflverse-data",
    },
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(game, f, separators=(",", ":"))

from collections import Counter
print(f"wrote {OUT}: {len(plays)} plays, {len(drives)} drives, {len(game['players'])} players")
print(Counter(p["kind"] for p in plays))
bad = [p for p in plays if p["kind"] not in ("admin", "presnap") and p.get("lineup") and any(len(v) != 11 for v in p["lineup"].values())]
print("plays with != 11 per side:", len(bad))
