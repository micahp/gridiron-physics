"""Gate 1: reproduce the legacy 2025 team profiles (NE, CHI) on the current code. Read-only research.

The legacy `main()` also writes a 2026 pre-game comparison from the 2026 play-by-play. This check does not call it, and
it never reads 2026 inputs. It rebuilds each team with `build_2025` only, serialises the result the way `main()` does,
and compares it with the committed file after removing the two 2026 keys (`source.pbp_2026_pre_game` and
`pregame_2026_comparison`). The committed 2026 keys are not recomputed, so they are excluded from the comparison.

Writes a report and the rebuilt files to a scratch directory. The committed files are not modified.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import build_playbooks as b  # noqa: E402

TEAMS = ['NE', 'CHI']
COMMITTED = os.path.join(b.OUT)
SCRATCH = '/root/gridiron-playbooks-research/data/playbooks/research-2026-10-28-gate1-reproduction'
EXCLUDED_2026_KEYS = ('pregame_2026_comparison',)
EXCLUDED_SOURCE_KEYS = ('pbp_2026_pre_game',)


def canonical(obj):
    """Serialise exactly as `main()` does: indent 1, sorted keys, trailing newline."""
    return json.dumps(obj, indent=1, sort_keys=True) + '\n'


def without_2026(obj):
    out = {k: v for k, v in obj.items() if k not in EXCLUDED_2026_KEYS}
    out['source'] = {k: v for k, v in obj['source'].items() if k not in EXCLUDED_SOURCE_KEYS}
    return out


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    pbp25 = os.path.join(b.RAW, b.PBP_FILES[2025])
    part25 = os.path.join(b.RAW, 'pbp_participation_2025.csv')
    report = {'teams': {}, 'excluded_2026_keys': list(EXCLUDED_2026_KEYS),
              'excluded_source_keys': list(EXCLUDED_SOURCE_KEYS), 'inputs': {
                  'pbp_2025': {'path': pbp25, 'sha256': b.sha256(pbp25)},
                  'participation_2025': {'path': part25, 'sha256': b.sha256(part25)}}}
    for team in TEAMS:
        rebuilt = b.build_2025(pbp25, part25, team)
        committed_path = os.path.join(COMMITTED, f'{team}-2025.json')
        committed = json.load(open(committed_path, encoding='utf-8'))
        new_text = canonical(without_2026(rebuilt))
        old_text = canonical(without_2026(committed))
        out_path = os.path.join(SCRATCH, f'{team}-2025.2025-only.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(new_text)
        report['teams'][team] = {
            'committed_file': committed_path,
            'committed_sha256_raw': b.sha256(committed_path),
            'compared_sha256_committed_minus_2026': sha(old_text),
            'compared_sha256_rebuilt_minus_2026': sha(new_text),
            'identical': new_text == old_text,
            'rebuilt_file': out_path,
            'committed_bytes_compared': len(old_text),
            'rebuilt_bytes_compared': len(new_text),
        }
        if new_text != old_text:
            a_lines, b_lines = old_text.splitlines(), new_text.splitlines()
            diff = [(i + 1, x, y) for i, (x, y) in enumerate(zip(a_lines, b_lines)) if x != y][:20]
            report['teams'][team]['first_differences'] = diff
            report['teams'][team]['line_count'] = [len(a_lines), len(b_lines)]
    with open(os.path.join(SCRATCH, 'gate1_report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps(report, indent=1, sort_keys=True)[:6000])


if __name__ == '__main__':
    main()
