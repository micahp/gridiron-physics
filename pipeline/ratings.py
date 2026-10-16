"""GridIron player rating engine.

Produces Madden-style 0-99 attribute ratings *and* the physical parameters the
physics engine consumes (mass, top speed, acceleration time constant, drive
force, lateral acceleration, reach), for every player on both rosters.

Pipeline (each step documented in docs/RATINGS.md, with sources):

1. Identity     ESPN athlete id -> nflverse players.csv -> GSIS id (stats) and
                PFR id (combine), plus draft slot.
2. Measurables  NFL Combine drills. Missing drills are imputed from a
                position-group regression on height and weight fitted on every
                combine since 2000 (~9k athletes), so a player who skipped the
                bench still gets a realistic, body-type-consistent estimate.
3. Physics      40-yd time -> (v_max, tau) using the mono-exponential sprint
                model v(t) = v_max (1 - e^(-t/tau)) of Samozino et al. (2016),
                as applied to Combine 40s by Clark et al. (2019). F0 = m v_max/tau.
4. Physical     SPD / ACC / AGI / STR / JMP from the drills (SPD mapping
   ratings      calibrated to the community-measured Madden 40->SPD curve).
5. Skill        Production rates from 2025 + 2026 weeks before kickoff, shrunk
   ratings      toward the position mean (empirical Bayes, k = pseudo-sample),
                z-scored within position league-wide, blended with a
                draft-capital prior weighted by sample size.
6. OVR          Position-specific weighted average of attributes, the way
                Madden builds OVR from position formulas.

No game data from the reconstructed game itself is used (weeks < GAME_WEEK).

Usage: python3 pipeline/ratings.py   -> data/ratings.json
"""
import csv
import gzip
import json
import math
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "data", "raw")
OUT = os.path.join(HERE, "..", "data", "ratings.json")
TEAMS = ("DEN", "SEA")
SEASON, PREV, GAME_WEEK = 2026, 2025, 6

G = 9.81
YD = 0.9144
LB = 0.453592
IN = 0.0254
FORTY_M = 40 * YD

# ---------------------------------------------------------------- utilities


def clamp(x, lo=0.0, hi=99.0):
    return max(lo, min(hi, x))


def num(s):
    try:
        v = float(s)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def interp(x, table):
    """Piecewise-linear lookup; table is [(x, y), ...] sorted by x."""
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


def height_in(s):
    """'6-4' -> 76, '76' -> 76."""
    if not s:
        return None
    if "-" in s:
        f, i = s.split("-")
        return int(f) * 12 + int(i)
    return num(s)


def solve3(A, b):
    """Gaussian elimination for the 3x3 normal equations."""
    M = [row[:] + [bb] for row, bb in zip(A, b)]
    for c in range(3):
        p = max(range(c, 3), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            return None
        for r in range(3):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, 4):
                    M[r][k] -= f * M[c][k]
    return [M[i][3] / M[i][i] for i in range(3)]


# --------------------------------------------------------- position groups

# Group used for combine regressions, stat z-scores and OVR formulas.
GROUP = {
    "QB": "QB", "RB": "RB", "HB": "RB", "FB": "FB", "WR": "WR", "TE": "TE",
    "OT": "OT", "T": "OT", "G": "IOL", "OG": "IOL", "C": "IOL", "OL": "IOL",
    "DE": "EDGE", "EDGE": "EDGE", "OLB": "EDGE", "DT": "IDL", "NT": "IDL", "DL": "IDL",
    "LB": "LB", "ILB": "LB", "MLB": "LB", "CB": "CB", "CB/WR": "CB", "DB": "CB",
    "S": "S", "SAF": "S", "FS": "S", "SS": "S", "K": "K", "PK": "K", "P": "P", "LS": "LS",
}


def group_of(pos, weight=None, rush_rate=None):
    g = GROUP.get(pos, "LB")
    # ESPN lists 3-4 outside rushers as "LB". Call them EDGE when they rush the
    # passer like one (sacks + ½ QB hits per game), else when built like one.
    if pos in ("LB", "OLB"):
        if rush_rate is not None:
            return "EDGE" if rush_rate >= 0.3 and (weight or 0) >= 240 else "LB"
        if weight and weight >= 248:
            return "EDGE"
    return g


# ------------------------------------------------- step 2: combine priors

DRILLS = ("forty", "bench", "vertical", "broad_jump", "cone", "shuttle")


