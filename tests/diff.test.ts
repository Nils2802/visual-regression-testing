import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { diffImages } from '@/lib/diff';

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('diffImages', () => {
  it('identical images → ratio 0, no size mismatch', async () => {
    const a = solidPng(100, 100, [255, 0, 0]);
    const result = await diffImages(a, solidPng(100, 100, [255, 0, 0]));
    expect(result.ratio).toBe(0);
    expect(result.sizeMismatch).toBe(false);
  });

  it('completely different images → ratio 1', async () => {
    const result = await diffImages(
      solidPng(100, 100, [255, 0, 0]),
      solidPng(100, 100, [0, 0, 255])
    );
    expect(result.ratio).toBe(1);
  });

  it('different width → scales capture to baseline width, flags mismatch', async () => {
    const result = await diffImages(
      solidPng(100, 100, [255, 0, 0]),
      solidPng(200, 200, [255, 0, 0])
    );
    expect(result.sizeMismatch).toBe(true);
    expect(result.ratio).toBeLessThan(0.05); // same color, scaling artifacts only
  });

  it('different height → pads shorter, padding counts as diff', async () => {
    const result = await diffImages(
      solidPng(100, 100, [255, 0, 0]),
      solidPng(100, 150, [255, 0, 0])
    );
    expect(result.sizeMismatch).toBe(true);
    expect(result.ratio).toBeGreaterThan(0.2); // ~50 rows of 150 are padding

    // both inputs get padded up to the taller height, so the diff output
    // dimensions reflect max(baseline.height, capture.height), not the
    // (shorter) baseline height.
    const png = PNG.sync.read(result.diffPng);
    expect(png.width).toBe(100);
    expect(png.height).toBe(150);
  });

  it('baseline taller than capture → capture is the one padded, diff still at max height', async () => {
    const result = await diffImages(
      solidPng(100, 150, [255, 0, 0]),
      solidPng(100, 100, [255, 0, 0])
    );
    expect(result.sizeMismatch).toBe(true);
    expect(result.ratio).toBeGreaterThan(0.2); // ~50 rows of 150 are padding

    const png = PNG.sync.read(result.diffPng);
    expect(png.width).toBe(100);
    expect(png.height).toBe(150);
  });

  it('produces a diff png with baseline dimensions', async () => {
    const result = await diffImages(
      solidPng(100, 100, [255, 0, 0]),
      solidPng(100, 100, [0, 0, 255])
    );
    const png = PNG.sync.read(result.diffPng);
    expect(png.width).toBe(100);
  });
});
