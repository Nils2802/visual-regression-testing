import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { saveImage } from '@/lib/storage';
import { GET } from '@/app/api/images/[...path]/route';

let prevDataDir: string | undefined;
let dir: string;

beforeAll(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), 'vrt-img-'));
  process.env.DATA_DIR = dir;
});

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  rmSync(dir, { recursive: true, force: true });
});

function ctx(segments: string[]) {
  return { params: Promise.resolve({ path: segments }) };
}

describe('GET /api/images/[...path]', () => {
  it('serves a stored PNG with image/png content type', async () => {
    const png = new PNG({ width: 2, height: 2 });
    const rel = await saveImage('captures', 'img-route-test', PNG.sync.write(png));
    const res = await GET(new Request('http://test.local'), ctx(rel.split('/')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(PNG.sync.read(body).width).toBe(2);
  });

  it('rejects path traversal with 400', async () => {
    const res = await GET(new Request('http://test.local'), ctx(['..', '..', 'etc', 'passwd']));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a missing file', async () => {
    const res = await GET(new Request('http://test.local'), ctx(['captures', 'nope.png']));
    expect(res.status).toBe(404);
  });
});
