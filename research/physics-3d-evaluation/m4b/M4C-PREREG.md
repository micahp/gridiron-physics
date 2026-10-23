# M4c preregistered acceptance criteria

**Registered before M4c physics tuning.** These criteria remain fixed for this milestone. A missed criterion is reported as a failure; fixture or parameter changes do not change the thresholds.

## Numerical contact criteria

For each engine, geometry, and controlled penetration run:

- Maximum reported penetration depth: **≤ 0.15 m**.
- 95th percentile of per-step maximum penetration, including zero-contact steps: **≤ 0.05 m**.
- Duration-weighted mean per-step maximum penetration: **≤ 0.025 m**.
- Report counts of sampled contact steps exceeding **0.01 m, 0.05 m, 0.10 m, and 0.15 m**, and separately report first-step penetration.
- No player is repositioned or separated after simulation starts.

## Contact-event distinctions

- A **contact opportunity** is reported when the transformed capsule/sphere proxies have analytic surface separation at or below **0.10 m**. This is a trajectory diagnostic, not a pass criterion and not physical contact.
- **Physical contact** requires a contact pair from the active engine after a simulation step.
- Grip attempt, established grip, sustained control, overload/release, balance loss, sustained fall, and any scenario outcome are recorded as distinct events or states. No result is accepted solely because a fixture reached its end time.

## Football-state criteria

- A tackle or sack is complete only after physical contacts and a supported fall state: player tilt **≥ 58°**, ground contact, center of mass **≤ 0.85 m**, sustained for **0.20 s** without upright recovery.
- A retained ball remains physically controlled for **≥ 1.0 s** under recorded external contact, with no attachment overload or separation-limit release.
- A fumble requires an attachment load above its declared physical capacity for **≥ 2 consecutive 120 Hz steps**, followed by solver-resolved ball separation. A contact event alone is insufficient.
- A failed recovery requires physical ball/player contact and failure to retain control for **0.25 s**.
- A secure recovery requires physical ball/player contact followed by maintained two-point cradle control for **≥ 0.50 s**, with no competing controller at the end of that interval. Proximity alone never qualifies.
- Tush-push possession requires physical snap/ball contact and maintained two-point quarterback control for **≥ 0.25 s**. Carrier and football progress are measured separately; no rules outcome is assigned.
- Each accepted demonstration must run for both engines with at least two seeds and two physical input configurations. Seeds are recorded even if a deterministic fixture does not consume randomness.

## Scope

These are engineering gates for rigid-body proxy experiments. They do not establish anatomical realism, NFL predictive accuracy, or production readiness. Rapier and Jolt measurements remain separately labeled where their JavaScript adapters expose different solver telemetry.
