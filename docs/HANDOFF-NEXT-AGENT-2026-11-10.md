# Handoff to the next agent (2026-11-10)

Read this whole file before touching anything. The user is frustrated, and mostly for good reason: after a long
session of changes, **"it still looks the same."** The first job is to find out why, not to add more changes.

## 0. The user, and the rules that matter

- They want to **see the fix running at the port**, not hear that it exists. Do not report a fix as done from unit tests,
  still frames or single numbers. Watch the real page at real speed (or give them frame strips of the real page).
- They do not want Claude Docs or artifacts. Write docs as Markdown in the repo's `docs/` folder.
- They are blunt. Answer the question they asked first, in plain words, before running more commands. Never say "I
  couldn't reproduce it" when it is in the URL you gave them.
- The repo's `AGENTS.md` is binding: research branches only, no merging to `main`, no pushing, no production changes.
- Do not crawl top-level directories looking for things. The paths are below.
- Gridiron Physics has **two separate tracks** (see memory file `project_gridiron-two-tracks.md`). The replay track
  (`engine/play.js`, `week7.html`, `index.html`, `prototype.html`, `what-if.html`) replays sampled outcomes and anchors
  them. The simulation track (`autonomous.html`, `engine/autonomous*`) runs its own plays. The user decided that parity
  with the reference video (a "Furnace NFL Sim" capture) is about the **player model and animation**, which both tracks
  share through `web/render.js`. They have not asked for autonomous work.

## 1. Where everything is

- Repo: `C:\Users\micah\OneDrive\Desktop\Workspace\gridiron-physics`. **Work in the worktree**
  `...\gridiron-physics\gp-animctl`, branch `feat/rigged-animation-controller`. The root checkout is on a different branch
  (`research/replay-aux-channel`, older) and other worktrees exist (`gp-anim`, `gp-banner`, `gp-e2`).
  **Commit hashes in this file's sources may not match `git log`** (history was rewritten during the session); trust `git log`.
- The page: `http://127.0.0.1:8141/week7.html?game=2026_07_CIN_BAL` (kickoff is Play 1, the field goal is Play 8).
- Dev server: `python scripts/dev-server.py 8141 <path to gp-animctl>`. It sends `no-store`, no validators, never 304.
  The user had been hitting stale caches all session; this should end that. It must be running for the audit tool.
- Blender 5.2: `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"`.
- Tests: `node test/<name>.mjs` (unit), plus two browser tests that need Playwright's bundled browser, which is not
  installed; run them through a temporary copy with `channel: 'chrome'` injected into `chromium.launch({...})`
  (see how it was done: replace `chromium.launch({` with `chromium.launch({ channel: 'chrome',` in a `test/_tmp_*.mjs`).
  **Pre-existing failures, not ours:** `test/prototype.mjs` and `test/week7-audit-mutations.mjs`.
