import { describe, expect, it } from 'vitest';
import { nextRetryDelay } from '@/lib/sse-retry';

describe('nextRetryDelay', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect(nextRetryDelay(0)).toBe(1000);
    expect(nextRetryDelay(1)).toBe(2000);
    expect(nextRetryDelay(4)).toBe(16000);
    expect(nextRetryDelay(5)).toBe(30000);
    expect(nextRetryDelay(50)).toBe(30000);
  });
});
