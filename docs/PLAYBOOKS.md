# Patriots and Bears observed playbooks

The committed profiles are `data/playbooks/NE-2025.json` and `data/playbooks/CHI-2025.json`. Rebuild them with:

```sh
python3 pipeline/fetch_prototype_data.py
python3 pipeline/build_playbooks.py
```

`pipeline/fetch_prototype_data.py` verifies pinned SHA-256 hashes before the builder reads its ignored `data/raw/` inputs. The playbook release uses 2025 regular-season PBP and participation, joined by legacy game ID plus `play_id`. Postseason rows have their own excluded count and never enter regular-season denominators.

Primary schemas/releases: [nflverse PBP dictionary](https://nflreadr.nflverse.com/articles/dictionary_pbp.html), [participation dictionary](https://nflreadr.nflverse.com/articles/dictionary_participation.html), and the [PBP](https://github.com/nflverse/nflverse-data/releases/tag/pbp) and [participation](https://github.com/nflverse/nflverse-data/releases/tag/pbp_participation) release pages. Each derived file records the direct asset URL and hash.

## What the data means

`observed_2025` records are charted historical attributes. They do not recover the complete play call, route tree, blocking rules, audibles, coverage responsibility, or coaching intent. `observed_2026_pre_game` contains only 2026 regular-season Weeks 1-6 and is PBP-only. It is a descriptive check; it does not replace or causally adjust the 2025 prior. Postseason is excluded.

`inferred_concept` is reserved for fields derived from observed labels. For defense, `personnel_<DL-LB-DB>` is a personnel-count bucket, not a verified front, box, or coverage shell. The published participation data does not provide a complete geometric defensive alignment. `synthetic_variation` is used for the demo's 11-personnel engine alignment, assignment choices, and required run endpoint. The demo does not sample these as if they were observed frequencies.

The optional `historical_coach` library was not added. No synthetic Madden assets or proprietary playbooks are used. `playbook_variants` remains empty; a future coach-history library must have an independent sampling control.

## JSON schema

Both files use `schema_version: gridiron.playbook.v1` and preserve these fields:

- `team_id`, `season`, `phase`, `provenance`, and `claims` identify scope and limits.
- `source` records exact public release URLs and hashes.
- `coverage` gives eligible play totals, participation join/missing counts and source IDs, and separately excluded postseason rows.
- `offense.profile` and `defense.profile` store tendencies.
- `offense.play_candidates.run` and `.pass` group directly charted 2025 attribute combinations by formation, shotgun state, and run gap/location or pass depth/location. Each entry has its own stable ID, count, action-specific denominator, rate, Wilson interval, and contributing source IDs. The catalogs also report classified and missing action plays.
- `offense.observed_plays` and `defense.observed_plays` store selected per-play attributes and participant labels. `outcome_label` is kept in a separate subobject and is not read by the prospective demo.
- `pregame_2026_comparison` stores the Weeks 1-6 PBP-only comparison and source IDs.
- `playbook_variants` is empty unless new provenance-specific variants are explicitly added.

Each tendency distribution carries its provenance category, denominator, observed and missing counts, coverage, missing source IDs, and category counts/rates with Wilson 95% intervals. Every category lists its contributing `{game_id, old_game_id, play_id}` source IDs. Rates divide by observed values; coverage divides by the full eligible denominator. Subset denominators are explicit: run gap uses run snaps, pass depth uses pass snaps, pass-rush count uses pass snaps, and down/situation profiles use their labeled situation subset. Do not compare subset rates as if they shared a denominator.

The files enumerate all five provenance categories and independent sampling controls. Historical coach and synthetic variants are disabled in profile sampling; synthetic designs appear only when the integration demo is explicitly run. Inferred personnel codes and defense personnel buckets carry `inferred_concept`; raw participation labels remain `observed_2025` or `observed_2026_pre_game`.

The browser lets users choose one catalog entry. Candidate coverage is lower than overall action coverage because an entry is emitted only when every grouping label is present. A selectable entry is an observed attribute combination, not an NFL play call. The simulator still creates a synthetic 11-player alignment and target/route assignments; it keeps the entry's provenance and frequency separate from those execution inputs. Free run/pass mode does not provide historical outcome anchors.

Source field coverage and classification are intentionally visible. PBP contains shotgun, run/pass, locations, run gap, pass depth/air yards, and target identifiers where charted. Participation provides formations, personnel labels, defenders in the box, pass rushers, route labels, and coverage labels with varying missingness. In the pinned input schema, play-action and motion are absent; their coverage is zero and all eligible rows are counted as missing. Receiver/target fields show whether a target is recorded, not a verified route assignment. The inferred defense bucket is not an actual formation.

## Observed regular-season coverage

This compact report is derived from the committed JSON. Exact counts and all per-bucket IDs remain in the files.

| Team | Offense plays | Runs / passes | Offense formation coverage | Offense personnel-code coverage | Defense plays | Defensive personnel-code coverage | Postseason team rows excluded |
|---|---:|---:|---:|---:|---:|---:|---:|
| NE | 1,017 | 466 / 551 | 1,014 / 1,017 | 920 / 1,017 | 966 | 965 / 966 | 661 |
| CHI | 1,096 | 496 / 600 | 1,096 / 1,096 | 1,043 / 1,096 | 1,022 | 1,022 / 1,022 | 371 |

The primary offense charted formations were shotgun, under center, and pistol. Run direction/gap, pass direction/depth, third down, short yardage, red zone, goal line, and two-minute labels are separate distributions with their own denominators. Defensive box counts, pass-rusher counts, personnel buckets, and provider coverage labels remain distinct fields. These are usage descriptions, not a literal playbook reconstruction.

For selectable attribute combinations, NE has 326/466 run plays and 502/551 pass plays fully classified; CHI has 406/496 runs and 572/600 passes. The remaining plays stay in `missing_or_unclassified`. Candidate frequencies use the run or pass denominator shown per catalog, not all scrimmage snaps.

## Rebuild and reconcile

The builder is deterministic for the pinned inputs. For each team, `eligible_offense_scrimmage_plays` equals the number of emitted observed offense records, and each tendency's observed plus missing count equals its denominator. The participation join uses `old_game_id` and `play_id`; the output lists any failed joins instead of silently dropping them.

The 2026 comparison filters PBP to `season_type=REG`, `week <= 6`, and the relevant possession team. It does not include any Week 7 game rows or participation-derived 2026 formation claims.
