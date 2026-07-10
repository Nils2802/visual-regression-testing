import { describe, it, expect } from 'vitest';
import { enqueue } from '@/lib/queue';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('enqueue', () => {
  it('runs jobs strictly sequentially in FIFO order', async () => {
    const order: number[] = [];
    const p1 = enqueue(async () => {
      await sleep(100);
      order.push(1);
    });
    const p2 = enqueue(async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('a failing job does not block the next one', async () => {
    const order: string[] = [];
    const p1 = enqueue(async () => {
      throw new Error('boom');
    });
    const p2 = enqueue(async () => {
      order.push('ran');
    });
    await expect(p1).rejects.toThrow('boom');
    await p2;
    expect(order).toEqual(['ran']);
  });
});
