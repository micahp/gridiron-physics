"""Historical-only 2022-2025 playbook build and cutoff-safe event adapter.

Full-season team profiles are descriptive. Pregame consumers must use the
per-play observations through a strict season/week cutoff and provide an
as-of roster snapshot before a player is selected.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import build_playbooks as bp  # noqa: E402

HISTORICAL_SEASONS = tuple(bp.RESEARCH_SEASONS)
PROFILE_VERSION = "gridiron.historical-team-season.v1"
OBSERVATION_VERSION = "gridiron.historical-play.v1"
LP_EVENT_SCHEMA = "lp.nfl.event-model.pre-event.v1"
ACTION_TYPES = ("run", "pass")
CONTEXT_FIELDS = ("score_band", "half", "late_clock", "field_band", "down_band", "distance_band")


def validate_seasons(seasons):
    values = tuple(seasons)
    if not values or any(type(year) is not int or year not in HISTORICAL_SEASONS for year in values):
        raise ValueError(f"historical builder accepts only {HISTORICAL_SEASONS[0]}-{HISTORICAL_SEASONS[-1]}")
    if len(set(values)) != len(values):
        raise ValueError("duplicate historical season")
    return tuple(sorted(values))


def validate_output_dir(output_dir):
    dest = Path(output_dir).expanduser().resolve()
    if any("2026" in part for part in dest.parts):
        raise ValueError("historical output path may not identify the sealed season")
    try:
        common = os.path.commonpath((str(REPO_ROOT.resolve()), str(dest)))
    except ValueError:
        common = None
    if common == str(REPO_ROOT.resolve()):
        raise ValueError("write historical build outputs outside the repository")
    if dest == Path(bp.RAW).resolve() or Path(bp.RAW).resolve() in dest.parents:
        raise ValueError("historical output may not be inside the raw input directory")
    return dest


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def export_observations(output_dir, seasons=HISTORICAL_SEASONS):
    """Export separate per-play observation streams from historical profiles."""
    years = validate_seasons(seasons)
    out_dir = Path(output_dir).resolve()
    exports = {}
    for season in years:
        dest = out_dir / f"observations-{season}.jsonl"
        count = 0
        temp = str(dest) + ".tmp"
        with open(temp, "w", encoding="utf-8", newline="") as stream:
            for team in sorted(bp.RESEARCH_TEAM_NAMES):
                profile_path = out_dir / f"{team}-{season}.json"
                with open(profile_path, encoding="utf-8") as source:
                    profile = json.load(source)
                if profile.get("season") != season or profile.get("team_id") != team:
                    raise ValueError(f"profile identity mismatch: {profile_path}")
                if profile.get("historical_profile_version") != PROFILE_VERSION:
                    raise ValueError(f"unsupported historical profile version: {profile_path}")
                for side in ("offense", "defense"):
                    for play in profile[side]["observed_plays"]:
                        record = {
                            "schema_version": OBSERVATION_VERSION,
                            "season": season,
                            "era": "2022-2025",
                            "team_id": team,
                            "team_side": side,
                            "claim": "observed_play_attributes_not_authored_play_call",
                            "play": play,
                        }
                        stream.write(json.dumps(record, sort_keys=True, separators=(",", ":")))
                        stream.write("\n")
                        count += 1
        os.replace(temp, dest)
        exports[season] = {"path": str(dest), "records": count, "sha256": _sha256(dest)}
    return exports


def build_historical(output_dir):
    """Build only pinned 2022-2025 sources and export their play observations."""
    years = validate_seasons(HISTORICAL_SEASONS)
    dest = validate_output_dir(output_dir)
    dest.mkdir(parents=True, exist_ok=True)
    if set(bp.RESEARCH_SOURCE_PINS) != set(years):
        raise ValueError("historical source pins do not exactly match the allowed seasons")
    bp.build_research(str(dest))
    exports = export_observations(dest, years)
    return {"output_dir": str(dest), "seasons": list(years), "observations": exports}


def _play(record):
    return record.get("play", record)


def _season_week(record):
    play = _play(record)
    attrs = play.get("attributes") or {}
    season = record.get("season", play.get("season"))
    week = attrs.get("week", play.get("week"))
    try:
        return int(season), int(week)
    except (TypeError, ValueError):
        return None, None


def _before_cutoff(record, cutoff):
    season, week = _season_week(record)
    target_season, target_week = int(cutoff["season"]), int(cutoff["week"])
    if season is None or week is None:
        return False, "missing_season_or_week"
    if season not in HISTORICAL_SEASONS:
        raise ValueError(f"source record season {season} is outside the historical allowlist")
    if season < target_season or (season == target_season and week < target_week):
        return True, "included_prior_week"
    if season > target_season:
        return False, "later_season"
    return False, "same_or_later_target_week"


def cutoff_audit(records, cutoff):
    counts = Counter()
    included_games = set()
    max_included = None
    for record in records:
        counts["candidate_records"] += 1
        eligible, reason = _before_cutoff(record, cutoff)
        counts[reason] += 1
        if eligible:
            counts["included_records"] += 1
            play = _play(record)
            game_id = (play.get("source_id") or {}).get("game_id")
            if game_id:
                included_games.add(game_id)
            period = _season_week(record)
            max_included = period if max_included is None or period > max_included else max_included
    return {
        "cutoff": {"season": int(cutoff["season"]), "week": int(cutoff["week"]),
                   "policy": "strictly prior regular-season weeks; every game in the target week is excluded"},
        "counts": dict(sorted(counts.items())),
        "included_source_games": len(included_games),
        "latest_included_season_week": list(max_included) if max_included else None,
        "same_or_later_target_week_included": 0,
        "later_season_included": 0,
    }


def _score_band(score_diff):
    if score_diff is None:
        return None
    if score_diff <= -8:
        return "trailing_by_8_plus"
    if score_diff >= 8:
        return "leading_by_8_plus"
    return "within_7"


def _field_band(yardline):
    if yardline is None:
        return None
    if yardline <= 10:
        return "goal_to_go"
    if yardline <= 20:
        return "red_zone"
    if yardline <= 50:
        return "opponent_half"
    return "own_half"


def _distance_band(distance):
    if distance is None:
        return None
    if distance <= 3:
        return "short"
    if distance <= 7:
        return "medium"
    return "long"


def _context_features(record):
    attrs = (_play(record).get("attributes") or {})
    def number(key):
        try:
            return float(attrs[key]) if attrs.get(key) not in (None, "") else None
        except (TypeError, ValueError):
            return None
    qtr = number("qtr")
    clock = number("quarter_seconds_remaining")
    off_score, def_score = number("posteam_score"), number("defteam_score")
    score_diff = off_score - def_score if off_score is not None and def_score is not None else None
    down, distance = number("down"), number("ydstogo")
    return {
        "score_band": _score_band(score_diff),
        "half": "first_half" if qtr in (1, 2) else "second_half" if qtr in (3, 4) else None,
        "late_clock": "late" if qtr in (2, 4) and clock is not None and clock <= 120 else
                      "normal" if qtr in (1, 2, 3, 4) and clock is not None else None,
        "field_band": _field_band(number("yardline_100")),
        "down_band": "early_down" if down in (1, 2) else "late_down" if down in (3, 4) else None,
        "distance_band": _distance_band(distance),
    }


def _target_features(context):
    qtr = context.get("quarter")
    clock = context.get("clock_seconds")
    return {
        "score_band": _score_band(context.get("score_diff")),
        "half": "first_half" if qtr in (1, 2) else "second_half" if qtr in (3, 4) else None,
        "late_clock": "late" if qtr in (2, 4) and clock is not None and clock <= 120 else
                      "normal" if qtr in (1, 2, 3, 4) and clock is not None else None,
        "field_band": _field_band(context.get("yardline_100")),
        "down_band": "early_down" if context.get("down") in (1, 2) else
                     "late_down" if context.get("down") in (3, 4) else None,
        "distance_band": _distance_band(context.get("yards_to_go")),
    }


def _action(record):
    value = (_play(record).get("attributes") or {}).get("play_type")
    return value if value in ACTION_TYPES else None


def _logit(probability):
    p = min(1 - 1e-9, max(1e-9, probability))
    return math.log(p / (1 - p))


def _sigmoid(value):
    if value >= 0:
        z = math.exp(-value)
        return 1 / (1 + z)
    z = math.exp(value)
    return z / (1 + z)


def historical_action_prior(records, team_id, context, cutoff, *, alpha=30.0, min_effect=12,
                            cutoff_audit_result=None):
    """Team run/pass prior with separately shrunk main-effect situation modifiers."""
    if not math.isfinite(alpha) or alpha <= 0:
        raise ValueError("alpha must be positive")
    eligible = []
    audit = cutoff_audit_result if cutoff_audit_result is not None else cutoff_audit(records, cutoff)
    if (int(audit["cutoff"]["season"]), int(audit["cutoff"]["week"])) != \
            (int(cutoff["season"]), int(cutoff["week"])):
        raise ValueError("cutoff audit does not match the action-prior cutoff")
    for record in records:
        allowed, _reason = _before_cutoff(record, cutoff)
        if allowed and record.get("team_side", "offense") == "offense" and _action(record):
            eligible.append(record)
    league = eligible
    team_rows = [row for row in eligible if row.get("team_id") == team_id] if team_id else []
    base_rows = team_rows if len(team_rows) >= min_effect else league
    if not base_rows:
        raise ValueError("no cutoff-eligible run/pass evidence for team or league")
    league_counts = Counter(_action(row) for row in league)
    league_total = sum(league_counts.values())
    league_run = league_counts["run"] / league_total if league_total else 0.5
    counts = Counter(_action(row) for row in base_rows)
    total = counts["run"] + counts["pass"]
    base_run = (counts["run"] + alpha * league_run) / (total + alpha)
    base_logit = _logit(base_run)
    target = _target_features(context)
    effects = {}
    adjustment = 0.0
    for feature in CONTEXT_FIELDS:
        value = target[feature]
        if value is None:
            effects[feature] = {"status": "missing_in_target_or_source", "count": 0, "weight": 0.0}
            continue
        feature_rows = [row for row in base_rows if _context_features(row)[feature] == value]
        observed = len(feature_rows)
        if observed < min_effect:
            effects[feature] = {"status": "sparse_shrunk_to_team_prior", "count": observed, "weight": 0.0}
            continue
        feature_counts = Counter(_action(row) for row in feature_rows)
        local_run = (feature_counts["run"] + alpha * base_run) / (observed + alpha)
        shrink = observed / (observed + alpha)
        delta = shrink * (_logit(local_run) - base_logit)
        adjustment += delta
        effects[feature] = {"status": "supported_main_effect", "count": observed,
                            "weight": round(shrink, 6), "run_rate": round(local_run, 6)}
    run_probability = _sigmoid(base_logit + adjustment)
    return {
        "schema_version": "gridiron.cutoff-action-prior.v1",
        "team_id": team_id,
        "cutoff": audit["cutoff"],
        "action_counts": {"run": counts["run"], "pass": counts["pass"]},
        "action_denominator": total,
        "base_run_probability": round(base_run, 8),
        "action_probabilities": {"run": round(run_probability, 8), "pass": round(1 - run_probability, 8)},
        "source_run_wilson_95": bp.wilson(counts["run"], total),
        "parameter_smoothing": {"alpha": alpha, "supported_effect_floor": min_effect,
                                "context_effects_are_additive_main_effects": True},
        "context_effects": effects,
        "cutoff_audit": audit,
        "full_season_profile_used": False,
    }


def _usage_counts(records, team_id, action, role, cutoff):
    field = {"rusher": "rusher_player_id", "passer": "passer_player_id",
             "receiver": "receiver_player_id"}[role]
    counts = Counter()
    for record in records:
        allowed, _ = _before_cutoff(record, cutoff)
        if not allowed or record.get("team_id") != team_id or record.get("team_side", "offense") != "offense":
            continue
        play = _play(record)
        if _action(record) != action:
            continue
        player_id = (play.get("attributes") or {}).get(field)
        if player_id not in (None, ""):
            counts[str(player_id)] += 1
    return counts


def _weighted_choice(rng, choices, counts, label):
    choices = sorted({str(item) for item in choices if item not in (None, "")})
    available = [(item, counts[item]) for item in choices if counts[item] > 0]
    if not available:
        raise ValueError(f"no cutoff-supported available {label}")
    total = sum(weight for _, weight in available)
    point = rng.random() * total
    for item, weight in available:
        point -= weight
        if point < 0:
            return item
    return available[-1][0]


def prepare_pre_event_request(records, *, team_id, opponent_id, context, cutoff,
                              available_roster, rng, alpha=30.0):
    """Select play call and participants before any result is sampled."""
    if not isinstance(available_roster, dict) or not isinstance(available_roster.get("as_of"), dict):
        raise ValueError("a dated pregame roster snapshot is required")
    roster_as_of = available_roster["as_of"]
    if (int(roster_as_of.get("season", 0)), int(roster_as_of.get("week", 0))) >= \
            (int(cutoff["season"]), int(cutoff["week"])):
        raise ValueError("roster snapshot must be strictly before the prediction cutoff week")
    prior = historical_action_prior(records, team_id, context, cutoff, alpha=alpha)
    action = "run" if rng.random() < prior["action_probabilities"]["run"] else "pass"
    role = "rusher" if action == "run" else "passer"
    actor_counts = _usage_counts(records, team_id, action, role, cutoff)
    actor = _weighted_choice(rng, available_roster.get(role + "_ids", ()), actor_counts, role)
    participants = {role: actor}
    if action == "pass":
        receiver_counts = _usage_counts(records, team_id, action, "receiver", cutoff)
        participants["receiver"] = _weighted_choice(
            rng, available_roster.get("receiver_ids", ()), receiver_counts, "receiver")
    return {
        "schema_version": LP_EVENT_SCHEMA,
        "team_id": team_id,
        "opponent_id": opponent_id,
        "cutoff": prior["cutoff"],
        "game_state": {
            "score_diff": context.get("score_diff"),
            "quarter": context.get("quarter"),
            "clock_seconds": context.get("clock_seconds"),
            "yardline_100": context.get("yardline_100"),
            "down": context.get("down"),
            "yards_to_go": context.get("yards_to_go"),
            "timeouts_remaining": context.get("timeouts_remaining"),
            "timeouts_status": "observed_input" if context.get("timeouts_remaining") is not None else "unavailable",
        },
        "play_call": {"action": action, "probabilities": prior["action_probabilities"],
                      "prior_version": prior["schema_version"]},
        "participants": participants,
        "source_evidence": {
            "action_denominator": prior["action_denominator"],
            "action_counts": prior["action_counts"],
            "parameter_smoothing": prior["parameter_smoothing"],
            "context_effects": prior["context_effects"],
            "full_season_profile_used": False,
        },
        "outcome": None,
    }


def _event_type(record):
    play = _play(record)
    attrs = play.get("attributes") or {}
    outcome = play.get("outcome_label") or {}
    history = play.get("event_history") or {}
    action = attrs.get("play_type")
    if int(float(history.get("interception") or outcome.get("interception") or 0)) == 1:
        return "interception"
    if int(float(history.get("fumble_lost") or 0)) == 1:
        return "fumble_lost"
    if int(float(history.get("sack") or 0)) == 1:
        return "sack"
    if action == "run":
        return "run"
    if action == "pass":
        complete = outcome.get("complete_pass")
        return "pass_complete" if complete in (1, "1") else "pass_incomplete"
    return None


def conditional_outcome_pool(records, request, *, minimum_receiver_rows=2):
    """Back off actor outcome evidence without changing observed source fields."""
    action = request["play_call"]["action"]
    participants = request["participants"]
    actor_role = "rusher" if action == "run" else "passer"
    actor_id = participants[actor_role]
    actor_field = "rusher_player_id" if action == "run" else "passer_player_id"
    eligible = []
    for record in records:
        allowed, _ = _before_cutoff(record, request["cutoff"])
        if not allowed or _action(record) != action or record.get("team_side", "offense") != "offense":
            continue
        if _event_type(record) is None:
            continue
        eligible.append(record)
    team_actor = [r for r in eligible if r.get("team_id") == request["team_id"] and
                  str((_play(r).get("attributes") or {}).get(actor_field) or "") == actor_id]
    if action == "pass":
        receiver_id = participants.get("receiver")
        receiver_rows = [r for r in team_actor if str((_play(r).get("attributes") or {}).get("receiver_player_id") or "") == receiver_id]
        if len(receiver_rows) >= minimum_receiver_rows:
            return {"tier": "team_passer_receiver", "rows": receiver_rows}
    if team_actor:
        return {"tier": "team_selected_actor", "rows": team_actor}
    league_actor = [r for r in eligible if str((_play(r).get("attributes") or {}).get(actor_field) or "") == actor_id]
    if league_actor:
        return {"tier": "league_selected_actor", "rows": league_actor}
    team_action = [r for r in eligible if r.get("team_id") == request["team_id"]]
    if team_action:
        return {"tier": "team_action", "rows": team_action}
    if eligible:
        return {"tier": "league_action", "rows": eligible}
    raise ValueError(f"no historical outcome evidence for {action}")


def sample_pre_event_outcome(records, request, rng):
    pool = conditional_outcome_pool(records, request)
    selected = pool["rows"][rng.randrange(len(pool["rows"]))]
    play = _play(selected)
    attrs = play.get("attributes") or {}
    label = play.get("outcome_label") or {}
    event_type = _event_type(selected)
    yards = label.get("yards_gained")
    yards = int(float(yards)) if yards not in (None, "") else 0
    return {
        "event_type": event_type,
        "yards_gained": yards,
        "source_id": play.get("source_id"),
        "outcome_evidence_tier": pool["tier"],
        "player_selection_preceded_outcome": True,
    }


class LPHistoricalSamplingPolicy:
    """Research adapter for LP E1's `sampling_policy` callback.

    It chooses run/pass and a cutoff-eligible participant before selecting a
    historical result row. The caller remains responsible for applying the
    selected event through LP's shared reducer.
    """

    def __init__(self, pool, *, records, team_id, opponent_id, context, cutoff,
                 available_roster, condition_team=False, condition_script=False,
                 cutoff_audit_result=None):
        self.pool = pool
        self.entries = [entry for cell in pool.values() for entry in cell]
        self.records = records
        self.team_id = team_id
        self.opponent_id = opponent_id
        self.context = context
        self.cutoff = cutoff
        self.available_roster = available_roster
        if not isinstance(available_roster, dict) or not isinstance(available_roster.get("as_of"), dict):
            raise ValueError("a dated pregame roster snapshot is required")
        roster_as_of = available_roster["as_of"]
        if (int(roster_as_of.get("season", 0)), int(roster_as_of.get("week", 0))) >= \
                (int(cutoff["season"]), int(cutoff["week"])):
            raise ValueError("roster snapshot must be strictly before the prediction cutoff week")
        self.condition_team = condition_team
        self.condition_script = condition_script
        self.selections = []
        self._cell_key_by_identity = {id(cell): key for key, cell in pool.items()}
        self._row_feature_cache = {}
        self._reference_support_cache = {}
        self._usage_cache = {
            ("run", "rusher"): _usage_counts(records, team_id, "run", "rusher", cutoff),
            ("pass", "passer"): _usage_counts(records, team_id, "pass", "passer", cutoff),
            ("pass", "receiver"): _usage_counts(records, team_id, "pass", "receiver", cutoff),
        }
        prior_context = dict(context)
        if not condition_script:
            prior_context["score_diff"] = None
            prior_context["clock_seconds"] = None
        self.action_prior = historical_action_prior(
            records, team_id if condition_team else None, prior_context, cutoff,
            cutoff_audit_result=cutoff_audit_result)

    def _features_for_entry(self, entry):
        row = entry[1]
        key = id(row)
        if key not in self._row_feature_cache:
            self._row_feature_cache[key] = _context_features({"play": {"attributes": row}})
        return self._row_feature_cache[key]

    def _weights(self, entries, reference):
        reference_key = tuple(id(entry) for entry in reference)
        support = self._reference_support_cache.get(reference_key)
        if support is None:
            team_count = sum(1 for item in reference if item[1].get("posteam") == self.team_id)
            feature_counts = {feature: Counter() for feature in CONTEXT_FIELDS}
            if self.condition_script:
                for item in reference:
                    features = self._features_for_entry(item)
                    for feature in CONTEXT_FIELDS:
                        if features[feature] is not None:
                            feature_counts[feature][features[feature]] += 1
            support = (team_count, feature_counts)
            self._reference_support_cache[reference_key] = support

        team_count, feature_counts = support
        target = _target_features(self.context) if self.condition_script else {}
        result = []
        for entry in entries:
            row = entry[1]
            weight = 1.0
            if self.condition_team:
                team_support = team_count / (team_count + 30.0) if team_count else 0.0
                if row.get("posteam") == self.team_id:
                    weight *= 1.0 + 2.0 * team_support
                if row.get("posteam") == self.team_id and row.get("defteam") == self.opponent_id:
                    weight *= 1.0 + team_support
            if self.condition_script:
                features = self._features_for_entry(entry)
                for feature in CONTEXT_FIELDS:
                    value = target[feature]
                    if value is None:
                        continue
                    matched = feature_counts[feature][value]
                    shrink = matched / (matched + 24.0) if matched else 0.0
                    if features[feature] == value:
                        weight *= 1.0 + shrink
            result.append(weight)
        return result

    @staticmethod
    def _pick(rng, entries, weights):
        if not entries or sum(weights) <= 0:
            raise ValueError("historical event sampler has no positive-weight candidates")
        return rng.choices(entries, weights=weights, k=1)[0]

    def sample(self, rng, cell, offense, defense):
        cell_key = self._cell_key_by_identity.get(id(cell))
        action_entries = [entry for entry in cell if entry[1].get("play_type") in ACTION_TYPES]
        if not action_entries:
            raise ValueError("pre-event adapter currently requires a run/pass state cell")
        # The prior is fixed for this one-play experiment. A full drive must
        # provide the current pre-play context on every callback.
        action_prior = self.action_prior
        action_probabilities = action_prior["action_probabilities"]
        available_actions = {entry[1].get("play_type") for entry in action_entries}
        unsupported_mass = sum(action_probabilities[action] for action in ACTION_TYPES
                               if action not in available_actions)
        if unsupported_mass > 0:
            raise ValueError(
                f"historical run/pass prior assigns {unsupported_mass:.6f} probability "
                f"to an action absent from state cell {cell_key}")
        action = "run" if rng.random() < action_probabilities["run"] else "pass"
        action_entries = [entry for entry in action_entries if entry[1].get("play_type") == action]

        role = "rusher" if action == "run" else "passer"
        usage = self._usage_cache[(action, role)]
        actor = _weighted_choice(rng, self.available_roster.get(role + "_ids", ()), usage, role)
        participants = {role: actor}
        if action == "pass":
            receiver_usage = self._usage_cache[(action, "receiver")]
            participants["receiver"] = _weighted_choice(
                rng, self.available_roster.get("receiver_ids", ()), receiver_usage, "receiver")

        actor_field = "rusher_player_id" if action == "run" else "passer_player_id"
        actor_entries = [entry for entry in action_entries
                         if str(entry[1].get(actor_field) or "") == actor]
        tier = "selected_actor_same_cell"
        if action == "pass":
            receiver = participants["receiver"]
            receiver_entries = [entry for entry in actor_entries
                                if str(entry[1].get("receiver_player_id") or "") == receiver]
            if len(receiver_entries) >= 2:
                actor_entries, tier = receiver_entries, "selected_passer_receiver_same_cell"
        if not actor_entries:
            actor_entries = [entry for entry in self.entries
                             if entry[1].get("play_type") == action
                             and str(entry[1].get(actor_field) or "") == actor]
            tier = "selected_actor_broader_state"
        if self.condition_team and actor_entries:
            team_entries = [entry for entry in actor_entries
                            if entry[1].get("posteam") == self.team_id]
            if team_entries:
                actor_entries, tier = team_entries, tier + "_team"
        if not actor_entries:
            actor_entries = [entry for entry in self.entries if entry[1].get("play_type") == action]
            tier = "action_backoff_no_actor_outcome"
        outcome_weights = self._weights(actor_entries, action_entries)
        selected = self._pick(rng, actor_entries, outcome_weights)
        selected_event, row, runoff, spot = selected
        self.selections.append({
            "action": action,
            "action_prior": action_prior,
            "selected_event": selected_event,
            "participants": participants,
            "participant_selected_before_result": True,
            "outcome_evidence_tier": tier,
            "source_id": {"game_id": row.get("game_id"), "play_id": str(row.get("play_id"))},
            "receiving_spot": spot,
            "cell_key": list(cell_key) if cell_key is not None else None,
            "source_team": row.get("posteam"),
        })
        return selected_event, row, runoff, spot


def attach_preselected_participants(plays, selections):
    """Attach the sampler's already-made participant choices to E1 play records."""
    if len(plays) != len(selections):
        raise ValueError("participant selection count does not match emitted plays")
    for play, selection in zip(plays, selections):
        if not selection.get("participant_selected_before_result"):
            raise ValueError("participant selection was not recorded before outcome sampling")
        outcome = play["outcome"]
        for role, field in (("rusher", "rusher_id"), ("passer", "passer_id"), ("receiver", "receiver_id")):
            if role in selection["participants"]:
                outcome[field] = selection["participants"][role]
        play["sampling"]["participant_selection"] = {
            "order": "before_historical_result",
            "outcome_evidence_tier": selection["outcome_evidence_tier"],
        }
    return plays


def main():
    parser = argparse.ArgumentParser(description="Build pinned historical 2022-2025 playbooks and observation streams")
    parser.add_argument("--output-dir", required=True, help="absolute output directory outside this repository")
    args = parser.parse_args()
    result = build_historical(args.output_dir)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
