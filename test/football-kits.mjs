import test from 'node:test';
import assert from 'node:assert/strict';
import { WEEK7_TEAM_KITS, kitsForMatchup, kitsForGame } from '../web/football-kits.js';

const teams = ['CIN', 'BAL', 'MIA', 'NYJ', 'SF', 'ATL', 'TB', 'CAR', 'GB', 'DET', 'DAL', 'PHI'];

test('all twelve Week 7 teams have explicit home and away kit definitions', () => {
  assert.deepEqual(Object.keys(WEEK7_TEAM_KITS).sort(), [...teams].sort());
  for (const id of teams) {
    for (const side of ['home', 'away']) {
      const kit = WEEK7_TEAM_KITS[id][side];
      for (const field of ['jersey', 'pants', 'helmet', 'number', 'trim', 'mask', 'sock']) {
        assert.match(kit[field], /^#[0-9a-f]{6}$/i, `${id} ${side} ${field}`);
      }
    }
  }
});

test('Bengals away and Ravens home kits match the required primary uniforms', () => {
  const kits = kitsForMatchup('BAL', 'CIN', 'seed-1042');
  assert.equal(kits.BAL.jersey, '#241773');
  assert.equal(kits.CIN.jersey, '#f4f5f2');
  assert.equal(kits.CIN.number, '#fb4f14');
  assert.equal(kits.BAL.seed, 'seed-1042');
  assert.equal(kits.CIN.seed, 'seed-1042');
});

 test('kit selection is explicit about side and does not mutate the shared definitions', () => {
  const home = kitsForMatchup('CIN', 'BAL', 'a');
  const away = kitsForMatchup('BAL', 'CIN', 'b');
  assert.equal(home.CIN.jersey, WEEK7_TEAM_KITS.CIN.home.jersey);
  assert.equal(away.CIN.jersey, WEEK7_TEAM_KITS.CIN.away.jersey);
  assert.notEqual(home.CIN.jersey, away.CIN.jersey);
  assert.equal(WEEK7_TEAM_KITS.CIN.home.seed, undefined);
});

test('non-Week-7 renderers retain the existing generic home/away kit fallback', () => {
  const kits = kitsForGame('DEN', 'SEA', {
    DEN: { color: '#0a2343', alt: '#fc4c02' },
    SEA: { color: '#002a5c', alt: '#69be28' },
  }, 'fixture-seed');
  assert.equal(kits.DEN.jersey, '#fc4c02');
  assert.equal(kits.SEA.jersey, '#f4f5f2');
  assert.equal(kits.SEA.number, '#002a5c');
  assert.equal(kits.SEA.sock, '#002a5c');
  assert.equal(kits.DEN.sock, '#0a2343');
  assert.equal(kits.SEA.seed, 'fixture-seed');
});