class CombineModel:
    """drill ~ a + b*weight + c*height, per position group, with residual SD."""

    def __init__(self, rows):
        self.coef, self.sd = {}, {}
        by = defaultdict(list)
        for r in rows:
            g = group_of(r["pos"], num(r["wt"]))
            h, w = height_in(r["ht"]), num(r["wt"])
            if h and w:
                by[g].append((w, h, r))
        for g, items in by.items():
            for d in DRILLS:
                pts = [(w, h, num(r[d])) for w, h, r in items if num(r[d]) is not None]
                if len(pts) < 25:
                    continue
                A = [[0.0] * 3 for _ in range(3)]
                b = [0.0] * 3
                for w, h, y in pts:
                    x = (1.0, w, h)
                    for i in range(3):
                        b[i] += x[i] * y
                        for j in range(3):
                            A[i][j] += x[i] * x[j]
                c = solve3(A, b)
                if not c:
                    continue
                res = [y - (c[0] + c[1] * w + c[2] * h) for w, h, y in pts]
                self.coef[(g, d)] = c
                self.sd[(g, d)] = math.sqrt(sum(e * e for e in res) / (len(res) - 3))
        # League-wide distributions for z-scoring (all positions pooled)
        self.pool = {}
        for d in DRILLS:
            v = [num(r[d]) for r in rows if num(r[d]) is not None]
            m = sum(v) / len(v)
            self.pool[d] = (m, math.sqrt(sum((x - m) ** 2 for x in v) / len(v)))

    def predict(self, g, d, w, h):
        c = self.coef.get((g, d)) or self.coef.get(("LB", d))
        return c[0] + c[1] * w + c[2] * h

    def z_resid(self, g, d, val, w, h):
        """How much better than expected for this body type (+ = better)."""
        sd = self.sd.get((g, d)) or self.sd.get(("LB", d))
        z = (val - self.predict(g, d, w, h)) / sd
        return -z if d in ("forty", "cone", "shuttle") else z


# ------------------------------------------------- step 3: sprint physics


def forty_time(vmax, tau):
    """Time to cover 40 yd under v(t) = vmax(1-e^(-t/tau))."""
    lo, hi = 0.5, 12.0
    for _ in range(60):
        t = (lo + hi) / 2
        d = vmax * (t - tau * (1 - math.exp(-t / tau)))
        lo, hi = (t, hi) if d < FORTY_M else (lo, t)
    return (lo + hi) / 2


def sprint_profile(forty, mass_kg, broad_z):
    """Return (vmax m/s, tau s, F0 N, t10 s) consistent with the 40 time.

    tau (acceleration time constant) is set from body mass and lower-body
    power (broad-jump residual): heavier athletes accelerate relatively slower,
    explosive ones faster. Clark et al. (2019) found Combine athletes share a
    near-identical acceleration pattern relative to their own v_max, so tau
    varies only modestly (≈0.80–1.15 s). v_max is then solved so the model
    reproduces the measured 40 exactly.
    """
    tau = 0.86 + 0.0021 * (mass_kg - 90) - 0.035 * broad_z
    tau = max(0.75, min(1.2, tau))
    lo, hi = 4.0, 14.0
    for _ in range(60):
        v = (lo + hi) / 2
        lo, hi = (v, hi) if forty_time(v, tau) > forty else (lo, v)
    vmax = (lo + hi) / 2
    # time to 10 yd
    lo2, hi2 = 0.2, 4.0
    for _ in range(60):
        t = (lo2 + hi2) / 2
        d = vmax * (t - tau * (1 - math.exp(-t / tau)))
        lo2, hi2 = (t, hi2) if d < 10 * YD else (lo2, t)
    return vmax, tau, mass_kg * vmax / tau, (lo2 + hi2) / 2


# ---------------------------------------- step 4: physical rating curves

# Community-measured Madden 40 -> SPD relationship (Madden School testing:
# e.g. a 4.51 maps to 87-91, most often 88-89). Exact EA formula is private.
SPD_CURVE = [(4.22, 99), (4.30, 97), (4.35, 95), (4.40, 93), (4.45, 91), (4.50, 89),
             (4.55, 87), (4.60, 85), (4.70, 81), (4.80, 77), (4.90, 73), (5.00, 69),
             (5.10, 65), (5.20, 61), (5.30, 57), (5.40, 53), (5.60, 45)]
# Madden's analysts use the 10-yd split for ACC (CBS SF, 2014 interview).
ACC_CURVE = [(1.45, 99), (1.50, 95), (1.55, 90), (1.60, 85), (1.65, 80), (1.70, 75),
             (1.75, 70), (1.80, 65), (1.85, 60), (1.95, 52)]
JMP_CURVE = [(24, 45), (28, 58), (31, 68), (34, 77), (37, 85), (40, 92), (43, 98)]


def age_speed_penalty(age):
    """Top speed erodes with age; ~1 SPD point per year past 28."""
    return max(0, age - 28) * 1.0


# ---------------------------------------- step 5: production-based skills

# Each metric: (name, numerator fn, denominator fn, k pseudo-count, sign)
# Rates are shrunk toward position mean: (x + k*mu) / (n + k).


def g(r, k):
    return num(r.get(k)) or 0.0


