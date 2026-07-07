import fs from 'fs/promises';
import path from 'path';

export type ImageKind = 'baselines' | 'captures' | 'diffs' | 'references';

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
}

function resolveWithinDataDir(relPath: string): string {
  const base = path.resolve(dataDir());
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) {
    throw new Error(`Path escapes data directory: ${relPath}`);
  }
  return full;
}

export async function saveImage(kind: ImageKind, id: string, png: Buffer): Promise<string> {
  const rel = path.posix.join(kind, `${id}.png`);
  const full = resolveWithinDataDir(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, png);
  return rel;
}

export async function loadImage(relPath: string): Promise<Buffer> {
  return fs.readFile(resolveWithinDataDir(relPath));
}
