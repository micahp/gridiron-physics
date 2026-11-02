# Restore procedure: historical 2022 to 2024 build, v2

Status: tested on this box on 2026-11-02 (pass). See "Last restore test" below.

## What is archived

The v2 build directory `historical-2022-2024-v2`: 114 files. That is 96 team-season profiles, the observation streams
(`observations-<season>.jsonl`), build reports, build manifests, shotgun provenance, the compact C/D/E prior
(`cde-prior-2022-2024-v2.json`) and `SHA256SUMS.txt`.

Not in the archive:

- the raw PBP, participation and FTN inputs. Each is pinned by SHA-256 in `source_pins` in `ARCHIVE-MANIFEST.json`;
- the original v1 build at `/root/gridiron-playbook-builds/historical-2022-2024`, which stays in place unchanged;
- the rev3 comparison profiles.

## Identity

- **Version ID:** `sha256:9e979e62b0206e2f5ef71cf9d023d6d0c94d828cbeb954b4718e44151243705e`. It is the SHA-256 of the
  archive file, and it is part of the archive's file name.
- **Archive:** `historical-2022-2024-v2-9e979e62b0206e2f5ef71cf9d023d6d0c94d828cbeb954b4718e44151243705e.tar.gz`
  (70,419,160 bytes).
- **Manifest:** `ARCHIVE-MANIFEST.json` in this directory, which is also stored next to the archive. It records the builder
  commit, the C/D/E builder commit, the consumer pin commit, the source pins and the storage settings.
- **Pins checked by the consumer tests:** `SHA256SUMS.txt` = `99513e2feab7ba8dd66573f8a0d4c07c37424eba574f689c4954a70b44ea52d5`;
  C/D/E artifact = `00e3c8b22db60233db7447517409d461ea579ce13d80f3aaca2ab55243852a27`.

## Where it is kept

`/root/gridiron-playbook-archives/` on this box. The directory is mode 0700 and owned by root. The archive and the manifest
are mode 0400 and have the immutable attribute (`chattr +i`).

**No off-box copy exists.** No durable, access-controlled target has been named, so the archive is a single local copy. Name
a target before treating this as retention. A copy step is not part of this procedure yet.

## Restore steps

1. Confirm the version ID. The file's SHA-256 must equal the value in its name:
   `sha256sum /root/gridiron-playbook-archives/historical-2022-2024-v2-<version>.tar.gz`
2. Confirm immutability: `lsattr` on the archive should show `i`.
3. Run the restore check into an empty scratch directory:
   `bash pipeline/restore_check_historical.sh <archive> <empty scratch dir> <SLC>/scripts/nfl_sequence`
   The script checks the archive against its version ID, extracts it, confirms the file count (114), runs
   `sha256sum -c` on every file, runs the eight SLC consumer tests on the restored copy, and removes that copy on exit.
   Exit status 0 means the restore passed.
4. To use a restored copy in place, extract it to a directory you keep, run `sha256sum -c SHA256SUMS.txt` there, and
   set `HISTORICAL_PLAYBOOK_DIR` to that directory when running the consumer tests.

## Last restore test

- Date: 2026-11-02.
- Archive: the version above. Extracted into a scratch directory under the session scratchpad.
- Result: pass. 114 files found and expected. Every `SHA256SUMS.txt` entry verified. Eight consumer tests passed on the
  restored copy (`test_playbook_prior_historical`, five tests; `test_playbook_prior_compact`, three tests), in about 90
  seconds. The scratch copy was removed.

## Changing the immutable attribute

Only root can clear it, with `chattr -i <file>`. Do this only after the owner decides to delete or replace the archive, and
record the reason in the manifest.
