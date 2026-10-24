# E3 evidence index — 2026-10-24

| Evidence | Result | Scope and limits |
|---|---|---|
| [Tracking-informed pre-snap clock evaluation](TRACKING-PRESNAP-CLOCK-HOLDOUT-WEEKS6-9-2026-10-24.md) | **Negative finding; route closed.** Tracking-informed pre-snap clock MAE was 12.04 s/play versus 11.89 s/play for PBP-only pre-snap. The tracking model also had a larger game-level cumulative clock gap (296.91 s versus 159.38 s). | Weeks 6–9 had already been examined in prior E3 work, so this is not blind holdout validation. No further tracking-clock calibration is authorized or planned. |
| [Game-realism evaluation smoke run](E3-GAME-REALISM-EVALUATOR-SMOKE-SEED1-2026-10-24.md) | Evaluation harness runs against the accepted seed-1 LP E2 record and observed 2022–2025 distribution export. | One retrospective game, `valid_full_game=false`; overlapping source period; exploratory smoke test only. Joint observed references are absent for several requested conditional metrics. |

The evaluator and its invocation are in [`scripts/research/e3_game_realism_evaluator.py`](../../../scripts/research/e3_game_realism_evaluator.py). Its machine-readable result is [`e3-game-realism-smoke-seed1-2026-10-24.json`](e3-game-realism-smoke-seed1-2026-10-24.json). Neither artifact changes the E2 legal-game or shared-v1 gate.
