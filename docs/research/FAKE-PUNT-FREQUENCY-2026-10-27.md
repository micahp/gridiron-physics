# Fake punts: frequency and outcomes, regular seasons 2022 to 2026

Status: descriptive. Source: nflverse play-by-play for 2022 to 2025 and the pinned 2026 Weeks 1 to 7 file. Read-only analysis; no engine default or playbook value changed by this document.

## Definition and classification

A fake punt is a run or pass snap whose play description says "Punt formation". nflverse records these as ordinary scrimmage plays (`play_type` run or pass) with `punt_attempt` 0 and `special_teams_play` 0. No description in the 83 snaps says a punt occurred. The builder classifies them as `snap_type = fake_punt` and keeps them out of the ordinary play-selection denominators. They are reported in the `special_teams` block of each profile.

Limitation: identification relies on the description text. A fake punt whose description omits "Punt formation" would be missed.

## Counts

- Fake punts: 83 (2022: 24, 2023: 23, 2024: 20, 2025: 12, 2026 Weeks 1 to 7: 4).
- Real punts in the same regular-season data: 9,241. Punt situations (real punts plus fake punts): 9,324.
- Overall rate: 83 of 9,324, or 0.89%.
- All 9,324 punt situations are on fourth down, so the down split carries no information.

## Frequency by distance to go

| Yards to go | Fake punts | Punt situations | Rate |
|---|---:|---:|---:|
| 1 to 3 | 42 | 1,622 | 2.6% |
| 4 to 6 | 18 | 2,000 | 0.9% |
| 7 to 9 | 12 | 1,929 | 0.6% |
| 10 or more | 11 | 3,773 | 0.3% |

Most fake punts come on fourth and short.

## Frequency by field position (yards from the offense's own goal line)

| Position | Fake punts | Punt situations | Rate |
|---|---:|---:|---:|
| Own 1 to 25 | 19 | 2,500 | 0.8% |
| Own 26 to 49 | 59 | 5,588 | 1.1% |
| Opponent 49 to 26 | 5 | 1,236 | 0.4% |
| Opponent 25 or closer | 0 | 0 | not applicable: no punt situations recorded there |

## Frequency by team (pooled 2022 to 2026)

League rate 0.890%. Exact upper-tail binomial p against the league rate, with 32 teams tested (Bonferroni threshold 0.05 / 32 = 0.0016):

| Team | Fake punts | Punt situations | Rate | Expected | p |
|---|---:|---:|---:|---:|---:|
| DET | 9 | 240 | 3.7% | 2.14 | 0.0003 |
| NYJ | 10 | 355 | 2.8% | 3.16 | 0.0015 |
| ARI | 7 | 286 | 2.4% | 2.55 | 0.0151 |

The other 29 teams range from 0 to 5 fake punts, with p values above 0.15.

Reading: DET and NYJ exceed the league rate after the multiple-comparison correction, and NYJ only just. With 9 and 10 events over five seasons, these are flags for review, not a tendency. The result does not show whether the same staff, personnel or season drives the counts. It should not enter a team playbook until a larger sample or a play-level review supports it.

## Outcomes (all 83)

- Gained a first down: 45 (54%).
- Turnovers (interception or fumble lost): 4.
- Mean yards gained: 5.45.

Outcomes by team are not reported. Each team has at most 10 fake punts, which is too few to say anything reliable.

## What this document does not show

- It does not show whether a fake punt was the right decision.
- It does not separate the coach's intent from the play result.
- It does not cover playoff games, which the regular-season build excludes.
