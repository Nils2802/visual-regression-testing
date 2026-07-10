import type { Browser } from 'playwright';
import { attachCollector, CollectedEntry } from './collector';

export interface CaptureOptions {
  url: string;
  viewport: { width: number; height: number };
  elementSelector?: string | null;
  maskSelectors?: string[];
  settleMs?: number;
}

export interface CaptureOutput {
  png: Buffer;
  entries: CollectedEntry[];
}

const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
`;

export async function capturePage(browser: Browser, opts: CaptureOptions): Promise<CaptureOutput> {
  const context = await browser.newContext({
    viewport: opts.viewport,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const collector = attachCollector(page);
    await page.goto(opts.url, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: STABILIZE_CSS });
    await page.waitForTimeout(opts.settleMs ?? 250);

    const mask = (opts.maskSelectors ?? []).map((s) => page.locator(s));
    const png = opts.elementSelector
      ? await page.locator(opts.elementSelector).screenshot({ animations: 'disabled', mask })
      : await page.screenshot({ fullPage: true, animations: 'disabled', mask });

    return { png, entries: collector.entries() };
  } finally {
    await context.close();
  }
}