METRICS = {
    "QB": [
        ("cpoe", lambda r: g(r, "passing_cpoe") * g(r, "attempts"), lambda r: g(r, "attempts"), 150, 1),
        ("ypa", lambda r: g(r, "passing_yards"), lambda r: g(r, "attempts"), 150, 1),
        ("air", lambda r: g(r, "passing_air_yards"), lambda r: g(r, "attempts"), 150, 1),
        ("deep", lambda r: g(r, "passing_20"), lambda r: g(r, "completions"), 120, 1),
        ("int", lambda r: g(r, "passing_interceptions"), lambda r: g(r, "attempts"), 250, -1),
        ("sack", lambda r: g(r, "sacks_suffered"), lambda r: g(r, "attempts") + g(r, "sacks_suffered"), 200, -1),
        ("epa", lambda r: g(r, "passing_epa"), lambda r: g(r, "attempts") + g(r, "sacks_suffered"), 200, 1),
        ("rush", lambda r: g(r, "rushing_yards"), lambda r: g(r, "games"), 6, 1),
    ],
    "RB": [
        ("ypc", lambda r: g(r, "rushing_yards"), lambda r: g(r, "carries"), 60, 1),
        ("explosive", lambda r: g(r, "rushing_10"), lambda r: g(r, "carries"), 60, 1),
        ("repa", lambda r: g(r, "rushing_epa"), lambda r: g(r, "carries"), 80, 1),
        ("fd", lambda r: g(r, "rushing_first_downs"), lambda r: g(r, "carries"), 60, 1),
        ("fum", lambda r: g(r, "rushing_fumbles"), lambda r: g(r, "carries") + g(r, "receptions"), 150, -1),
        ("catch", lambda r: g(r, "receptions"), lambda r: g(r, "targets"), 25, 1),
        ("yac", lambda r: g(r, "receiving_yards_after_catch"), lambda r: g(r, "receptions"), 20, 1),
    ],
    "REC": [  # WR + TE
        ("catch_oe", lambda r: g(r, "receptions") - g(r, "targets") * max(0.45, 0.80 - 0.012 * (g(r, "receiving_air_yards") / max(1, g(r, "targets")))),
         lambda r: g(r, "targets"), 30, 1),
        ("ypt", lambda r: g(r, "receiving_yards"), lambda r: g(r, "targets"), 30, 1),
        ("share", lambda r: g(r, "target_share") * g(r, "games"), lambda r: g(r, "games"), 4, 1),
        ("fd", lambda r: g(r, "receiving_first_downs"), lambda r: g(r, "targets"), 30, 1),
        ("yac", lambda r: g(r, "receiving_yards_after_catch"), lambda r: g(r, "receptions"), 20, 1),
        ("deep", lambda r: g(r, "receiving_20"), lambda r: g(r, "receptions"), 25, 1),
        ("fum", lambda r: g(r, "receiving_fumbles"), lambda r: g(r, "receptions"), 100, -1),
    ],
    "DEF": [
        ("tkl", lambda r: g(r, "def_tackles_solo") + 0.5 * g(r, "def_tackle_assists"), lambda r: g(r, "games"), 5, 1),
        ("tfl", lambda r: g(r, "def_tackles_for_loss"), lambda r: g(r, "games"), 6, 1),
        ("rush", lambda r: g(r, "def_sacks") + 0.5 * g(r, "def_qb_hits"), lambda r: g(r, "games"), 6, 1),
        ("cov", lambda r: g(r, "def_pass_defended") + 2 * g(r, "def_interceptions"), lambda r: g(r, "games"), 6, 1),
        ("ff", lambda r: g(r, "def_fumbles_forced"), lambda r: g(r, "games"), 10, 1),
    ],
    "USE": [  # playing-time share: the depth chart is a coach's rating
        ("vol", lambda r: g(r, "attempts") + g(r, "carries") + g(r, "targets") + 2 * (g(r, "def_tackles_solo") + g(r, "def_tackle_assists") + g(r, "def_pass_defended")),
         lambda r: g(r, "games"), 4, 1),
    ],
    "K": [
        ("fg", lambda r: g(r, "fg_made"), lambda r: g(r, "fg_att"), 15, 1),
        ("long", lambda r: g(r, "fg_made_50_59") + 1.5 * g(r, "fg_made_60_"), lambda r: g(r, "games"), 8, 1),
        ("pat", lambda r: g(r, "pat_made"), lambda r: g(r, "pat_att"), 20, 1),
    ],
    "P": [
        ("gross", lambda r: g(r, "pt_yards"), lambda r: g(r, "pt_att"), 20, 1),
        ("in20", lambda r: g(r, "pt_inside_20"), lambda r: g(r, "pt_att"), 20, 1),
        ("net", lambda r: g(r, "pt_net_yards"), lambda r: g(r, "pt_att"), 20, 1),
    ],
}


def metric_family(group):
    if group in ("WR", "TE"):
        return "REC"
    if group in ("RB", "FB"):
        return "RB"
    if group in ("EDGE", "IDL", "LB", "CB", "S"):
        return "DEF"
    return group if group in METRICS else None


