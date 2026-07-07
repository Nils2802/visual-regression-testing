import fs from 'fs/promises';
import path from 'path';

export type ImageKind = 'baselines' | 'captures' | 'diffs' | 'references';

export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
}

export async function saveImage(kind: ImageKind, id: string, png: Buffer): Promise<string> {
  const rel = path.posix.join(kind, `${id}.png`);
  const full = path.join(dataDir(), rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, png);
  return rel;
}

export async function loadImage(relPath: string): Promise<Buffer> {
  return fs.readFile(path.join(dataDir(), relPath));
}
