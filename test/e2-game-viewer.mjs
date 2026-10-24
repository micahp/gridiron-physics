import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const fixtureEntry = manifest.fixtures[0];
const sourceRecord = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.upstream_source_file), 'utf8')).record;

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
      if (selector === '#load-error' || selector === '#validation') node.hidden = true;
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
for (let attempt = 0; attempt < 100 && !get('record-status')?.textContent.includes('complete_regulation'); attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
}

assert.equal(get('load-error').hidden, true, `the pinned full-game payload must load: ${get('load-error').textContent}`);
assert.match(get('record-status').textContent, /complete_regulation/);
assert.equal(get('drive-select').children.length, 24, 'all source drives must be navigable');
assert.match(get('record-meta').textContent, /5fcaa6bc3ab92ab54cb584511f5205a2e1b4be0f/);
assert.match(get('validation').textContent, /NOT CONFORMING/,
  'the E2 payload must remain visibly outside shared pregame v1');
assert.match(get('validation').textContent, /Drive 24: source play state uses drive_index 1\/1/,
  'the final LP drive-index finding must be visible');

const driveSelect = get('drive-select');
driveSelect.value = '23';
driveSelect.listeners.change();
assert.match(get('drive-summary').textContent, /Drive 24/);
assert.equal(get('play-select').children.length, sourceRecord.drives.at(-1).plays.length,
  'the final drive must expose every source play');
get('play-select').value = String(sourceRecord.drives.at(-1).plays.length - 1);
get('play-select').onchange();
assert.match(get('play-meta').textContent, /24 \/ 144/,
  'the viewer must reach the final source play without renumbering');

console.log('E2 drive viewer DOM render: 24 drives and 144 plays navigable; pinned LP source verified');