def load_stats():
    """Sum counting stats per GSIS id: full 2025 + 2026 weeks before the game.

    2026 is up-weighted (1.5x) so current form counts more than last year."""
    agg = defaultdict(lambda: defaultdict(float))
    meta = {}

    def add(r, w):
        a = agg[r["player_id"]]
        for k, v in r.items():
            x = num(v)
            if x is not None and k not in ("season", "week"):
                if k in ("passing_cpoe", "target_share", "fg_pct", "pat_pct", "pacr", "racr", "wopr", "air_yards_share"):
                    continue
                a[k] += w * x
        # rate-type columns re-weighted by volume
        a["passing_cpoe"] += w * (num(r.get("passing_cpoe")) or 0) * (num(r.get("attempts")) or 0)
        a["_cpoe_att"] += w * (num(r.get("attempts")) or 0) if num(r.get("passing_cpoe")) is not None else 0
        a["target_share"] += w * (num(r.get("target_share")) or 0) * (1 if "week" in r else (num(r.get("games")) or 0))
        a["_ts_games"] += w * (1 if "week" in r else (num(r.get("games")) or 0))
        meta[r["player_id"]] = r.get("position") or meta.get(r["player_id"])

    for r in csv.DictReader(open(os.path.join(RAW, f"stats_player_reg_{PREV}.csv"))):
        add(r, 1.0)
    for r in csv.DictReader(open(os.path.join(RAW, f"stats_player_week_{SEASON}.csv"))):
        if int(r["week"]) < GAME_WEEK and r["season_type"] == "REG":
            r = dict(r)
            r["games"] = "1"
            add(r, 1.5)
    out = {}
    for pid, a in agg.items():
        d = dict(a)
        d["passing_cpoe"] = d["passing_cpoe"] / d["_cpoe_att"] if d.get("_cpoe_att") else 0.0
        d["target_share"] = d["target_share"] / d["_ts_games"] if d.get("_ts_games") else 0.0
        out[pid] = d
    return out, meta


class SkillModel:
    """Shrunk, position-normalised production z-scores."""

    def __init__(self, stats, pos_of):
        self.stats = stats
        self.mu, self.sd = {}, {}
        fam_players = defaultdict(list)
        for pid, s in stats.items():
            fam = metric_family(group_of(pos_of.get(pid) or ""))
            if fam:
                fam_players[fam].append(s)
        for pid, s in stats.items():
            grp = group_of(pos_of.get(pid) or "")
            if grp not in ("OT", "IOL", "K", "P", "LS"):
                fam_players["USE:" + grp].append(s)
        for fam, rows in fam_players.items():
            if fam.startswith("USE:"):
                fam, key = "USE", fam
            else:
                key = fam
            for name, nf, df, k, sign in METRICS[fam]:
                pairs = [(nf(r), df(r)) for r in rows if df(r) > 0]
                if not pairs:
                    continue
                mu = sum(n for n, _ in pairs) / sum(d for _, d in pairs)
                # SD of shrunk rates among players with real volume
                shr = [(n + k * mu) / (d + k) for n, d in pairs if d >= k]
                m2 = sum(shr) / len(shr) if shr else mu
                sd = math.sqrt(sum((x - m2) ** 2 for x in shr) / len(shr)) if len(shr) > 3 else 1
                self.mu[(key, name)] = mu
                self.sd[(key, name)] = sd or 1

    def z(self, gsis, fam):
        """{metric: (z, volume, k)} for this player."""
        s = self.stats.get(gsis)
        out = {}
        if not s or fam.split(":")[0] not in METRICS:
            return out
        key = fam
        if fam.startswith("USE:"):
            key, fam = fam, "USE"
        for name, nf, df, k, sign in METRICS[fam]:
            if (key, name) not in self.mu:
                continue
            n, d = nf(s), df(s)
            mu, sd = self.mu[(key, name)], self.sd[(key, name)]
            rate = (n + k * mu) / (d + k) if d > -k else mu
            out[name] = (sign * (rate - mu) / sd, d, k)
        return out


def draft_prior_z(pick, rnd):
    """Draft capital as a talent prior: #1 overall ≈ +1.2σ, UDFA ≈ -0.9σ."""
    if pick:
        return 1.2 - 0.0078 * pick
    if rnd:
        return 1.2 - 0.0078 * (rnd * 32 - 16)
    return -0.9


def to_rating(z, base=70, scale=11):
    return round(clamp(base + scale * z, 25, 99))


def blend(zs, weights, prior, conf_k=1.0):
    """Weighted production z blended toward the draft prior by evidence."""
    num_, den, ev = 0.0, 0.0, 0.0
    for name, w in weights.items():
        if name in zs:
            z, n, k = zs[name]
            num_ += w * z
            den += w
            ev += w * n / (n + k)
    if den == 0:
        return prior, 0.0
    zprod = num_ / den
    conf = ev / sum(weights.values())  # 0..1, how much real evidence
    conf = min(1.0, conf * conf_k)
    return conf * zprod + (1 - conf) * prior * 0.6, conf


# ---------------------------------------------------- step 6: OVR formulas

