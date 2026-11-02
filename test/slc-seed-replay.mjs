import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const seedManifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/min-det-realism/MANIFEST.json'), 'utf8'));
const shortlist = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/min-det-realism/marketing-seeds.json'), 'utf8'));
const record = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/min-det-realism/games/seed-3397.json'), 'utf8')).record;
const playCount = record.drives.reduce((sum, drive) => sum + drive.plays.length, 0);

class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toLowerCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.hidden = false;
    this.value = '';
    this.classList = { toggle() {} };
    this._text = '';
  }
  set textContent(value) { this._text = value == null ? '' : String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  append(...nodes) {
    for (const node of nodes) {
      this.children.push(node);
      if (this.tagName === 'select' && !this.value && node.value) this.value = node.value;
    }
  }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => { for (const child of node.children) { if (selector === child.tagName) matches.push(child); visit(child); } };
    visit(this);
    return matches;
  }
}

const nodes = new Map();
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.document = {
  querySelector(selector) {
    if (!nodes.has(selector)) {
      const node = new FakeNode();
      if (['#load-error', '#validation', '#viewer-content', '#e3-comparison'].includes(selector)) node.hidden = true;
      nodes.set(selector, node);
    }
    return nodes.get(selector);
  },
  createElement(tag) { return new FakeNode(tag); },
};
globalThis.window = { location: { search: '?playlist=featured&playlistIndex=0&autoplay=1', href: '' } };
globalThis.fetch = async (url) => {
  const bytes = await readFile(resolve(root, String(url)));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => JSON.parse(bytes.toString('utf8')),
  };
};

let ticker;
let nextTimer;
let intervalId = 0;
globalThis.setInterval = (callback) => { ticker = callback; return ++intervalId; };
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { nextTimer = callback; return 1; };

await import('../web/e2-game-viewer.js');
const get = (id) => nodes.get(`#${id}`);
for (let attempt = 0; attempt < 300 && get('viewer-content')?.hidden !== false; attempt += 1) {
  await new Promise((resolveWait) => realSetTimeout(resolveWait, 10));
}

assert.equal(get('load-error').hidden, true, `seed record should load: ${get('load-error').textContent}`);
assert.equal(get('score-a').textContent, String(record.drives[0].plays[0].state_after.home_score));
assert.match(get('playback-position').textContent, new RegExp(`Game 1 of 5 · Play 1 of ${playCount}`));
assert.equal(get('playback-play').textContent, '❚❚ Pause', 'featured playlist starts when launched');
assert.ok(shortlist.seeds.filter((item) => item.selection !== 'additional_realistic_scenario').length >= 5);

get('playback-next').listeners.click();
assert.match(get('playback-position').textContent, new RegExp(`Play 2 of ${playCount}`));
get('playback-prev').listeners.click();
assert.match(get('playback-position').textContent, new RegExp(`Play 1 of ${playCount}`));
get('playback-play').listeners.click();
for (let index = 0; index < playCount - 1; index += 1) ticker();
assert.match(get('playback-position').textContent, /Game 1 complete/);
assert.equal(typeof nextTimer, 'function', 'finishing a featured game schedules the next one');
nextTimer();
assert.match(window.location.href, /playlist=featured&playlistIndex=1&autoplay=1/);
console.log(`SLC seed playback: seed 3397 steps through ${playCount} plays and advances the five-game playlist`);
