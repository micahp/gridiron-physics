#!/usr/bin/env python3
"""Decompose the frozen legacy tackle-hold probe (200 seeds, NE-CHI) into selection and post-wrap motion.

Reads only frozen inputs: results.json (per-seed rows from the probe), profiles-week6.json (frozen Henderson-Bush
profiles) and the snapshot ratings used for every other tackler. Writes new files only, next to this script.

Outputs:
  decomposition.json   per-condition counts, paired differences with bootstrap intervals, hold-ratio diagnostics,
                       tackler mix
  shared-schema-summary.json  ratings-to-physics shared schema, one row per engine and seed, nulls where unsupported
  seed_rows.csv        per-seed paired rows (no raw source ratings)

Hold ratio (diagnostic only, uncalibrated): gripFactor(tackler TAK) / gripFactor(carrier max(BTK, ELU)), where
gripFactor(r) = clamp(0.5 + (r - 50) / 100, 0.5, 1.5). The original engine implies a ratio of exactly 1.
"""

import csv
import hashlib
import json
import os
import random
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RESULTS = os.path.join(ROOT, 'research/madden27-tackle-hold-probe/results.json')
PROFILES = os.path.join(ROOT, 'research/madden27-tackle-hold-probe/profiles-week6.json')
SNAPSHOT = os.path.join(ROOT, 'data/teams/matchup-2026-10-22.json')
YD_TO_M = 0.9144
DT = 1 / 120
BOOT = 2000
rng = random.Random(20261023)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def grip(r):
    return min(1.5, max(0.5, 0.5 + (r - 50) / 100))


def boot_ci(xs):
    if len(xs) < 2:
        return None, None
    means = []
    for _ in range(BOOT):
        s = [xs[rng.randrange(len(xs))] for _ in xs]
        means.append(sum(s) / len(s))
    means.sort()
    return means[int(0.025 * BOOT)], means[int(0.975 * BOOT) - 1]