OVR_WEIGHTS = {
    "QB": {"THP": 3, "THA": 5, "AWR": 4, "SPD": 0.6, "AGI": 0.4, "BCV": 0.4},
    "RB": {"AWR": 1.5, "SPD": 1.8, "ACC": 2, "AGI": 1.5, "BCV": 2, "ELU": 2, "BTK": 1.5, "TRK": 1, "CAR": 1.5, "CTH": 0.8, "STR": 0.5},
    "FB": {"RBK": 3, "STR": 2, "IBL": 2, "CAR": 1, "CTH": 1, "SPD": 0.5, "AWR": 1},
    "WR": {"AWR": 1.5, "SPD": 2.2, "ACC": 1.5, "AGI": 1, "CTH": 3, "RTE": 3, "CIT": 1.5, "SPC": 1, "JMP": 0.6, "ELU": 0.6},
    "TE": {"CTH": 2.5, "RTE": 1.5, "CIT": 1.5, "RBK": 2.5, "PBK": 1, "STR": 1.2, "SPD": 1.2, "AWR": 1},
    "OT": {"PBK": 4.5, "RBK": 3, "STR": 2.5, "AWR": 2, "IBL": 1.5, "AGI": 0.5, "ACC": 0.5},
    "IOL": {"RBK": 4, "PBK": 3.5, "STR": 3, "AWR": 2, "IBL": 1.5, "ACC": 0.3},
    "EDGE": {"AWR": 1, "PMV": 2.5, "FMV": 2.5, "BSH": 2, "ACC": 2, "SPD": 1.2, "STR": 1.5, "TAK": 1, "PUR": 1, "PRC": 0.8},
    "IDL": {"BSH": 3, "STR": 3, "PMV": 2.5, "FMV": 1, "TAK": 1, "PUR": 0.8, "ACC": 1, "PRC": 1},
    "LB": {"AWR": 1.2, "TAK": 3, "PUR": 2.5, "PRC": 2.5, "BSH": 1.5, "ZCV": 1.5, "SPD": 1.5, "ACC": 1, "POW": 1, "MCV": 0.5},
    "CB": {"AWR": 1.5, "MCV": 3, "ZCV": 2.5, "SPD": 3, "ACC": 1.5, "AGI": 1.5, "PRC": 1.5, "PRS": 1, "TAK": 0.6, "JMP": 0.5},
    "S": {"AWR": 1.2, "ZCV": 3, "MCV": 1.5, "SPD": 2, "PRC": 2.5, "TAK": 2, "PUR": 1.5, "POW": 1, "ACC": 1},
    "K": {"KPW": 5, "KAC": 6},
    "P": {"KPW": 5, "KAC": 5},
    "LS": {"AWR": 3, "STR": 1, "RBK": 1},
}


def overall_raw(group, a):
    w = OVR_WEIGHTS[group]
    return sum(a[k] * v for k, v in w.items()) / sum(w.values())


# Madden's OVR distribution is roughly percentile-shaped within a position:
# a median rostered player is ~70, a top-10% player high 80s, the best 99.
OVR_BY_PCTL = [(0.0, 48), (0.10, 58), (0.25, 65), (0.50, 72), (0.75, 79), (0.90, 86),
               (0.97, 92), (0.995, 97), (1.0, 99)]


