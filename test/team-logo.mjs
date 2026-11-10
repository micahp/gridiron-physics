import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { teamLogoUrl } from '../web/team-logo.js';

assert.equal(teamLogoUrl('DEN'), 'web/logos/den.png');
assert.equal(teamLogoUrl('WAS'), 'web/logos/wsh.png');
assert.equal(teamLogoUrl(''), '');
// Every team the pages can show has a downloaded file.
for (const abbr of ['ATL', 'BAL', 'KC', 'SEA', 'LA', 'LAC', 'WAS']) {
  const file = teamLogoUrl(abbr).replace('web/logos/', '');
  assert.ok(readdirSync(new URL('../web/logos/', import.meta.url)).includes(file), `${abbr} has ${file}`);
}
console.log('PASS: team logo paths resolve to downloaded files');
