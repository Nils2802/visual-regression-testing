import type { Page } from 'playwright';

export type LogEntryType =
  | 'console-error'
  | 'console-warning'
  | 'page-error'
  | 'http-error'
  | 'network-error';

export interface CollectedEntry {
  type: LogEntryType;
  message: string;
  url?: string;
  httpStatus?: number;
  stack?: string;
  timestamp: Date;
}

export interface Collector {
  entries(): CollectedEntry[];
}

export function attachCollector(page: Page): Collector {
  const entries: CollectedEntry[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      entries.push({ type: 'console-error', message: msg.text(), url: page.url(), timestamp: new Date() });
    } else if (msg.type() === 'warning') {
      entries.push({ type: 'console-warning', message: msg.text(), url: page.url(), timestamp: new Date() });
    }
  });

  page.on('pageerror', (err) => {
    entries.push({
      type: 'page-error',
      message: err.message,
      stack: err.stack,
      url: page.url(),
      timestamp: new Date(),
    });
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      entries.push({
        type: 'http-error',
        message: `${res.request().method()} ${res.url()} → ${res.status()}`,
        url: res.url(),
        httpStatus: res.status(),
        timestamp: new Date(),
      });
    }
  });

  page.on('requestfailed', (req) => {
    entries.push({
      type: 'network-error',
      message: req.failure()?.errorText ?? 'request failed',
      url: req.url(),
      timestamp: new Date(),
    });
  });

  return { entries: () => [...entries] };
}
