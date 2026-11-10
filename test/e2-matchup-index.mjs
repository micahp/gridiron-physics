import assert from 'node:assert/strict';
import {
  MATCHUPS,
  findMatchup,
  matchupFixture,
  summarizeMatchup,
} from '../web/e2-matchup-index.js';

assert.equal(MATCHUPS.length, 6);
const index = {
  games: [{
    matchup_id: 'Bengals at Ravens',
    away_team: { name: 'Cincinnati Bengals', abbr: 'CIN' },
    home_team: { name: 'Baltimore Ravens', abbr: 'BAL' },
    final_score: { away: 20, home: 27 },
    drive_count: 23,
    play_count: 142,
    fixture: {
      file: 'docs/fixtures/e2/sample.json',
      sha256: 'a'.repeat(64),
      upstream_source_file: 'docs/fixtures/e2/source.json',
      upstream_source_sha256: 'b'.repeat(64),
    },
  }],
};
const expected = MATCHUPS[0];
const row = findMatchup(index, expected.slug);
assert.ok(row, 'team names and matchup label should locate an index row');
assert.deepEqual(summarizeMatchup(row, expected), {
  score: { away: 20, home: 27 }, drives: 23, plays: 142,
});
assert.equal(matchupFixture(row).file, 'docs/fixtures/e2/sample.json');
assert.equal(findMatchup(index, MATCHUPS[1].slug), null, 'a missing matchup stays missing');
assert.equal(matchupFixture({ fixture_file: '../outside.json', sha256: 'a'.repeat(64) }), null,
  'the static viewer must reject paths escaping the repo root');
assert.equal(matchupFixture({ fixture_file: 'game.json', sha256: 'not-a-hash' }), null,
  'the static viewer must reject unpinned records');

console.log('E2 matchup index consumer: six requested rows, indexed score/counts, missing-row fallback, and path/hash guards pass');
