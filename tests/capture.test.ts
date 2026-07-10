import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser } from 'playwright';
import { PNG } from 'pngjs';
import { capturePage } from '@/lib/capture';
import { startFixtureServer, FixtureServer } from './fixtures/server';

let browser: Browser;
let server: FixtureServer;

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({
    '/animated': `<html><body>
      <style>
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #spinner { width: 80px; height: 80px; background: red; animation: spin 0.3s linear infinite; }
      </style>
      <div id="spinner"></div>
      <div id="box" style="width:200px;height:100px;background:blue"></div>
    </body></html>`,
    '/broken': `<html><body><script>console.error('page is broken')</script>ok</body></html>`,
  });
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('capturePage', () => {
  it('two consecutive captures of an animated page are identical', async () => {
    const opts = { url: `${server.url}/animated`, viewport: { width: 800, height: 600 } };
    const a = await capturePage(browser, opts);
    const b = await capturePage(browser, opts);
    expect(a.png.equals(b.png)).toBe(true);
  }, 60000);

  it('element-scoped capture shots only the element', async () => {
    const result = await capturePage(browser, {
      url: `${server.url}/animated`,
      viewport: { width: 800, height: 600 },
      elementSelector: '#box',
    });
    const png = PNG.sync.read(result.png);
    expect(png.width).toBe(200);
    expect(png.height).toBe(100);
  });

  it('masked element is covered (mask color, not red)', async () => {
    const masked = await capturePage(browser, {
      url: `${server.url}/animated`,
      viewport: { width: 800, height: 600 },
      maskSelectors: ['#spinner'],
    });
    const png = PNG.sync.read(masked.png);
    // pixel inside spinner area (10,10) must not be the element's red
    const idx = (10 * png.width + 10) * 4;
    const isRed = png.data[idx] > 200 && png.data[idx + 1] < 50 && png.data[idx + 2] < 50;
    expect(isRed).toBe(false);
  });

  it('returns collected log entries alongside the png', async () => {
    const result = await capturePage(browser, {
      url: `${server.url}/broken`,
      viewport: { width: 800, height: 600 },
    });
    expect(result.entries.some((e) => e.type === 'console-error')).toBe(true);
  });
});
