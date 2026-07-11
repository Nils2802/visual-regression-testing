import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch().then((b) => {
      browser = b;
      launching = null;
      return b;
    });
  }
  return launching;
}

export async function closeBrowser(): Promise<void> {
  const b = browser ?? (launching ? await launching : null);
  browser = null;
  launching = null;
  if (b) await b.close();
}
