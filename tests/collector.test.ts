import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser } from 'playwright';
import { attachCollector } from '@/lib/collector';
import { startFixtureServer, FixtureServer } from './fixtures/server';

let browser: Browser;
let server: FixtureServer;

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({
    '/noisy': `<html><body>
      <script>
        console.error('boom');
        console.warn('deprecated');
        fetch('/missing');
        setTimeout(() => { throw new Error('uncaught!'); }, 0);
      </script>
    </body></html>`,
    '/quiet': '<html><body><p>fine</p></body></html>',
  });
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('attachCollector', () => {
  it('collects console errors, warnings, page errors, and http errors', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.goto(`${server.url}/noisy`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    const entries = collector.entries();
    const types = entries.map((e) => e.type);
    expect(types).toContain('console-error');
    expect(types).toContain('console-warning');
    expect(types).toContain('page-error');
    expect(types).toContain('http-error');
    const httpError = entries.find((e) => e.type === 'http-error')!;
    expect(httpError.httpStatus).toBe(404);
    expect(httpError.url).toContain('/missing');
    const pageError = entries.find((e) => e.type === 'page-error')!;
    expect(pageError.message).toContain('uncaught!');
    expect(pageError.stack).toBeTruthy();
    await page.close();
  });

  it('collects network errors on aborted requests', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.route('**/blocked', (route) => route.abort('connectionrefused'));
    await page.goto(`${server.url}/quiet`);
    await page.evaluate(() => fetch('/blocked').catch(() => {}));
    await page.waitForTimeout(200);
    expect(collector.entries().some((e) => e.type === 'network-error')).toBe(true);
    await page.close();
  });

  it('collects nothing on a quiet page', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.goto(`${server.url}/quiet`, { waitUntil: 'networkidle' });
    expect(collector.entries()).toHaveLength(0);
    await page.close();
  });
});