class OvrCalibration:
    """Percentile of a raw position score among every active NFL player."""

    def __init__(self, league):
        self.by = defaultdict(list)
        for g, raw in league:
            self.by[g].append(raw)
        for v in self.by.values():
            v.sort()

    def __call__(self, group, raw):
        v = self.by.get(group) or [raw]
        if len(v) < 20:  # tiny pools (FB, LS): linear around the pool median
            return round(clamp(72 + 1.2 * (raw - v[len(v) // 2]), 45, 95))
        below = sum(1 for x in v if x < raw) + 0.5 * sum(1 for x in v if x == raw)
        return round(interp(below / len(v), OVR_BY_PCTL))


# ------------------------------------------------------------------ main


def physical_profile(p, cm):
    """Combine measurables (actual or imputed) -> physics + physical ratings."""
    grp, w, h = p["group"], p["weight_lb"], p["height_in"]
    drills, imputed = {}, []
    for d in DRILLS:
        v = p["combine"].get(d)
        if v is None:
            v = cm.predict(grp, d, w, h)
            imputed.append(d)
        drills[d] = v
    z = {d: cm.z_resid(grp, d, drills[d], w, h) for d in DRILLS}
    mass = w * LB
    vmax, tau, f0, t10 = sprint_profile(drills["forty"], mass, z["broad_jump"])
    age = p.get("age") or 26
    # Aging: lose ~0.6% top speed per year after 28 (applied to the sim too)
    age_f = 1 - 0.006 * max(0, age - 28)

    spd = interp(drills["forty"], [(a, -b) for a, b in SPD_CURVE])
    spd = -spd - age_speed_penalty(age) - (2 if grp == "QB" else 0)
    acc = interp(t10, ACC_CURVE) - 0.6 * max(0, age - 29)
    # Agility: 3-cone + shuttle, absolute (all-position pool) not body-relative
    cone_m, cone_s = cm.pool["cone"]
    sh_m, sh_s = cm.pool["shuttle"]
    agi_z = -0.5 * ((drills["cone"] - cone_m) / cone_s + (drills["shuttle"] - sh_m) / sh_s)
    agi = 72 + 11 * agi_z - 0.5 * max(0, age - 29)
    # Strength: absolute bench reps + mass (a 330-lb lineman out-pushes anyone)
    b_m, b_s = cm.pool["bench"]
    str_ = 58 + 9 * (drills["bench"] - b_m) / b_s + 0.11 * (w - 230)
    jmp = interp(drills["vertical"], JMP_CURVE)

    # ---- physics parameters consumed by engine/
    mu_turf = 0.95  # cleat-turf traction coefficient (shoe/surface studies ~0.9-1.2)
    phys = {
        "mass": round(mass, 1),
        "height": round(h * IN, 3),
        # torso half-width for collision circle: ~0.25 m (DB) to ~0.36 m (OL)
        "radius": round(0.22 + 0.00042 * w, 3),
        "vmax": round(vmax * 0.96 * age_f, 3),  # "game speed with pads on"
        "tau": round(tau, 3),
        "f0": round(f0, 0),
        # drive force when engaged (block/tackle): traction-limited & strength-scaled
        "drive": round(mass * G * mu_turf * (0.55 + 0.35 * clamp(str_) / 99), 0),
        # lateral accel capacity (cutting): from agility drills
        "alat": round(max(4.5, 7.2 + 1.1 * agi_z), 2),
        # max hand height when leaping (standing reach ≈ 1.33 × height)
        "reach": round(1.33 * h * IN + drills["vertical"] * IN * 0.85, 3),
    }
    phys_ratings = {"SPD": round(clamp(spd)), "ACC": round(clamp(acc)), "AGI": round(clamp(agi)),
                    "STR": round(clamp(str_)), "JMP": round(clamp(jmp))}
    meas = {d: (round(v, 2) if d in ("forty", "cone", "shuttle") else round(v, 1)) for d, v in drills.items()}
    return phys, phys_ratings, meas, imputed, z, t10


def skill_ratings(p, sm, phys_r, dz):
    """All non-physical attributes."""
    grp = p["group"]
    prior = draft_prior_z(p.get("draft_pick"), p.get("draft_round"))
    exp_ = p.get("experience") or 0
    fam = metric_family(grp)
    zs = sm.z(p.get("gsis"), fam) if fam else {}
    S, A, STR, SPD = phys_r["SPD"], phys_r["AGI"], phys_r["STR"], phys_r["ACC"]
    conf = {}

    def R(key, weights, base=70, scale=11, adj=0.0):
        z, c = blend(zs, weights, prior)
        conf[key] = round(c, 2)
        return to_rating(z + adj, base, scale)

    r = {}
    # Awareness: experience curve (snaps make the read), + production when known
    r["AWR"] = round(clamp(50 + 5 * min(exp_, 6) + 0.5 * max(0, exp_ - 6) + 8 * prior))
    # Who actually plays is the strongest public signal of how coaches rate
    # a player; blend volume per game (shrunk) into awareness.
    uz = sm.z(p.get("gsis"), "USE:" + grp).get("vol") if grp not in ("OT", "IOL", "K", "P", "LS") else None
    if uz:
        r["AWR"] = round(clamp(0.55 * r["AWR"] + 0.45 * to_rating(uz[0], 70, 13)))
    r["PRC"] = r["AWR"]
    r["STA"] = round(clamp(92 - 0.8 * max(0, (p.get("age") or 26) - 29) - (6 if grp in ("IDL", "OT", "IOL") else 0)))
    r["INJ"] = 85

    neutral = 60 if grp in ("OT", "IOL", "IDL") else 66
    for k in ("THP", "THA", "BCV", "ELU", "BTK", "TRK", "CAR", "CTH", "CIT", "SPC", "RTE", "RBK", "PBK",
              "IBL", "PMV", "FMV", "BSH", "TAK", "POW", "PUR", "MCV", "ZCV", "PRS", "KPW", "KAC", "RET"):
        r[k] = neutral - 18  # off-position default: plausible but poor
    mass_z = (p["weight_lb"] - 245) / 45

    if grp == "QB":
        r["THA"] = R("THA", {"cpoe": 3, "ypa": 1, "int": 1.5, "epa": 1}, 74, 10)
        r["THP"] = R("THP", {"air": 2, "deep": 2, "ypa": 1}, 82, 7, adj=0.1 * dz["broad_jump"])
        r["AWR"] = round(clamp(0.6 * r["AWR"] + 0.4 * R("AWR_q", {"sack": 1.5, "int": 1, "epa": 2}, 74, 10)))
        r["BCV"] = R("BCV", {"rush": 1}, 62, 10)
        r["CAR"] = 70
        r["ELU"] = round(clamp(0.5 * A + 0.5 * R("ELU", {"rush": 1}, 60, 12)))
    elif grp in ("RB", "FB"):
        r["BCV"] = R("BCV", {"repa": 2, "fd": 1.5, "ypc": 1}, 74, 10)
        r["ELU"] = round(clamp(0.45 * A + 0.55 * R("ELU", {"explosive": 2, "yac": 1}, 72, 11)))
        r["BTK"] = R("BTK", {"ypc": 1.5, "fd": 1, "yac": 1}, 72, 10, adj=0.35 * mass_z)
        r["TRK"] = round(clamp(0.5 * STR + 0.5 * r["BTK"] + 12 * mass_z))
        r["CAR"] = R("CAR", {"fum": 1}, 78, 9)
        r["CTH"] = R("CTH", {"catch": 1}, 66, 10)
        r["RTE"] = r["CTH"] - 8
        r["RBK"] = round(clamp(40 + 0.4 * STR + 12 * mass_z + (25 if grp == "FB" else 0)))
        r["PBK"] = round(clamp(r["RBK"] + 2))
        r["IBL"] = r["RBK"]
        r["RET"] = round(clamp(0.5 * S + 0.5 * r["ELU"]))
    elif grp in ("WR", "TE"):
        base = 72 if grp == "WR" else 66
        r["CTH"] = R("CTH", {"catch_oe": 2.5, "fum": 0.5}, base + 2, 10)
        r["RTE"] = R("RTE", {"share": 2, "fd": 1.5, "ypt": 1}, base, 11, adj=0.15 * (A - 72) / 11)
        r["CIT"] = R("CIT", {"catch_oe": 1.5, "fd": 1}, base, 10, adj=0.2 * (phys_r["JMP"] - 75) / 10)
        r["SPC"] = R("SPC", {"deep": 2, "catch_oe": 1}, base, 10, adj=0.25 * (phys_r["JMP"] - 75) / 10)
        r["ELU"] = round(clamp(0.5 * A + 0.5 * R("ELU", {"yac": 2}, base - 4, 11)))
        r["BTK"] = round(clamp(0.5 * r["ELU"] + 0.5 * STR + 6 * mass_z))
        r["TRK"] = round(clamp(STR * 0.6 + 14 * mass_z + 25))
        r["CAR"] = R("CAR", {"fum": 1}, 76, 8)
        blk = 46 + 0.35 * STR + 14 * mass_z + (14 if grp == "TE" else 0)
        r["RBK"] = round(clamp(blk))
        r["PBK"] = round(clamp(blk - 4))
        r["IBL"] = r["RBK"]
        r["RET"] = round(clamp(0.55 * S + 0.45 * r["ELU"]))
    elif grp in ("OT", "IOL", "LS"):
        # Public data has no clean OL production stat (pressures/blown blocks
        # are proprietary charting), so OL skill = physical tools + draft
        # capital + experience. Flagged low-confidence in output.
        tools = (STR - 70) / 12 + 0.4 * (phys_r["ACC"] - 60) / 12 + 0.25 * mass_z
        z = 0.45 * tools + 0.35 * prior + 0.2 * min(exp_, 8) / 4 - 0.25
        r["PBK"] = to_rating(z + (0.2 if grp == "OT" else 0), 72, 10)
        r["RBK"] = to_rating(z + (0.2 if grp == "IOL" else 0), 72, 10)
        r["IBL"] = round(clamp((r["PBK"] + r["RBK"]) / 2 + 1))
        conf.update(PBK=0.0, RBK=0.0)
        r["STA"] = r["STA"]
    elif grp in ("EDGE", "IDL", "LB", "CB", "S"):
        b = {"EDGE": 70, "IDL": 70, "LB": 70, "CB": 72, "S": 72}[grp]
        r["TAK"] = R("TAK", {"tkl": 2, "ff": 0.5, "tfl": 0.5}, b, 9, adj=0.15 * mass_z)
        r["PUR"] = round(clamp(0.5 * S + 0.5 * R("PUR", {"tkl": 1.5, "tfl": 1}, b, 10)))
        r["POW"] = round(clamp(0.45 * STR + 0.3 * S + 0.25 * R("POW", {"ff": 1, "tfl": 1}, b, 10) + 10 * mass_z - 5))
        r["PRC"] = round(clamp(0.6 * r["AWR"] + 0.4 * R("PRC", {"tfl": 1, "cov": 1}, b, 10)))
        if grp in ("EDGE", "IDL", "LB"):
            rush_base = {"EDGE": 72, "IDL": 68, "LB": 60}[grp]
            r["PMV"] = R("PMV", {"rush": 2, "tfl": 0.5}, rush_base, 11, adj=0.25 * (STR - 75) / 12)
            r["FMV"] = R("FMV", {"rush": 2}, rush_base, 11, adj=0.25 * (A - 70) / 12)
            r["BSH"] = R("BSH", {"tfl": 2, "tkl": 0.5}, b, 10, adj=0.3 * (STR - 75) / 12)
        else:
            r["PMV"] = r["FMV"] = 35
            r["BSH"] = round(clamp(0.6 * STR + 10))
        if grp in ("LB", "CB", "S"):
            cb = {"LB": 58, "CB": 74, "S": 70}[grp]
            r["MCV"] = R("MCV", {"cov": 2}, cb, 10, adj=0.2 * (S - 85) / 8)
            r["ZCV"] = R("ZCV", {"cov": 2, "tkl": 0.3}, cb + 2, 10, adj=0.1 * (r["AWR"] - 75) / 10)
            r["PRS"] = round(clamp(0.5 * r["MCV"] + 0.5 * STR + 8))
            r["CTH"] = round(clamp(r["MCV"] - 14))
        else:
            r["ZCV"] = r["MCV"] = round(clamp(30 + 0.2 * S))
        r["RET"] = round(clamp(0.6 * S + 0.4 * A - 10))
    elif grp == "K":
        r["KAC"] = R("KAC", {"fg": 2, "pat": 1}, 80, 8)
        r["KPW"] = R("KPW", {"long": 1}, 84, 7, adj=0.1 * (STR - 50) / 12)
    elif grp == "P":
        r["KPW"] = R("KPW", {"gross": 2, "net": 0.5}, 82, 8)
        r["KAC"] = R("KAC", {"in20": 1.5, "net": 1}, 78, 8)
    return {k: int(v) for k, v in r.items()}, conf


def age_from(birth):
    if not birth:
        return None
    y, m, d = (int(x) for x in birth.split("-"))
    return SEASON - y - ((m, d) > (10, 15))


def rate(p, cm, sm):
    phys, phys_r, meas, imputed, dz, t10 = physical_profile(p, cm)
    skills, conf = skill_ratings(p, sm, phys_r, dz)
    attrs = {**skills, **phys_r}
    p.update({
        "ratings": dict(sorted(attrs.items())),
        "ovr_raw": overall_raw(p["group"], attrs),
        "physics": phys,
        "measurables": meas,
        "imputed_drills": imputed,
        "t10": round(t10, 3),
        "confidence": conf,
    })
    return p


def main():
    players_csv = list(csv.DictReader(open(os.path.join(RAW, "players.csv"))))
    by_espn = {r["espn_id"]: r for r in players_csv if r["espn_id"]}
    combine_rows = list(csv.DictReader(open(os.path.join(RAW, "combine.csv"))))
    combine_by_pfr = {r["pfr_id"]: r for r in combine_rows if r["pfr_id"]}
    combine_by_name = defaultdict(list)
    for r in combine_rows:
        combine_by_name[r["player_name"].lower()].append(r)
    cm = CombineModel(combine_rows)
    stats, pos_of = load_stats()
    sm = SkillModel(stats, pos_of)

    def combine_for(x, name):
        comb = combine_by_pfr.get(x.get("pfr_id"))
        if not comb:  # fall back to unique name + draft year
            cands = [c for c in combine_by_name.get(name.lower(), [])
                     if not x.get("draft_year") or c["draft_year"] in ("", x.get("draft_year"))]
            comb = cands[0] if len(cands) == 1 else None
        return {d: num(comb[d]) for d in DRILLS} if comb else {}

    def base(x, **over):
        w = over.get("weight_lb") or num(x.get("weight")) or 220
        pos = over.get("pos") or x.get("position") or "LB"
        name = over.get("name") or x.get("display_name") or ""
        p = {
            "pos": pos, "group": group_of(pos, w), "name": name,
            "height_in": num(x.get("height")) or 74, "weight_lb": w,
            "age": age_from(x.get("birth_date")),
            "experience": int(num(x.get("years_of_experience")) or 0),
            "gsis": x.get("gsis_id"),
            "draft_round": int(x["draft_round"]) if x.get("draft_round") else None,
            "draft_pick": int(x["draft_pick"]) if x.get("draft_pick") else None,
            "combine": combine_for(x, name),
        }
        p.update({k: v for k, v in over.items() if v is not None})
        st = stats.get(p["gsis"])
        rush = None
        if st and st.get("games", 0) >= 4:
            rush = (st.get("def_sacks", 0) + 0.5 * st.get("def_qb_hits", 0)) / st["games"]
        p["group"] = group_of(p["pos"], p["weight_lb"], rush)
        return p

    # League-wide pass: every active player, used only to calibrate OVR.
    league = []
    for x in players_csv:
        if x["last_season"] == str(SEASON) and x["status"] == "ACT":
            p = rate(base(x), cm, sm)
            league.append((p["group"], p["ovr_raw"]))
    calib = OvrCalibration(league)

    out = {"meta": {
        "season": SEASON, "through_week": GAME_WEEK - 1,
        "combine_athletes": len(combine_rows),
        "stat_players": len(stats),
        "league_players_calibrated": len(league),
        "regressions": {f"{g}:{d}": {"coef": [round(c, 5) for c in v], "sd": round(cm.sd[(g, d)], 4)}
                        for (g, d), v in sorted(cm.coef.items())},
    }, "players": {}}

    for team in TEAMS:
        roster = json.load(open(os.path.join(RAW, f"roster_{team}.json")))
        for grp_ in roster["athletes"]:
            for a in grp_["items"]:
                pid = a["id"]
                x = by_espn.get(pid, {})
                p = base(
                    x, id=pid, team=team, name=a["fullName"], short=a.get("shortName"),
                    jersey=a.get("jersey"), pos=a["position"]["abbreviation"],
                    height_in=a.get("height"), weight_lb=a.get("weight"), age=a.get("age"),
                    experience=(a.get("experience") or {}).get("years"),
                    college=(a.get("college") or {}).get("name"),
                    headshot=(a.get("headshot") or {}).get("href"),
                )
                rate(p, cm, sm)
                p["ovr"] = calib(p["group"], p["ovr_raw"])
                p["ovr_raw"] = round(p["ovr_raw"], 2)
                out["players"][pid] = p

    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    ps = sorted(out["players"].values(), key=lambda p: -p["ovr"])
    print(f"wrote {OUT}: {len(ps)} players ({len(league)} league players calibrate OVR), "
          f"{sum(1 for p in ps if not p['imputed_drills'])} with a full combine")
    for p in ps[:30]:
        r = p["ratings"]
        print(f"  {p['team']} {p['pos']:<4} {p['name']:<24} OVR {p['ovr']:>2}  SPD {r['SPD']} ACC {r['ACC']} STR {r['STR']} AWR {r['AWR']}"
              f"  vmax {p['physics']['vmax']:.2f} tau {p['physics']['tau']:.2f}  40 {p['measurables']['forty']}")


if __name__ == "__main__":
    main()
