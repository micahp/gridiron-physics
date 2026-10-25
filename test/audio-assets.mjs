import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FOOTBALL_SOUNDS } from '../web/audio-director.js';

// The stadium mix ships as static files, so the manifest has to stay honest:
// every queued sound must exist, decode as Ogg Vorbis, and match its recorded
// hash. That also catches a stale manifest after a sound is regenerated.
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../web/audio/MANIFEST.json', import.meta.url), 'utf8'));
const byName = Object.fromEntries(manifest.files.map((f) => [f.filename, f]));

test('every queued sound exists and is listed in the manifest', () => {
  for (const [cue, relPath] of Object.entries(FOOTBALL_SOUNDS)) {
    const file = relPath.replace(/^web\/audio\//, '');
    assert.ok(existsSync(root + relPath), `${cue}: missing ${relPath}`);
    assert.ok(byName[file], `${cue}: ${file} is not in web/audio/MANIFEST.json`);
  }
});

test('manifest hashes and sizes match the files on disk', () => {
  for (const entry of manifest.files) {
    const buf = readFileSync(`${root}web/audio/${entry.filename}`);
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'OggS', `${entry.filename} is not an Ogg file`);
    assert.equal(buf.length, entry.bytes, `${entry.filename} size drifted from the manifest`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), entry.sha256,
      `${entry.filename} hash drifted from the manifest`);
  }
});

test('the contact sounds are synthesized in-repo, not library impacts', () => {
  for (const file of ['snap.ogg', 'pads-1.ogg', 'pads-2.ogg', 'whistle.ogg']) {
    const entry = byName[file];
    assert.equal(entry.source_pack, 'synthesized', `${file} should come from scripts/make_stadium_sfx.py`);
    assert.match(entry.from, /scripts\/make_stadium_sfx\.py/, `${file} must record its recipe`);
  }
});

test('no manifest entry points at a missing file', () => {
  for (const entry of manifest.files) {
    assert.ok(existsSync(`${root}web/audio/${entry.filename}`), `${entry.filename} is listed but absent`);
  }
});
