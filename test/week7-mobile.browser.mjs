// The play view must stay on screen on a phone. Before this test the page
// scrolled itself ~500px on load (scrollIntoView), pushing the field above the
// fold, and the transport controls sat below the viewport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8000';
const GAME = `${BASE}/week7.html?game=2026_07_DAL_PHI&debug=1&seed=1042`;

const CASES = [
  ['iPhone 13', devices['iPhone 13']],
  ['iPhone SE', devices['iPhone SE']],
  ['landscape', { viewport: { width: 750, height: 342 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
];

test('the play view stays on screen on a phone', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, device] of CASES) {
      const context = await browser.newContext({ ...device });
      const page = await context.newPage();
      await page.goto(GAME, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(9000);

      const measure = () => page.evaluate(() => {
        const canvas = document.querySelector('#view');
        const rect = canvas.getBoundingClientRect();
        return {
          scrollY: Math.round(window.scrollY),
          docH: document.documentElement.scrollHeight,
          winH: window.innerHeight,
          canvasTop: Math.round(rect.top),
          canvasH: Math.round(rect.height),
        };
      });

      const load = await measure();
      assert.equal(load.scrollY, 0, `${name}: page scrolled itself on load (${load.scrollY}px)`);
      assert.ok(load.docH <= load.winH + 1, `${name}: document taller than the viewport (${load.docH} > ${load.winH})`);
      assert.ok(load.canvasH >= 120, `${name}: field only ${load.canvasH}px tall`);
      assert.ok(load.canvasTop >= 0, `${name}: field starts above the viewport (${load.canvasTop})`);

      const snap = page.locator('#snap');
      if (await snap.count()) {
        await snap.click();
        await page.waitForTimeout(1200);
        const afterSnap = await measure();
        assert.equal(afterSnap.scrollY, 0, `${name}: snapping scrolled the page to ${afterSnap.scrollY}px`);
        assert.ok(afterSnap.canvasTop >= 0, `${name}: field left the viewport after the snap`);
      }

      await page.evaluate(() => window.scrollBy(0, 400));
      const scrolled = await measure();
      assert.equal(scrolled.scrollY, 0, `${name}: the page can still be scrolled away (${scrolled.scrollY}px)`);

      await context.close();
    }
  } finally {
    await browser.close();
  }
});
