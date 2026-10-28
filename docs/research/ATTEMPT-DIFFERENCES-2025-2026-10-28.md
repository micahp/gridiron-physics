# 2025 rushing and passing attempt differences: explained

Status: explained for 2025, all 32 teams. Script: `pipeline/explain_2025_attempt_differences.py`. Output: `data/playbooks/research-2026-10-28-attempt-differences-2025/attempt_differences_2025.json`. Source: play-by-play and official team stats (`stats_team`, regular season, 2025).

## Result

| Side | Difference, PBP minus official | Explained by | Teams matched |
|---|---:|---|---:|
| Rushing (carries) | 32 | Two-point conversion runs (32 plays, each with the rush flag) | 32 of 32 |
| Passing (attempts) | 96 | Two-point conversion passes (96 plays, each with the pass flag) | 32 of 32 |

The earlier figures of 32 rushing and 15 passing "unexplained" were wrong in two ways. The 96 passing difference is the two-point passes, not 81 plus 15. And the earlier explanation of 81 was wrong: spikes, a no-play row and a field-goal pass are counted in the official attempts, so they were never the cause.

## Rushing carries, 2025

| Counted in official carries | Plays |
|---|---:|
| Run plays | 12,992 |
| Quarterback scrambles flagged as rush attempts | 1,089 |
| Quarterback kneels flagged as rush attempts | 433 |
| Aborted run plays flagged as rush attempts | 87 |
| **Total** | **14,601** |

Not counted: 32 two-point conversion runs. The total matches the official 14,601 exactly.

## Passing attempts, 2025

| Counted in official attempts | Plays |
|---|---:|
| Pass plays | 17,358 |
| Quarterback spikes flagged as pass attempts | 79 |
| Field-goal-formation pass attempts | 1 |
| No-play pass attempts | 1 |
| **Total** | **17,439** |

Sacks are excluded from both sides, and the sack total matches (1,287). Not counted: 96 two-point conversion passes. The total matches the official 17,439 exactly.

## Two-point flags in 2025

All 128 two-point attempts in 2025 carry the flag for their own action: 96 passes with the pass flag and 32 runs with the rush flag. The flags are consistent.

## What this means for the statistical layer

- The official carries and attempts count kneels, scrambles, spikes and aborted run plays. They do not count two-point conversions. The event history keeps two-point conversions as their own class, so the official totals can be rebuilt from it.
- The check covers 2025 only. 2022 to 2024 have not been run.
