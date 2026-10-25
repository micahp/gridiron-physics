import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const viewerHtml = await readFile(resolve(root, 'e2-game-viewer.html'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const fixtureEntry = manifest.fixtures[0];
const currentEnvelope = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.file), 'utf8'));
const sourceRecord = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.upstream_source_file), 'utf8')).record;
const playCount = sourceRecord.drives.reduce((sum, drive) => sum + drive.plays.length, 0);
const pregameManifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/pregame/MANIFEST.json'), 'utf8'));
const pregameEntry = pregameManifest.fixtures[0];
const pregamePayload = JSON.parse(await readFile(resolve(root, 'docs/fixtures/pregame', pregameEntry.file), 'utf8'));
const pregamePlayCount = pregamePayload.record.drives.reduce((sum, drive) => sum + drive.plays.length, 0);
const pregameBlockedPlays = pregamePayload.record.drives.flatMap((drive) => drive.plays)
  .filter((play) => ['blocked_punt', 'blocked_field_goal'].includes(play.event_type));

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toLowerCase();
    this.children = [];
    this.hidden = false;
    this.value = '';
    this.listeners = {};
    this.attributes = {};
    this._text = '';
    this.classList = {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
    };
  }

  set textContent(value) {
    this._text = value == null ? '' : String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
      if (this.tagName === 'select' && !this.value && node.value) this.value = node.value;
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    if (this.tagName === 'select') this.value = '';
    this.append(...nodes);
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === child.tagName) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

const nodes = new Map();
globalThis.document = {
  querySelector(selector) {
    assert.match(selector, /^#[\w-]+$/);
    if (!nodes.has(selector)) {
      const node = new FakeNode();
      if (selector === '#load-error' || selector === '#validation' || selector === '#viewer-content'
          || selector === '#e3-comparison') node.hidden = true;
      nodes.set(selector, node);
    }
    return nodes.get(selector);
  },
  createElement(tag) {
    return new FakeNode(tag);
  },
};
globalThis.fetch = async (url) => {
  const path = resolve(root, String(url));
  const bytes = await readFile(path);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => JSON.parse(bytes.toString('utf8')),
  };
};

await import('../web/e2-game-viewer.js');
const get = (id) => nodes.get(`#${id}`);
for (let attempt = 0; attempt < 300 && get('viewer-content')?.hidden !== false; attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
}

assert.equal(get('load-error').hidden, true, `the final LP source should load: ${get('load-error').textContent}`);
assert.equal(get('viewer-content').hidden, false, 'the final pinned record must render as a navigable game');
assert.equal(get('drive-select').children.length, fixtureEntry.drives);
assert.equal(get('play-select').children.length, sourceRecord.drives[0].plays.length);
assert.match(get('record-meta').textContent, new RegExp(String(playCount)));
assert.equal(get('score-a').textContent, String(sourceRecord.points.A));
assert.equal(get('score-b').textContent, String(sourceRecord.points.B));
assert.match(get('state-audit-summary').textContent, /0 findings/);
assert.match(get('e3-clock-caveat').textContent, /594 \/ 7016/);
assert.match(get('e3-lp-clock-status').textContent, /15,768 rows/);
assert.match(get('e3-lp-clock-status').textContent, /9,066 matched/);
assert.match(get('e3-lp-clock-status').textContent, /0 keyed records without an LP source row/);
assert.match(viewerHtml, /LP values labelled unresolvable remain null/);
assert.equal(get('e3-lp-clock-table').querySelectorAll('tr').length, 9);
assert.match(get('e3-unsupported-list').textContent, /timeouts/);
assert.match(get('conversion-source-status').textContent, /PASS/);
assert.match(get('e3-play-table').textContent, new RegExp(`Generated · n=${playCount}`));
assert.equal(get('e3-play-table').querySelectorAll('tr').length, 5);
assert.equal(get('e3-drive-table').querySelectorAll('tr').length, 6);
assert.equal(get('e3-game-table').querySelectorAll('tr').length, 14);

console.log(`E2 viewer DOM audit: LP ${manifest.lp_source.base_commit} loads ${fixtureEntry.drives} drives / ${playCount} plays; E3 clock decomposition and null policy rendered`);

nodes.clear();
globalThis.window = { location: { search: '?pregame=1' } };
await import('../web/e2-game-viewer.js?pregame-acceptance');
for (let attempt = 0; attempt < 300 && get('viewer-content')?.hidden !== false; attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
}
assert.equal(get('load-error').hidden, true, `the pinned pregame game should load: ${get('load-error').textContent}`);
assert.equal(get('viewer-content').hidden, false, 'the complete statistical game should render');
assert.equal(get('drive-select').children.length, pregameEntry.drives ?? pregamePayload.record.drives.length);
assert.equal(get('score-phase').textContent, 'FINAL');
assert.match(get('game-state').textContent, /complete_game=true · valid_full_game=true/);
assert.match(get('producer-note').textContent, /passed the applicable full-game checks/);
assert.match(get('unsupported-list').textContent, /No unsupported rule paths were taken/);
assert.ok(get('capability-limitations').children.length > 0, 'remaining model limitations must stay visible');
assert.equal(get('validation').hidden, true, 'this complete pinned record should pass the viewer audits');
assert.equal(get('player-stats').children.length, pregamePayload.record.stats.player.length);
assert.match(get('record-meta').textContent, new RegExp(String(pregamePlayCount)));
assert.equal(pregameBlockedPlays.length, 1, 'the pinned Chiefs-Seahawks game exercises a real blocked-kick outcome');
const blocked = pregameBlockedPlays[0];
const blockedDriveOffset = pregamePayload.record.drives.findIndex((drive) => drive.plays.includes(blocked));
get('drive-select').value = String(blockedDriveOffset);
get('drive-select').listeners.change();
const blockedPlayOffset = pregamePayload.record.drives[blockedDriveOffset].plays.indexOf(blocked);
get('play-select').value = String(blockedPlayOffset);
get('play-select').onchange();
assert.match(get('play-meta').textContent, /blocked_field_goal/);
assert.match(get('play-json').textContent, /classified_dead_ball_award/);
console.log(`Pregame viewer DOM audit: LP ${pregameManifest.lp_source.base_commit} renders Chiefs at Seahawks as a complete ${pregamePlayCount}-play game and navigates to its blocked field-goal recovery`);
