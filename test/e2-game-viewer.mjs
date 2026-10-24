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
for (let attempt = 0; attempt < 300 && get('load-error')?.hidden !== false; attempt += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
}

assert.equal(get('load-error').hidden, false, `the pinned source must hard-reject its drive-index defect: ${get('load-error').textContent}`);
assert.match(get('load-error').textContent, /23 drive-index mismatches/);
assert.equal(get('viewer-content').hidden, true, 'the rejected record must not render as a navigable game');
assert.match(get('e3-clock-caveat').textContent, /594 \/ 7016/);
assert.match(get('e3-unsupported-list').textContent, /timeouts/);
assert.match(get('conversion-source-status').textContent, /EPA-positive success/);
assert.match(get('state-audit-summary').textContent, /1175 findings/);
assert.equal(get('e3-play-table').querySelectorAll('tr').length, 5);
assert.equal(get('e3-drive-table').querySelectorAll('tr').length, 6);
assert.equal(get('e3-game-table').querySelectorAll('tr').length, 14);

console.log('E2 viewer DOM audit: pinned record rejected with 23 drive-index findings; E3 diagnostics and caveats rendered');
