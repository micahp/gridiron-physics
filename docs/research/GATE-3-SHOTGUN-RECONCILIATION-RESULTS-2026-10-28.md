# Gate 3 reconciliation results: 2022–2024

Status: historical reconciliation only. The revised rule is in
[GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md](GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md).
No historical source fields were changed.

## Source hierarchy and row-level values

The current builder hierarchy remains: (1) FTN `qb_location` (`S`/`P` = shotgun, `U` = under center); (2) mapped
participation formation; and (3) PBP `shotgun` only when the game has FTN charting rows and both higher-priority sources
are missing. A game without FTN rows leaves the result null.

The rerun retained each source separately. `failing_disputed_source_values.csv` reports the PBP flag, raw FTN
`qb_location` and derived value, and participation formation and derived value for every disputed row in the 16 old-gate
failing team-seasons. It contains 272 rows: 190 regulation-down disagreements and 82 two-point attempts without a
regulation down. Among the 190 regulation-down rows:

| PBP vs participation disagreement explained by FTN | Rows |
|---|---:|
| FTN agrees with participation | 184 |
| FTN agrees with PBP | 6 |
| FTN missing | 0 |
| All three values differ | 0 |

These row values are also preserved in the copied output directory linked below. No row was recoded to make the sources
agree.

## Gate outcomes

- The old PBP-versus-participation 1.0 percentage-point gate still reports **16 failures**: 6 in 2023 and 10 in 2024.
  They remain visible in `team_season_sources.csv`.
- Revised R1 (FTN/participation agreement of at least 99.0%) fails in **15 2022 team-seasons**: ATL 98.8945%, BAL
  98.7317%, CAR 98.9648%, CHI 98.9775%, CLE 98.4475%, GB 98.5451%, JAX 98.9583%, LA 98.5729%, LAC 98.7600%, MIA
  98.8821%, NYG 98.9671%, NYJ 98.0916%, SEA 98.8293%, SF 98.9300%, and TB 98.8556%. All 2023 and 2024 team-seasons
  pass R1.
- Revised R2's per-play value-and-source comparison passes for **all 96 team-seasons**.
- R3 writes every PBP-only hierarchy fallback to `unresolved_plays.csv`. That file retains **564 unresolved/fallback
  rows**; no PBP fallback is silent.

The revised gate therefore does not pass all 96 team-seasons: the 15 R1 failures remain unexplained and open.

## 2024 Tampa Bay remains visible

The old paired comparison for TB has 1,081 plays:

| Source/value | Numerator / denominator | Share |
|---|---:|---:|
| PBP `shotgun` | 686 / 1,081 | 63.4598% |
| Participation mapped formation | 698 / 1,081 | 64.5698% |
| FTN `S` or `P` among known FTN `S`/`P`/`U` values | 648 / 1,025 | 63.2195% |
| Builder hierarchy | 699 / 1,084 | 64.4834% |

FTN is present on 1,025 TB plays and agrees with participation on all 1,025. There are 16 PBP/participation
disagreements: 13 regulation-down plays and 3 two-point attempts. On those 16, FTN sides with participation on 14 and is
missing on 2; it sides with PBP on none. The hierarchy source counts are FTN 1,025, participation 56, PBP fallback 3,
and null 0. The three fallback plays and the two FTN-missing source disagreements remain individually inspectable in
`unresolved_plays.csv`. TB passes R1 and R2 but remains explicitly open because the PBP disagreement's full cause has not
been established.

## Rerun artifacts

These fresh outputs were copied from a 2022–2024-only rerun into
[`research-2026-10-28-gate3-current-rerun`](../../data/playbooks/research-2026-10-28-gate3-current-rerun/):

- `gate3_summary.json`: `e26a1f4bff0173480a7743e2ce1e9b133a8b1c02242c2eb0b15cc5869f2615f1`
- `team_season_sources.csv`: `06c20162f9e7f4799fe70349d4bcc5f27f23876b23593c6b24168da103c7b947`
- `unresolved_plays.csv`: `e0ccaba41c83ee9ad1a227dff0e4dc52044233af0dee5fda2769f14f90aac19f`
- `failing_disputed_source_values.csv`: `38e6053c24e68a3c0351b20854f22170edb485d2780ad23dda25a17973eb16dc`

The rerun used `pipeline/reconcile_shotgun_sources.py` and `pipeline/build_playbooks.py`; the builder's historical source
fields were read only.
