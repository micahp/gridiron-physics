# Sideline boundary candidate (research only)

This experiment compares the current carrier-center threshold with contact by the engine's existing 2D player-disc radius. It changes no engine code and selects no radius from observed outcomes.

## Run

Generate the temporary OOB case list and week 1–5 runner/football extracts from the LP canonical snap-anchored cohort, then run:

```sh
python3 evaluate.py
```

The default inputs are `/tmp/gridiron_oob_candidates_wk1-5.csv` and `/tmp/gridiron_oob_track_rows_wk1.csv` through `wk5.csv`. The LP manifest and Gridiron ratings file are also checked and hashed. Raw tracking extracts remain outside Git. The script writes `results.json`.

## Candidate

The baseline is the production condition: player center more than 0.3 yd outside the sideline. The candidate marks the first sampled runner position where the existing disc touches the sideline. Because 2022 tracking identities are not mapped to engine radius profiles, results are shown at both ends of the current engine radius range (0.295–0.362 m). Frames are 0.1 s apart. The event label is the tracking football `out_of_bounds` frame; ball-spot deltas compare forward x at each candidate crossing with forward x at that event frame.

## Result

On all 260 matched plays, the current threshold crossed in 244 tracks and was within one frame of the tracking event in 137. The disc-edge candidates crossed in 257 tracks; they were within one frame in 170 (small radius) and 155 (large radius).

On the 244 plays with crossings under both the current threshold and small-radius candidate, absolute event-frame error improved in 119, tied in 28, and worsened in 97. Median absolute error change was zero frames. The paired median change in absolute forward ball-spot delta was also effectively zero; the small-radius candidate improved 122 plays and worsened 119. Its p90 absolute spot delta was 1.96 yd versus 1.69 yd for the current threshold. The large-radius candidate's paired median absolute spot delta was 0.015 yd worse.

**Decision: do not adopt the disc-edge trigger from this audit.** It improves the share within one frame, while trading some late calls for early calls and failing to improve median paired timing or spot error. The player disc is only a proxy, not an observed foot/body contact point; 10 Hz event timing cannot determine exact contact. Keep the current engine rule pending a labeled foot/contact dataset and a better player boundary shape.
