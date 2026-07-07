import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

const PIXEL_THRESHOLD = 0.1; // per-pixel color threshold, NOT the pass/diff ratio threshold

export interface DiffResult {
  ratio: number;
  diffPng: Buffer;
  sizeMismatch: boolean;
}

export async function diffImages(baselinePng: Buffer, capturePng: Buffer): Promise<DiffResult> {
  let base = PNG.sync.read(baselinePng);
  let cap = PNG.sync.read(capturePng);
  let sizeMismatch = false;

  if (cap.width !== base.width) {
    sizeMismatch = true;
    const resized = await sharp(capturePng).resize({ width: base.width }).png().toBuffer();
    cap = PNG.sync.read(resized);
  }
  if (cap.height !== base.height) {
    sizeMismatch = true;
    const height = Math.max(cap.height, base.height);
    base = padToHeight(base, height);
    cap = padToHeight(cap, height);
  }

  const diff = new PNG({ width: base.width, height: base.height });
  const changed = pixelmatch(base.data, cap.data, diff.data, base.width, base.height, {
    threshold: PIXEL_THRESHOLD,
  });

  return {
    ratio: changed / (base.width * base.height),
    diffPng: PNG.sync.write(diff),
    sizeMismatch,
  };
}

function padToHeight(png: PNG, height: number): PNG {
  if (png.height === height) return png;
  const out = new PNG({ width: png.width, height }); // new rows are transparent black → count as diff
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}