- Memory dir: `C:\Users\micah\.claude\projects\C--Users-micah\memory\` (one file: the two tracks).

## 2. FIRST THING TO DO: find out what the user is actually looking at

I never confirmed this. "It still looks the same" has two possible explanations and I only worked on one.

1. **They are not looking at the build I changed.** There are several worktrees and ports (8141 serves `gp-animctl`; the
   root checkout and others are different branches; an earlier session used a Cloudflare tunnel). Ask them for the exact
   URL in the address bar. Add a **visible build stamp** to the page (for example in the status line: git short hash and
   the number of clips in the GLB) so "is this the new build" is never a question again.
2. **They are looking at the right build and the changes are real but invisible at normal speed.** See section 4.

## 3. What was done (verified means: seen in a screenshot of the real page, or measured by the audit tool)

Replay `aux` channel and engine (replay track):
- `rec.aux` (velocity, contact role, contact partner), `rec.kindGroup`; players hold still before the snap
  (`holdPreSnap`); carrier no longer brakes at every waypoint or mills around its end spot; field-goal holder/kicker
  geometry fixed (kicker approaches from the other side, no contact between them); kickoff and field-goal kicker slowed
  into the plant. Verified by measurement and tests.

Model and clips (Blender pipeline, **reproducible**):
- `scripts/build_football_player.py` builds the GLB from the *original* animated GLB. Source:
  `git show 417855f:web/assets/football-player-rigged-animated.glb > somewhere/orig.glb` (the commit hash may differ after the
  history rewrite: find the commit that last touched the file before the first `FB_` clip was added). The script refuses to
  run on its own output. Run:
  `blender -b --python scripts/build_football_player.py -- --src orig.glb --out web/assets/football-player-rigged-animated.glb --manifest web/assets/football-player-build.manifest.json`
- `scripts/football_rig.py` (pose solver, hinge-aware two-bone IK, ground lock, run-cycle bake), `scripts/football_clips.py`
  (all 29 authored `FB_*` clips as data), `scripts/preview_football_clips.py` (contact sheets; `FB_ALL=1` for every key).
- Arms lengthened 30%. Stock run cycles rebuilt (longer stride, calmer torso, bigger arm swing, feet locked to the turf).
- Uniforms: per-team jersey/pants repaint, numbers painted into the jersey, gloves, striped socks, cleats, pants stripe
  (per-pixel shader from bind-pose position), helmet stripe and logo. Verified in close-up screenshots.

Controller (`web/rigged-animation-controller.js`, `web/rigged-player.js`): clip chosen from slot + play type + contact
role (`footballClip`), event-timed one-shots through `deriveCues` / `resolveCue` / `honourCues`, get-up after a fall,
stiff-arm trigger, QB drop-back, catch variants, tackle pair, swim/rip, kick/punt on the `kick` event, `bodyLean`
(lean into acceleration and turns), hip-follows-travel twist (capped at 0.45 rad). Unit tests cover the selection logic.

## 4. Why it still looks the same, and what is NOT fixed

Measured by `scripts/audit-motion-live.mjs` (report: `docs/MOTION-AUDIT-LIVE-2026-11-10.md`, 21 flags at last run):

- **Feet skate. This is the big one and it is not fixed.** The planted foot slides 2 to 6 m/s over the ground in every
  run, jog, walk and backpedal clip. The engine sprints players at 8 to 10 m/s; the stock clips' stride is too short.
  I lengthened the stride in Blender (Blender confirms natural speed 2.9 to 5.6 m/s) and switched the runtime gait
  measurement to the ball of the foot, but the live measurement did not improve. The mid-stance numbers were never
  cleanly separated from touch-down frames, so the metric may overstate it, but the user's eye agrees. **The real fix is
  runtime foot IK:** each frame, for the planted foot, pin the toe to its world position from touch-down until
  toe-off and solve the leg (two-bone IK on thigh/shin, ankle on top); and/or per-clip stride calibration against the
  recorded ground speed. Do not claim it fixed until the audit's `foot-slide` flag clears AND a frame strip of the
  real page shows planted feet that stay put.
- **Shoulders still rock.** Sprint roll std 13 deg against a limit of 7 (real sprinting is about 3 to 5). The stock clip
  rocks about +/-12 deg; I damped the spine chain to 0.45 and capped my own hip twist, which helped (peak roll 83 to 36 deg,
  twist 89 to 43 deg) but not enough.
- **Arm swing still small:** 0.43 to 0.48 m of fore-aft hand travel per second against 0.5 to 0.8 wanted.
- **Kick:** arms now stay near the body and the lean is small (audit: hand spread 0.38 m, roll 0.7 deg), but the plant
  foot still skates about 3 m/s, so some "floating" remains.
- Blocks are still single clips facing the partner (hands do not track the opponent). Tackle pairs are timed to the same
  event but the arms do not track the carrier's body. No helmet/pants detail beyond what is listed. Soft contact shadows
  (a `&shadows=blob` flag exists, default off) and a replay camera were NOT done (the user said the camera item is not
  needed: the viewer already has broadcast, all-22, skycam, chalkboard, follow, free).

## 5. Recommended order

1. Section 2: confirm the URL and add the build stamp. Hard refresh once (the new server stops caching).
2. Build **runtime foot IK** (section 4) and make the audit's `foot-slide` metric trustworthy (mid-stance only, toe below
   3 cm, separate touch-down/toe-off frames) before trusting any number.
3. Re-run the audit (`node scripts/audit-motion-live.mjs --plays 12 --out docs/MOTION-AUDIT-LIVE-<date>.md`); `--flags
   noLean,noTwist` switches those layers off to see what each contributes.
4. **Show the user evidence they can judge:** a strip of 8 to 10 consecutive frames of a sprinting player from a fixed
   side camera, before and after, from the real page. That is what they care about.
5. Then arm swing and shoulder rock, then block/tackle contact tracking, then soft shadows if they still want them.

## 6. Gotchas that cost me hours

- **Shell quoting.** Python heredocs with apostrophes inside `bash -c` broke repeatedly. Write patch scripts with the
  Write tool to a file and run them with `python file.py`. Put an `assert old in s` on every replacement.
- **Blender 5.2 headless: do not read `pose_bone.matrix` back.** It is stale. `football_rig.py` does its own forward
  kinematics (`_fk_bases`, `_solve`). Detach the imported action (`R.detach(arm)`) or it overrides any pose you set.
- The GLB importer sets 24 fps. The character faces -Y with left at +X in Blender (glTF: faces +Z).
- Stepping the viewer in a test: wrap `renderer.draw` so only your manual draws run, then call
  `window.__gridironDrawAt(seconds)`. `window.__gridironChoose(i)` picks a play; the rigged players load a moment after.
  Do not freeze `draw` before the new play's record loads, or you step the previous play's data (this produced a bogus
  result once). `window.__audit = { noLean: true, noTwist: true }` switches layers off.
- Elbow angle convention in the audit: straight arm = 0 deg, negative = bent backward. No authored clip bends backward now.
- Adding a clip: author it in `football_clips.py`, add to `all_clips()`, give it a trigger in the controller, rebuild.
  A mirrored pair is made from the `_L` clip by `mirror()` in `all_clips()`.
- Replay events available: `snap`, `kick`, `throw`, `catch`, `handoff` {from,to}, `wrapped` {by,on}, `tackle`, `shed`,
  `hit`, `broken_tackle`, `whistle`, `flag`. Pose codes are in `web/pose-codes.js`.

## 7. State of the tree

Clean except `_closeup.mjs` (untracked, the user's; leave it). Nothing is pushed. All unit tests pass; both browser
tests pass; `week7-core`, `week7-audit`, `football-assertion`, `validate` pass.
Other docs: `ENGINE-AND-MOTION-AUDIT-2026-11-09.md` (engine audit, replay vs simulation track findings),
`REFERENCE-VIDEO-FURNACE-VS-GRIDIRON-2026-11-09.md` (what the reference video shows against what we have),
`HANDOFF-rigged-animation-2026-11-09.md` (older, build details).
