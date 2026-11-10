# receiver_touched_beyond_line

Field for blocked-kick recoveries under NFL Rule 9-3 (2026 rulebook, Rule 9 Section 3).

## Values

- `true`: independently verified that the receiving team touched the ball beyond the line of scrimmage before the kicking team recovered it.
- `false`: independently verified that it did not.
- `null`: not established. The generator refuses any blocked-kick kicking-team recovery whose value is `null`.

Only independently verified evidence may set `true` or `false`. It must not be derived from `punt_blocked`, fumble fields, the recovering team, or an assumed play outcome.

## Rule dependency

- 9-3-1 (behind the line): the kicking team may advance. Without a beyond-line receiver touch, the series continues unless the ball reaches the line to gain. With a beyond-line receiver touch, the kicking team gets a new series.
- 9-3-2 (beyond the line): with a beyond-line receiver touch, the ball is dead and the kicking team gets first-and-10. Without one, the ball is dead and the receivers get first-and-10 at the spot.

The behind-the-line case therefore cannot be resolved without this field. The beyond-the-line case also needs it to pick between the two outcomes.

## Provenance: 2025 regular-season blocked punts (9)

Source: `data/raw/pbp_2025.csv.gz`, column `desc`. The column names the recovering team and spot. It does not say whether the receiving team touched the ball beyond the line.

| game_id | play_id | kicking team | recovered by | Kicking recovery | receiver_touched_beyond_line |
|---|---|---|---|---|---|
| 2025_02_CLE_BAL | 1119 | CLE | BAL | no | n/a |
| 2025_02_TB_HOU | 3408 | TB | HOU | no | n/a |
| 2025_03_NO_SEA | 780 | NO | NO | yes, NO 11 | null |
| 2025_04_PHI_TB | 182 | TB | PHI | no | n/a |
| 2025_05_LV_IND | 1134 | LV | LV | yes, LV 8 | null |
| 2025_09_ARI_DAL | 1614 | ARI | DAL | no | n/a |
| 2025_10_LV_DEN | 3087 | LV | DEN | no | n/a |
| 2025_14_TEN_CLE | 3854 | CLE | TEN | no | n/a |
| 2025_18_NO_ATL | 739 | NO | ATL | no | n/a |

The two kicking-team recoveries (2025_03_NO_SEA 780 and 2025_05_LV_IND 1134) are `null`, so they stay refused.

## Sources checked

- `desc` column in the 2025 play-by-play: no beyond-line receiver-touch information.
- Other 2025 play-by-play columns (`punt_blocked`, `blocked_player_*`, `fumble_*`, `touchback`): not sufficient, and not used.
- Game video: not available in this environment; not reviewed.
- 2022 tracking data: may help develop a method. It cannot establish what happened on a 2025 play, and was not used as evidence.

## Status

All five ambiguous kicking-team recoveries stay refused (`blocked_punt_kicking_recovery`). No code or league-data change. Contract v1 is unchanged.
