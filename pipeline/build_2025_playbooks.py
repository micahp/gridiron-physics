"""Build the 2025-only team playbook for all 32 teams.

Reads only the 2025 play-by-play and the 2025 participation file, through build_playbooks.build_2025. It never opens
the 2026 files and never calls build_pregame_2026, so no file written here carries a pregame_2026_comparison block or
a 2026 source record. Output is one <TEAM>-2025.json per team, written with the same layout as build_playbooks.main.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_playbooks as bp  # noqa: E402

TEAM_NAMES = {
    'ARI': 'Arizona Cardinals', 'ATL': 'Atlanta Falcons', 'BAL': 'Baltimore Ravens', 'BUF': 'Buffalo Bills',
    'CAR': 'Carolina Panthers', 'CHI': 'Chicago Bears', 'CIN': 'Cincinnati Bengals', 'CLE': 'Cleveland Browns',
    'DAL': 'Dallas Cowboys', 'DEN': 'Denver Broncos', 'DET': 'Detroit Lions', 'GB': 'Green Bay Packers',
    'HOU': 'Houston Texans', 'IND': 'Indianapolis Colts', 'JAX': 'Jacksonville Jaguars', 'KC': 'Kansas City Chiefs',
    'LA': 'Los Angeles Rams', 'LAC': 'Los Angeles Chargers', 'LV': 'Las Vegas Raiders', 'MIA': 'Miami Dolphins',
    'MIN': 'Minnesota Vikings', 'NE': 'New England Patriots', 'NO': 'New Orleans Saints', 'NYG': 'New York Giants',
    'NYJ': 'New York Jets', 'PHI': 'Philadelphia Eagles', 'PIT': 'Pittsburgh Steelers', 'SF': 'San Francisco 49ers',
    'SEA': 'Seattle Seahawks', 'TB': 'Tampa Bay Buccaneers', 'TEN': 'Tennessee Titans', 'WAS': 'Washington Commanders',
}


def build_all(out_dir):
    pbp25 = os.path.join(bp.RAW, bp.PBP_FILES[2025])
    part25 = os.path.join(bp.RAW, 'pbp_participation_2025.csv')
    for path in (pbp25, part25):
        if not os.path.isfile(path):
            raise FileNotFoundError(f'missing 2025 source {path}')
    bp.TEAMS.update(TEAM_NAMES)
    os.makedirs(out_dir, exist_ok=True)
    for team in sorted(TEAM_NAMES):
        result = bp.build_2025(pbp25, part25, team)
        path = os.path.join(out_dir, f'{team}-2025.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=1, sort_keys=True)
            f.write('\n')
        coverage = result['coverage']
        print(f"wrote {path}: offense={coverage['eligible_offense_scrimmage_plays']} "
              f"defense={coverage['eligible_defense_scrimmage_plays']} "
              f"participation joins={coverage['offense_participation_joined']}/"
              f"{coverage['eligible_offense_scrimmage_plays']}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: build_2025_playbooks.py OUT_DIR')
    build_all(sys.argv[1])
