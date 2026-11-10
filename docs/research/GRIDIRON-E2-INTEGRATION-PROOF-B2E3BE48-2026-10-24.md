# Gridiron E2 integration proof: LP payload at b2e3be48

Date: 2026-10-24  
Gridiron branch: `research/gridiron-e2-game-viewer-2026-10-24`  
LP evidence inspected: `feat/nfl-sequence-e2-kickoffs-2026-10-24` at `b2e3be4876d644d2ad8a5f94b7d25365ba7ba724`.

## Result

The Gridiron browser viewer loaded the LP raw E2 payload bytes from LP commit `b2e3be48`, verified the raw payload SHA-256, compared its `record` to the Gridiron transport envelope record, and navigated the displayed game through Drive 24 / Play 143. The score shown was A 14–B 10, the independent football-state audit reported zero findings, and Chromium reported zero runtime errors.

LP's raw payload at `b2e3be48:docs/fixtures/e2/e2-game-seed1.json` has SHA-256 `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`. It is byte-identical to Gridiron's currently pinned raw-source fixture. Its `record` also equals the record in the existing transport envelope.

The viewer consumes the E2 record through Gridiron's immutable envelope (`contract` + `source` + `record`). It does not pass the LP raw top-level object directly to `adaptLpGamePayload`: that object has no E2 `contract` or envelope `source`. The browser proof supplies the b2e3 raw bytes to the viewer's upstream-source fetch in memory, while keeping the checked-in manifest and envelope unchanged. The committed manifest still pins raw producer `1ca7560924fe7da3eb452b142176bf09d7aeb1f0` and envelope `45381829488e43813a31793ee546df0b95dee856`. No LP pin was changed.

## Exact consumer field inventory

The inventory covers `web/lp-game-record-adapter.js`, `web/e2-game-viewer.js`, and the E3 comparison panel called by the viewer.

**Transport envelope and provenance**

- `contract.name`, `contract.version`.
- `source.repository`, `source.branch`, `source.base_commit`, `source.producer_worktree_dirty`, and every `source.producer_file_sha256[path]` entry.
- `source.data_source.kick_table` or, for the raw LP source description passed to the audit, `sources.kick_table`.
- `record`.

**Game record**

- Top-level paths: `record.mode`, `record.seed`, `record.simulation_id`, `record.ledger`, `record.kickoffs`, `record.drives`, `record.points.A`, `record.points.B`, `record.stats.team`, `record.status`, `record.tied`, `record.complete_regulation`, `record.final_quarter`, `record.final_clock_seconds`, `record.valid_full_game`, `record.unsupported_rules`, and `record.gaps`.
- Ledger: `winner`, `loser`, `winner_choice`, `first_half_chooser`, `second_half_chooser`.
- Each kickoff: `kind`, `quarter`, `kicking_team`, `receiving_team`, `after_drive`, and display provenance `source.game_id` / `source.play_id`.
- Each drive: `index`, `offense_team`, `quarter_start`, `clock_start`, `end_quarter`, `end_clock`, `terminal`, `plays`, `points_scored_on_drive.team`, `points_scored_on_drive.points`, and `field_goal_made`.
- Each play: `sequence`, `id`, `event_type`, `state_before`, `state_after`, `outcome`, `decision`, `sampling`, `field`, and `participants`.
- Each before/after state: `quarter`, `clock_seconds`, `offense_team`, `defense_team`, `down`, `yards_to_go`, `yardline_100`, `home_score`, `away_score`, `home_timeouts`, `away_timeouts`, and `drive_index`.
- Outcome validation reads `yards_gained`, `touchdown`, `turnover`, `punt`, `field_goal_attempt`, `safety`, `quarter_change`, `clock_clamped_to_zero`, and `clock_only_terminal`; it checks `outcome.sampled_from` against `participants.sampled_from` when both are supplied. The play inspector displays the complete `outcome`, `participants`, `decision`, `sampling`, and `field` objects unchanged.
- `participants.attribution` is required and displayed. The field summary displays `field.assignment_version` and `field.source`. E3's play marginal reads `decision.type`.
- E3 comparison also reads `record.drives[*].plays.length`, `record.points`, and `record.unsupported_rules`. Team-stat display iterates the supplied keys under `record.stats.team`.

The adapter deep-clones and freezes the source record, validates it, and adds only display indexes. It does not replace source play IDs or outcomes. The shared-v1 structural audit separately checks `mode`, `game_id`, `model_version`, `rules_version`, `as_of_utc`, `scheduled_kickoff_utc`, `teams.home/away`, `roster_snapshot_id`, play-state scores/timeouts, and `valid_full_game`.

## Shared contract reference

The exact SHA-256 of Gridiron's unchanged `docs/GRIDIRON-CONTRACT-v1.md` is:

```text
ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7
```

The viewer's shared-v1 audit is evaluated against that contract version. The browser does not recompute the Markdown document hash at runtime; the hash above pins the exact document content used for this integration proof. The E2 record remains retrospective and `valid_full_game: false`; displaying it does not establish shared-v1 conformance.

## Reproduction and command output

The integration test reads the LP file directly with `git show` at the pinned full commit, verifies its SHA against the existing Gridiron upstream-source pin, and routes those bytes into a real Chromium session. The route alias and manifest response exist only in test memory.

Command:

```sh
PLAYWRIGHT_MODULE=/root/.npm/_npx/fd3bca3c548369c0/node_modules/playwright/index.mjs \
CHROME_BIN=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
LP_E2_REPO=/root/lp-nfl-sequence-e2 \
node test/e2-game-viewer-lp-b2e3-integration.mjs
```

Output:

```text
LP source commit: b2e3be4876d644d2ad8a5f94b7d25365ba7ba724
LP raw payload SHA-256: 0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
Gridiron shared contract v1 SHA-256: ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7
Viewer integration: loaded and navigated 24 drives / 143 plays; score A 14–B 10; independent state audit 0 findings
Committed Gridiron pin unchanged: envelope 45381829488e43813a31793ee546df0b95dee856; raw producer 1ca7560924fe7da3eb452b142176bf09d7aeb1f0
Browser runtime errors: 0
```

Existing adapter and pinned-viewer checks also passed:

```text
$ node test/lp-game-record-adapter.mjs
LP E2 game adapter: assertions passed
fixture=game-seed1.json sha256=b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1
upstream=lp-e2-game-seed1-1ca75609.json sha256=0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
drives=24 plays=143 score=A 14, B 10
football-state findings=0; raw-record v1 gaps=8; projected-v1 source gaps=7

$ node test/e2-game-viewer.mjs
E2 viewer DOM audit: final LP record loads 24 drives / 143 plays; E3 diagnostics and caveats rendered

$ PLAYWRIGHT_MODULE=/root/.npm/_npx/fd3bca3c548369c0/node_modules/playwright/index.mjs CHROME_BIN=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome node test/e2-game-viewer.browser.mjs
Real Chromium navigation: final 1ca payload navigated Drive 24 / Play 143; archived 5fc hard-rejected
Browser runtime errors: 0
```