def main():
    res = json.load(open(RESULTS))
    snap = json.load(open(SNAPSHOT))
    prof = json.load(open(PROFILES))
    tak = {p['id']: p['ratings']['TAK'] for t in snap['teams'].values() for p in t['roster'] if 'TAK' in p.get('ratings', {})}
    names = {p['id']: p['name'] for t in snap['teams'].values() for p in t['roster']}
    bush = next(p for p in prof['profiles'] if p.get('name', '').endswith('Bush')) if 'profiles' in prof else None
    bush_id = '00-0035525'
    henderson_id = '00-0040734'

    per_cond = {}
    seed_rows = []
    decomposition = {'source': {'results_sha256': sha256(RESULTS), 'profiles_sha256': sha256(PROFILES),
                                'snapshot_sha256': sha256(SNAPSHOT)}, 'conditions': {}}
    carrier_btk_elu = {'project-estimated-contact-ratings': (72, 76), 'madden27-tkl-only': (72, 76),
                       'madden27-btk-only': (81, 76), 'madden27-tkl-and-btk': (81, 76)}
    for cond, pair in res['results'].items():
        o_rows = pair['original']['perSeed']
        s_rows = pair['ratingScaled']['perSeed']
        btk, elu = carrier_btk_elu[cond]
        resist = grip(max(btk, elu))
        tk_mix = {}
        paired, ratios = [], []
        flips = 0
        for seed, (ro, rs) in enumerate(zip(o_rows, s_rows), start=1):
            if bool(ro.get('tackled')) != bool(rs.get('tackled')):
                flips += 1
            tid = rs.get('tacklerId') or ro.get('tacklerId')
            tk_mix[tid] = tk_mix.get(tid, 0) + (1 if rs.get('tackled') else 0)
            tak_val = 89 if (cond in ('madden27-tkl-only', 'madden27-tkl-and-btk') and tid == bush_id) else tak.get(tid)
            if rs.get('tackled') and ro.get('tackled'):
                hold = grip(tak_val) / resist if tak_val is not None else None
                diff = rs['dragYd'] - ro['dragYd']
                paired.append(diff)
                ratios.append(hold)
            seed_rows.append({
                'condition': cond, 'seed': seed,
                'tackle_original': int(bool(ro.get('tackled'))), 'tackle_scaled': int(bool(rs.get('tackled'))),
                'tackler_id': tid, 'tackler_name': names.get(tid, ''), 'carrier_id': rs.get('carrierId'),
                'travel_original_yd': ro.get('dragYd'), 'travel_scaled_yd': rs.get('dragYd'),
                'travel_diff_yd': (rs['dragYd'] - ro['dragYd']) if (rs.get('tackled') and ro.get('tackled')) else None,
                'hold_ratio_diag': round(hold, 4) if (rs.get('tackled') and ro.get('tackled') and tak_val is not None) else None,
            })
        pairs = [(r, d) for r, d in zip(ratios, paired) if r is not None]
        xs = [r - 1 for r, _ in pairs]
        ys = [d for _, d in pairs]
        slope = corr = None
        if len(xs) > 2 and st.pstdev(xs) > 0 and st.pstdev(ys) > 0:
            mx, my = st.mean(xs), st.mean(ys)
            cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / len(xs)
            slope = cov / st.pvariance(xs)
            corr = cov / (st.pstdev(xs) * st.pstdev(ys))
        lo, hi = boot_ci(paired)
        per_cond[cond] = {
            'seeds': len(o_rows),
            'tackles_original': sum(int(bool(r.get('tackled'))) for r in o_rows),
            'tackles_scaled': sum(int(bool(r.get('tackled'))) for r in s_rows),
            'selection_flips': flips,
            'paired_tackled_seeds': len(paired),
            'paired_travel_diff_yd_mean': st.mean(paired) if paired else None,
            'paired_travel_diff_yd_bootstrap95': [lo, hi],
            'paired_travel_diff_m_mean': (st.mean(paired) * YD_TO_M) if paired else None,
            'hold_ratio_mean': st.mean(ratios) if ratios else None,
            'hold_ratio_below_1_share': (sum(1 for r in ratios if r < 1) / len(ratios)) if ratios else None,
            'slope_diff_on_hold_minus_1': slope,
            'corr_diff_hold_minus_1': corr,
            'tackler_mix_scaled': sorted(
                [{'tackler_id': k, 'name': names.get(k, ''), 'tackles': v} for k, v in tk_mix.items() if v],
                key=lambda x: -x['tackles'])[:6],
        }
    decomposition['conditions'] = per_cond
    with open(os.path.join(HERE, 'decomposition.json'), 'w') as f:
        json.dump(decomposition, f, indent=2)
        f.write('\n')
    with open(os.path.join(HERE, 'seed_rows.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(seed_rows[0].keys()))
        w.writeheader()
        w.writerows(seed_rows)

    # Shared schema: one row per engine and seed. Null where the legacy probe does not observe a quantity.
    code = {'original': 'c9d4e6f51630f911a671d1b60f23513d8e5e7e30', 'ratingScaled': '0db20fef9a3a939581ad1a27d8cb2829428946f6'}
    rows = []
    for cond, pair in res['results'].items():
        for engine in ('original', 'ratingScaled'):
            for seed, r in enumerate(pair[engine]['perSeed'], start=1):
                tackled = bool(r.get('tackled'))
                rows.append({
                    'schema_version': 'ratings-to-physics/v1',
                    'track': 'legacy-tackle-hold',
                    'branch': 'research/madden27-tackle-physics-probe',
                    'code_commit': code[engine],
                    'source_snapshot_hash': sha256(PROFILES),
                    'mapping_version': 'legacy-mapping-v1-uncalibrated',
                    'player_ids': f"{r.get('tacklerId')}|{r.get('carrierId')}",
                    'scenario_id': 'ne_chi_free_run_week6',
                    'solver_or_engine': 'legacy world.js/play.js',
                    'dt_seconds': DT,
                    'run_id': f'{cond}|{engine}|seed{seed}',
                    'seed_or_fixture_label': seed,
                    'conditions': cond,
                    'contact_opportunity_count': None,
                    'actual_contact_count': int(tackled),
                    'first_contact_seconds': r.get('tackleTimeSeconds') if tackled else None,
                    'tackle_selected': tackled,
                    'physical_takedown': 'not_applicable',
                    'grip_established': 'not_applicable', 'grip_released': 'not_applicable',
                    'ball_controlled': 'not_observed', 'fumble': 'not_observed',
                    'post_contact_carrier_travel_m': (r['dragYd'] * YD_TO_M) if tackled else None,
                    'post_contact_window': '1.0 s after first recorded tackle; censored if no tackle',
                    'balance_state': 'not_observed', 'controller_forces_N': 'not_applicable',
                    'requested_grip_load_N': 'not_applicable',
                    'contact_impulse_Ns': None,
                    'closing_speed_mps': r.get('closingMps') if tackled else None,
                    'tackle_energy_J': r.get('energyJ') if tackled else None,
                    'penetration_max_m': 'not_applicable', 'penetration_p95_m': 'not_applicable',
                    'penetration_duration_weighted_mean_m': 'not_applicable',
                    'result_status': 'passed',
                })
    summary = {'schema_version': 'ratings-to-physics/v1', 'track': 'legacy-tackle-hold',
               'branch': 'research/madden27-tackle-physics-probe', 'rows': rows,
               'null_policy': 'null means the legacy probe does not measure the quantity; not zero',
               'source_hashes': decomposition['source']}
    with open(os.path.join(HERE, 'shared-schema-summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)
        f.write('\n')
    print(json.dumps({k: {x: v[x] for x in ('tackles_original', 'tackles_scaled', 'selection_flips',
                                             'paired_travel_diff_yd_mean', 'hold_ratio_mean', 'corr_diff_hold_minus_1')}
                      for k, v in per_cond.items()}, indent=1))


if __name__ == '__main__':
    main()
