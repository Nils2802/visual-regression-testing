import { describe, it, expect, beforeEach } from 'vitest';
import { saveImage, loadImage } from '@/lib/storage';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('storage', () => {
  beforeEach(async () => {
    process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'vrt-'));
  });

  it('saves and loads a png, returns relative path', async () => {
    const buf = Buffer.from('fake-png');
    const rel = await saveImage('captures', 'abc123', buf);
    expect(rel).toBe('captures/abc123.png');
    const loaded = await loadImage(rel);
    expect(loaded.equals(buf)).toBe(true);
  });

  it('creates nested directories on demand', async () => {
    const rel = await saveImage('diffs', 'r1', Buffer.from('x'));
    const full = path.join(process.env.DATA_DIR!, rel);
    await expect(fs.stat(full)).resolves.toBeTruthy();
  });
});
