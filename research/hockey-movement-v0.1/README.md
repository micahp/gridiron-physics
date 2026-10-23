# Hockey movement research v0.1

This directory contains the standalone replay viewer and compact, versioned scenario recordings.
It contains no raw Stathletes release data. The complete data-preparation and evaluation pipeline is
in the separate Legendary Picks research branch.

The viewer loads the latest immutable archive listed in `archive/manifest.json`. Recorded scenarios
show the actual observed paths and the independently generated M0, M1, and M2 paths. The **Run
policies in Gridiron controller** button executes the fold-specific serialized learned policy from
the scenario cutoff using `engine/movement/` and reports its agreement with the archived output.

To serve locally, from this repository root run:

```sh
python3 -m http.server 8099 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8099/research/hockey-movement-v0.1/viewer/`. The viewer is a static Three.js
page and does not call any data provider. It needs the repository's vendored Three.js modules and the
versioned gzip archive.

Run the movement API regression with `node test/movement.mjs`. The NFL engine validation remains
available as `node test/validate.mjs --strict`; the hockey adapter does not import or modify it.
