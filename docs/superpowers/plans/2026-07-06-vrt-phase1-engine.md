# VRT Phase 1 — Data Model, Capture/Diff Engine, Log Collector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working VRT engine: Prisma/SQLite data model, Playwright capture with stabilization + element scoping + masking, pixelmatch diffing with size normalization, console/network log collector with ignore rules, sequential run queue — all covered by tests, triggerable via a CLI script.

**Architecture:** Next.js app scaffold hosts everything; phase 1 builds the engine as library modules under `src/lib/` with vitest tests. Runs execute in-process through a sequential promise-chain queue. Images live on disk under `DATA_DIR`; the DB stores paths only. Spec: `docs/superpowers/specs/2026-07-06-vrt-tool-design.md`.

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma + SQLite, Playwright (Chromium), pixelmatch + pngjs, sharp, vitest, tsx.

## Global Constraints

- Node 20+, TypeScript strict mode.
- SQLite via Prisma; images NEVER stored in DB — filesystem under `DATA_DIR` (default `./data`), DB stores relative paths.
- Log entry types exactly: `console-error`, `console-warning`, `page-error`, `http-error`, `network-error`.
- Statuses: `visualStatus` ∈ `pass | diff | fail | new` (`new` = no approved baseline existed; capture auto-becomes pending BaselineVersion). `functionalStatus` ∈ `pass | fail` — fail if ANY non-ignored log entry with `origin='test'`.
- Two thresholds, don't conflate: pixelmatch per-pixel color threshold is fixed at `0.1`; the baseline/project `diffThreshold` is the *diff-pixel ratio* above which `visualStatus='diff'` (default `0.01`).
- Run types: `visual | compare | crawl` (crawl NOT implemented in phase 1 — schema only).
- Sequential processing: one run at a time, captures within a run sequential.
- Git: repo is not initialized yet. Task 1 Step 1 initializes it. All commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Tests use `DATABASE_URL=file:./prisma/test.db` (never the dev db) and a local HTTP fixture server (never external URLs).

---

### Task 1: Project scaffold

**Files:**
- Modify: `package.json` (replace)
- Create: `tsconfig.json` (replace), `next.config.ts`, `vitest.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `.gitignore` (extend)
- Delete: `src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: runnable Next.js app, `npm test` (vitest), `npm run typecheck`.

- [ ] **Step 1: Initialize git and commit existing docs**

```bash
git init
git add docs/ .gitignore package.json tsconfig.json
git commit -m "chore: initial commit with design spec

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Replace package.json and install dependencies**

```json
{
  "name": "visual-regression-testing",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "DATABASE_URL=file:./prisma/test.db vitest run",
    "db:push": "prisma db push"
  }
}
```

```bash
npm install next react react-dom @prisma/client
npm install -D typescript @types/node @types/react @types/react-dom prisma vitest tsx playwright pixelmatch pngjs @types/pngjs sharp
npx playwright install chromium
```

- [ ] **Step 3: Config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

`src/app/layout.tsx`:
```tsx
export const metadata = { title: 'VRT' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main>VRT — dashboard coming in phase 2</main>;
}
```

Delete `src/index.ts`. Append to `.gitignore`:
```
.next/
data/
prisma/*.db
prisma/*.db-journal
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expected: exit 0.
Run: `npm run build` — expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + TypeScript + vitest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Prisma schema + db client

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `tests/global-setup.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 scaffold.
- Produces: `prisma` singleton (`import { prisma } from '@/lib/db'`), all entities from spec section 1.

- [ ] **Step 1: Write schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Project {
  id            String        @id @default(cuid())
  name          String
  figmaToken    String? // encrypted at rest (encryption in phase 4)
  diffThreshold Float         @default(0.01)
  crawlStartUrls String       @default("[]") // JSON string[]
  crawlMaxDepth Int           @default(3)
  crawlMaxPages Int           @default(50)
  crawlDenylist String        @default("[\"logout\",\"delete\",\"remove\",\"sign out\"]") // JSON string[]
  createdAt     DateTime      @default(now())
  environments  Environment[]
  viewports     Viewport[]
  baselines     Baseline[]
  runs          Run[]
  ignoreRules   IgnoreRule[]
  apiTokens     ApiToken[]
}

model Environment {
  id        String  @id @default(cuid())
  projectId String
  name      String
  baseUrl   String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  runs      Run[]   @relation("testEnv")
}

model Viewport {
  id        String           @id @default(cuid())
  projectId String
  name      String
  width     Int
  height    Int
  project   Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  targets   BaselineTarget[]
  results   RunResult[]
}

model Baseline {
  id              String           @id @default(cuid())
  projectId       String
  name            String
  pagePath        String // joined with environment baseUrl at run time
  elementSelector String? // element-scoped baseline when set
  diffThreshold   Float? // overrides project default
  maskSelectors   String           @default("[]") // JSON string[]
  sourceType      String // figma | upload | capture
  syncStatus      String           @default("ok") // ok | sync-error
  createdAt       DateTime         @default(now())
  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  targets         BaselineTarget[]
  results         RunResult[]
}

model BaselineTarget {
  id           String            @id @default(cuid())
  baselineId   String
  viewportId   String
  figmaFileKey String?
  figmaNodeId  String?
  baseline     Baseline          @relation(fields: [baselineId], references: [id], onDelete: Cascade)
  viewport     Viewport          @relation(fields: [viewportId], references: [id], onDelete: Cascade)
  versions     BaselineVersion[]

  @@unique([baselineId, viewportId])
}

model BaselineVersion {
  id        String         @id @default(cuid())
  targetId  String
  imagePath String
  status    String         @default("pending") // pending | approved | rejected
  isActive  Boolean        @default(false) // exactly one active approved version per target
  createdAt DateTime       @default(now())
  target    BaselineTarget @relation(fields: [targetId], references: [id], onDelete: Cascade)
}

model Run {
  id                     String        @id @default(cuid())
  projectId              String
  environmentId          String
  referenceEnvironmentId String? // compare runs only
  type                   String        @default("visual") // visual | compare | crawl
  trigger                String // manual | schedule | api
  status                 String        @default("queued") // queued | running | done | failed
  viewportIds            String        @default("[]") // JSON string[]; empty = all project viewports
  error                  String?
  createdAt              DateTime      @default(now())
  startedAt              DateTime?
  finishedAt             DateTime?
  project                Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  environment            Environment   @relation("testEnv", fields: [environmentId], references: [id], onDelete: Cascade)
  results                RunResult[]
  crawlActions           CrawlAction[]
}

model RunResult {
  id                 String     @id @default(cuid())
  runId              String
  baselineId         String
  viewportId         String
  captureImagePath   String?
  referenceImagePath String? // compare runs
  diffImagePath      String?
  visualStatus       String? // pass | diff | fail | new
  functionalStatus   String? // pass | fail
  diffRatio          Float?
  sizeMismatch       Boolean    @default(false)
  error              String?
  run                Run        @relation(fields: [runId], references: [id], onDelete: Cascade)
  baseline           Baseline   @relation(fields: [baselineId], references: [id], onDelete: Cascade)
  viewport           Viewport   @relation(fields: [viewportId], references: [id], onDelete: Cascade)
  logEntries         LogEntry[]
}

model LogEntry {
  id            String       @id @default(cuid())
  resultId      String?
  crawlActionId String?
  type          String // console-error | console-warning | page-error | http-error | network-error
  origin        String       @default("test") // test | reference
  message       String
  url           String?
  httpStatus    Int?
  stack         String?
  ignored       Boolean      @default(false)
  ignoreRuleId  String?
  timestamp     DateTime     @default(now())
  result        RunResult?   @relation(fields: [resultId], references: [id], onDelete: Cascade)
  crawlAction   CrawlAction? @relation(fields: [crawlActionId], references: [id], onDelete: Cascade)
}

model IgnoreRule {
  id             String  @id @default(cuid())
  projectId      String
  entryType      String? // restrict to one log entry type
  urlPattern     String? // regex
  messagePattern String? // regex
  reason         String
  project        Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model CrawlAction {
  id              String     @id @default(cuid())
  runId           String
  pageUrl         String
  elementSelector String
  elementText     String
  action          String
  resultUrl       String?
  timestamp       DateTime   @default(now())
  run             Run        @relation(fields: [runId], references: [id], onDelete: Cascade)
  logEntries      LogEntry[]
}

model ApiToken {
  id         String    @id @default(cuid())
  projectId  String
  name       String
  tokenHash  String
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  project    Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: db client + test setup**

`src/lib/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

`tests/global-setup.ts`:
```ts
import { execSync } from 'child_process';

export default function setup() {
  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./prisma/test.db' },
  });
}
```

- [ ] **Step 3: Write the failing test**

`tests/schema.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('schema', () => {
  beforeAll(async () => {
    await prisma.project.deleteMany();
  });

  it('creates project → viewport → baseline → target → version graph', async () => {
    const project = await prisma.project.create({ data: { name: 'demo' } });
    const viewport = await prisma.viewport.create({
      data: { projectId: project.id, name: 'desktop', width: 1440, height: 900 },
    });
    const baseline = await prisma.baseline.create({
      data: { projectId: project.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });
    const target = await prisma.baselineTarget.create({
      data: { baselineId: baseline.id, viewportId: viewport.id },
    });
    const version = await prisma.baselineVersion.create({
      data: { targetId: target.id, imagePath: 'baselines/x.png', status: 'approved', isActive: true },
    });
    expect(version.isActive).toBe(true);
    expect(project.diffThreshold).toBe(0.01);
  });

  it('enforces one target per baseline+viewport', async () => {
    const project = await prisma.project.create({ data: { name: 'uniq' } });
    const vp = await prisma.viewport.create({
      data: { projectId: project.id, name: 'm', width: 375, height: 812 },
    });
    const b = await prisma.baseline.create({
      data: { projectId: project.id, name: 'p', pagePath: '/p', sourceType: 'upload' },
    });
    await prisma.baselineTarget.create({ data: { baselineId: b.id, viewportId: vp.id } });
    await expect(
      prisma.baselineTarget.create({ data: { baselineId: b.id, viewportId: vp.id } })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- tests/schema.test.ts`
Expected: FAIL (`@prisma/client` not generated / table missing).

- [ ] **Step 5: Generate client, re-run**

Run: `npx prisma generate` then `npm test -- tests/schema.test.ts`
Expected: PASS (global-setup pushes schema to test db).

- [ ] **Step 6: Create dev database**

Run: `DATABASE_URL=file:./prisma/dev.db npx prisma db push`
Add `.env` with `DATABASE_URL="file:./prisma/dev.db"` and add `.env` to `.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/db.ts tests/ .gitignore
git commit -m "feat: Prisma data model for projects, baselines, runs, logs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Image storage module

**Files:**
- Create: `src/lib/storage.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `saveImage(kind: ImageKind, id: string, png: Buffer): Promise<string>` (returns relative path stored in DB), `loadImage(relPath: string): Promise<Buffer>`, `dataDir(): string`. `ImageKind = 'baselines' | 'captures' | 'diffs' | 'references'`.

- [ ] **Step 1: Write the failing test**

`tests/storage.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/storage.test.ts`
Expected: FAIL with "Cannot find module '@/lib/storage'".

- [ ] **Step 3: Implement**

`src/lib/storage.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts tests/storage.test.ts
git commit -m "feat: filesystem image storage under DATA_DIR

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Diff engine

**Files:**
- Create: `src/lib/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `diffImages(baselinePng: Buffer, capturePng: Buffer): Promise<DiffResult>` where `DiffResult = { ratio: number; diffPng: Buffer; sizeMismatch: boolean }`. Ratio = changed pixels / total pixels. Width mismatch → capture scaled to baseline width via sharp; height mismatch → shorter image padded (padding counts as diff). Per-pixel pixelmatch threshold fixed 0.1.

- [ ] **Step 1: Write the failing test**

`tests/diff.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/diff.test.ts`
Expected: FAIL with "Cannot find module '@/lib/diff'".

- [ ] **Step 3: Implement**

`src/lib/diff.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diff.ts tests/diff.test.ts
git commit -m "feat: pixelmatch diff engine with size normalization

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Test fixture server

**Files:**
- Create: `tests/fixtures/server.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `startFixtureServer(pages: Record<string, string>): Promise<FixtureServer>` where `FixtureServer = { url: string; close(): Promise<void> }`. Keys are URL paths, values are HTML bodies. Unknown paths return 404 with plain text. Used by collector, capture, and runner tests.

- [ ] **Step 1: Implement (test infrastructure — verified by its consumers in Tasks 6–9)**

`tests/fixtures/server.ts`:
```ts
import http from 'http';
import { AddressInfo } from 'net';

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

export function startFixtureServer(pages: Record<string, string>): Promise<FixtureServer> {
  const server = http.createServer((req, res) => {
    const html = pages[req.url ?? '/'];
    if (html === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck` — expected: exit 0.

```bash
git add tests/fixtures/server.ts
git commit -m "test: local HTTP fixture server for engine tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Log collector

**Files:**
- Create: `src/lib/collector.ts`
- Test: `tests/collector.test.ts`

**Interfaces:**
- Consumes: `startFixtureServer` (Task 5).
- Produces: `attachCollector(page: Page): Collector` where `Collector = { entries(): CollectedEntry[] }` and `CollectedEntry = { type: LogEntryType; message: string; url?: string; httpStatus?: number; stack?: string; timestamp: Date }`, `LogEntryType = 'console-error' | 'console-warning' | 'page-error' | 'http-error' | 'network-error'`. Must be attached BEFORE `page.goto`.

- [ ] **Step 1: Write the failing test**

`tests/collector.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser } from 'playwright';
import { attachCollector } from '@/lib/collector';
import { startFixtureServer, FixtureServer } from './fixtures/server';

let browser: Browser;
let server: FixtureServer;

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({
    '/noisy': `<html><body>
      <script>
        console.error('boom');
        console.warn('deprecated');
        fetch('/missing');
        setTimeout(() => { throw new Error('uncaught!'); }, 0);
      </script>
    </body></html>`,
    '/quiet': '<html><body><p>fine</p></body></html>',
  });
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('attachCollector', () => {
  it('collects console errors, warnings, page errors, and http errors', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.goto(`${server.url}/noisy`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    const entries = collector.entries();
    const types = entries.map((e) => e.type);
    expect(types).toContain('console-error');
    expect(types).toContain('console-warning');
    expect(types).toContain('page-error');
    expect(types).toContain('http-error');
    const httpError = entries.find((e) => e.type === 'http-error')!;
    expect(httpError.httpStatus).toBe(404);
    expect(httpError.url).toContain('/missing');
    const pageError = entries.find((e) => e.type === 'page-error')!;
    expect(pageError.message).toContain('uncaught!');
    expect(pageError.stack).toBeTruthy();
    await page.close();
  });

  it('collects network errors on aborted requests', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.route('**/blocked', (route) => route.abort('connectionrefused'));
    await page.goto(`${server.url}/quiet`);
    await page.evaluate(() => fetch('/blocked').catch(() => {}));
    await page.waitForTimeout(200);
    expect(collector.entries().some((e) => e.type === 'network-error')).toBe(true);
    await page.close();
  });

  it('collects nothing on a quiet page', async () => {
    const page = await browser.newPage();
    const collector = attachCollector(page);
    await page.goto(`${server.url}/quiet`, { waitUntil: 'networkidle' });
    expect(collector.entries()).toHaveLength(0);
    await page.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/collector.test.ts`
Expected: FAIL with "Cannot find module '@/lib/collector'".

- [ ] **Step 3: Implement**

`src/lib/collector.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/collector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collector.ts tests/collector.test.ts
git commit -m "feat: console/network log collector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Ignore rules + functional status

**Files:**
- Create: `src/lib/ignore.ts`
- Test: `tests/ignore.test.ts`

**Interfaces:**
- Consumes: `CollectedEntry`, `LogEntryType` (Task 6).
- Produces: `applyIgnoreRules(entries: CollectedEntry[], rules: IgnoreRuleInput[]): JudgedEntry[]` where `IgnoreRuleInput = { id: string; entryType?: string | null; urlPattern?: string | null; messagePattern?: string | null }` and `JudgedEntry = CollectedEntry & { ignored: boolean; ignoreRuleId?: string }`; `functionalStatus(entries: JudgedEntry[]): 'pass' | 'fail'`.

- [ ] **Step 1: Write the failing test**

`tests/ignore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyIgnoreRules, functionalStatus } from '@/lib/ignore';
import type { CollectedEntry } from '@/lib/collector';

function entry(overrides: Partial<CollectedEntry>): CollectedEntry {
  return { type: 'console-error', message: 'boom', timestamp: new Date(), ...overrides };
}

describe('applyIgnoreRules', () => {
  it('ignores by message pattern', () => {
    const judged = applyIgnoreRules(
      [entry({ message: 'analytics blocked' }), entry({ message: 'real error' })],
      [{ id: 'r1', messagePattern: 'analytics' }]
    );
    expect(judged[0].ignored).toBe(true);
    expect(judged[0].ignoreRuleId).toBe('r1');
    expect(judged[1].ignored).toBe(false);
  });

  it('ignores by url pattern and entry type combined', () => {
    const judged = applyIgnoreRules(
      [
        entry({ type: 'http-error', url: 'https://tracker.example/ping' }),
        entry({ type: 'network-error', url: 'https://tracker.example/ping' }),
      ],
      [{ id: 'r2', entryType: 'http-error', urlPattern: 'tracker\\.example' }]
    );
    expect(judged[0].ignored).toBe(true);
    expect(judged[1].ignored).toBe(false); // type does not match
  });

  it('rule with no criteria matches nothing', () => {
    const judged = applyIgnoreRules([entry({})], [{ id: 'r3' }]);
    expect(judged[0].ignored).toBe(false);
  });

  it('invalid regex in a rule is skipped, not thrown', () => {
    const judged = applyIgnoreRules([entry({})], [{ id: 'r4', messagePattern: '(' }]);
    expect(judged[0].ignored).toBe(false);
  });
});

describe('functionalStatus', () => {
  it('fails on any non-ignored entry', () => {
    const judged = applyIgnoreRules([entry({})], []);
    expect(functionalStatus(judged)).toBe('fail');
  });

  it('passes when all entries are ignored', () => {
    const judged = applyIgnoreRules([entry({ message: 'noise' })], [{ id: 'r', messagePattern: 'noise' }]);
    expect(functionalStatus(judged)).toBe('pass');
  });

  it('passes with no entries', () => {
    expect(functionalStatus([])).toBe('pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ignore.test.ts`
Expected: FAIL with "Cannot find module '@/lib/ignore'".

- [ ] **Step 3: Implement**

`src/lib/ignore.ts`:
```ts
import type { CollectedEntry } from './collector';

export interface IgnoreRuleInput {
  id: string;
  entryType?: string | null;
  urlPattern?: string | null;
  messagePattern?: string | null;
}

export type JudgedEntry = CollectedEntry & { ignored: boolean; ignoreRuleId?: string };

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matches(entry: CollectedEntry, rule: IgnoreRuleInput): boolean {
  if (!rule.entryType && !rule.urlPattern && !rule.messagePattern) return false;
  if (rule.entryType && rule.entryType !== entry.type) return false;
  if (rule.urlPattern && !(entry.url && safeTest(rule.urlPattern, entry.url))) return false;
  if (rule.messagePattern && !safeTest(rule.messagePattern, entry.message)) return false;
  return true;
}

export function applyIgnoreRules(entries: CollectedEntry[], rules: IgnoreRuleInput[]): JudgedEntry[] {
  return entries.map((entry) => {
    const rule = rules.find((r) => matches(entry, r));
    return { ...entry, ignored: Boolean(rule), ignoreRuleId: rule?.id };
  });
}

export function functionalStatus(entries: JudgedEntry[]): 'pass' | 'fail' {
  return entries.some((e) => !e.ignored) ? 'fail' : 'pass';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ignore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ignore.ts tests/ignore.test.ts
git commit -m "feat: ignore rules and functional status computation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Capture engine

**Files:**
- Create: `src/lib/capture.ts`
- Test: `tests/capture.test.ts`

**Interfaces:**
- Consumes: `attachCollector`, `CollectedEntry` (Task 6); `startFixtureServer` (Task 5).
- Produces: `capturePage(browser: Browser, opts: CaptureOptions): Promise<CaptureOutput>` where `CaptureOptions = { url: string; viewport: { width: number; height: number }; elementSelector?: string | null; maskSelectors?: string[]; settleMs?: number }` and `CaptureOutput = { png: Buffer; entries: CollectedEntry[] }`. Full-page screenshot by default; element-only when `elementSelector` set. Stabilization: reduced motion, animations disabled, network idle + settle delay.

- [ ] **Step 1: Write the failing test**

`tests/capture.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser } from 'playwright';
import { PNG } from 'pngjs';
import { capturePage } from '@/lib/capture';
import { startFixtureServer, FixtureServer } from './fixtures/server';

let browser: Browser;
let server: FixtureServer;

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({
    '/animated': `<html><body>
      <style>
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #spinner { width: 80px; height: 80px; background: red; animation: spin 0.3s linear infinite; }
      </style>
      <div id="spinner"></div>
      <div id="box" style="width:200px;height:100px;background:blue"></div>
    </body></html>`,
    '/broken': `<html><body><script>console.error('page is broken')</script>ok</body></html>`,
  });
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe('capturePage', () => {
  it('two consecutive captures of an animated page are identical', async () => {
    const opts = { url: `${server.url}/animated`, viewport: { width: 800, height: 600 } };
    const a = await capturePage(browser, opts);
    const b = await capturePage(browser, opts);
    expect(a.png.equals(b.png)).toBe(true);
  }, 60000);

  it('element-scoped capture shots only the element', async () => {
    const result = await capturePage(browser, {
      url: `${server.url}/animated`,
      viewport: { width: 800, height: 600 },
      elementSelector: '#box',
    });
    const png = PNG.sync.read(result.png);
    expect(png.width).toBe(200);
    expect(png.height).toBe(100);
  });

  it('masked element is covered (mask color, not red)', async () => {
    const masked = await capturePage(browser, {
      url: `${server.url}/animated`,
      viewport: { width: 800, height: 600 },
      maskSelectors: ['#spinner'],
    });
    const png = PNG.sync.read(masked.png);
    // pixel inside spinner area (10,10) must not be the element's red
    const idx = (10 * png.width + 10) * 4;
    const isRed = png.data[idx] > 200 && png.data[idx + 1] < 50 && png.data[idx + 2] < 50;
    expect(isRed).toBe(false);
  });

  it('returns collected log entries alongside the png', async () => {
    const result = await capturePage(browser, {
      url: `${server.url}/broken`,
      viewport: { width: 800, height: 600 },
    });
    expect(result.entries.some((e) => e.type === 'console-error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/capture.test.ts`
Expected: FAIL with "Cannot find module '@/lib/capture'".

- [ ] **Step 3: Implement**

`src/lib/capture.ts`:
```ts
import type { Browser } from 'playwright';
import { attachCollector, CollectedEntry } from './collector';

export interface CaptureOptions {
  url: string;
  viewport: { width: number; height: number };
  elementSelector?: string | null;
  maskSelectors?: string[];
  settleMs?: number;
}

export interface CaptureOutput {
  png: Buffer;
  entries: CollectedEntry[];
}

const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
`;

export async function capturePage(browser: Browser, opts: CaptureOptions): Promise<CaptureOutput> {
  const context = await browser.newContext({
    viewport: opts.viewport,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    const collector = attachCollector(page);
    await page.goto(opts.url, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: STABILIZE_CSS });
    await page.waitForTimeout(opts.settleMs ?? 250);

    const mask = (opts.maskSelectors ?? []).map((s) => page.locator(s));
    const png = opts.elementSelector
      ? await page.locator(opts.elementSelector).screenshot({ animations: 'disabled', mask })
      : await page.screenshot({ fullPage: true, animations: 'disabled', mask });

    return { png, entries: collector.entries() };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture.ts tests/capture.test.ts
git commit -m "feat: Playwright capture engine with stabilization, element scope, masking

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Run executor

**Files:**
- Create: `src/lib/runner.ts`
- Test: `tests/runner.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `saveImage`/`loadImage` (Task 3), `diffImages` (Task 4), `capturePage` (Task 8), `applyIgnoreRules`/`functionalStatus` (Task 7).
- Produces: `executeRun(runId: string, browser: Browser): Promise<void>`. Behavior:
  - Sets run `running` (+`startedAt`) → `done`/`failed` (+`finishedAt`, `error`).
  - Viewports: parses `run.viewportIds` JSON; empty array = all project viewports.
  - For each baseline × selected viewport with an existing `BaselineTarget`: capture test env at `environment.baseUrl + baseline.pagePath`.
  - `visual` run: baseline image = active approved `BaselineVersion` of the target. None → save capture as new pending version, `visualStatus='new'`, no diff.
  - `compare` run: capture reference environment too; reference image is the baseline for this run only (stored via `saveImage('references', resultId)`), never creates versions. Reference log entries persist with `origin='reference'`, always excluded from functionalStatus.
  - Diff → `diffRatio`; `visualStatus = ratio <= (baseline.diffThreshold ?? project.diffThreshold) ? 'pass' : 'diff'`; `sizeMismatch` copied from diff result.
  - Capture failure for one result → that result `visualStatus='fail'` + `error`, run continues.
  - Test-env entries → `applyIgnoreRules` with project rules → persisted as `LogEntry` rows (`origin='test'`) → `functionalStatus`.

- [ ] **Step 1: Write the failing test**

`tests/runner.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { prisma } from '@/lib/db';
import { executeRun } from '@/lib/runner';
import { startFixtureServer, FixtureServer } from './fixtures/server';

let browser: Browser;
let server: FixtureServer;

const PAGE = '<html><body><div style="width:300px;height:200px;background:green"></div></body></html>';
const NOISY_PAGE = `<html><body><div style="width:300px;height:200px;background:green"></div>
  <script>console.error('kaboom')</script></body></html>`;

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({ '/': PAGE, '/noisy': NOISY_PAGE });
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'vrt-runner-'));
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

async function seed(pagePath = '/') {
  const project = await prisma.project.create({ data: { name: `p-${Date.now()}-${Math.random()}` } });
  const env = await prisma.environment.create({
    data: { projectId: project.id, name: 'test', baseUrl: server.url },
  });
  const viewport = await prisma.viewport.create({
    data: { projectId: project.id, name: 'desktop', width: 800, height: 600 },
  });
  const baseline = await prisma.baseline.create({
    data: { projectId: project.id, name: 'home', pagePath, sourceType: 'capture' },
  });
  await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: viewport.id } });
  return { project, env, viewport, baseline };
}

describe('executeRun — visual', () => {
  it('first run: no approved baseline → status new + pending version created', async () => {
    const { project, env } = await seed();
    const run = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run.id, browser);

    const done = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { results: true } });
    expect(done.status).toBe('done');
    expect(done.results).toHaveLength(1);
    expect(done.results[0].visualStatus).toBe('new');
    expect(done.results[0].functionalStatus).toBe('pass');

    const versions = await prisma.baselineVersion.findMany();
    expect(versions.some((v) => v.status === 'pending')).toBe(true);
  });

  it('second run against approved baseline of same page → pass', async () => {
    const { project, env } = await seed();
    const run1 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run1.id, browser);
    await prisma.baselineVersion.updateMany({ data: { status: 'approved', isActive: true } });

    const run2 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run2.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({ where: { runId: run2.id } });
    expect(result.visualStatus).toBe('pass');
    expect(result.diffRatio).toBeLessThanOrEqual(0.01);
  });

  it('console error on page → functionalStatus fail with persisted log entry', async () => {
    const { project, env } = await seed('/noisy');
    const run = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({
      where: { runId: run.id },
      include: { logEntries: true },
    });
    expect(result.functionalStatus).toBe('fail');
    expect(result.logEntries.some((e) => e.type === 'console-error' && !e.ignored)).toBe(true);
  });

  it('matching ignore rule → functionalStatus pass, entry flagged ignored', async () => {
    const { project, env } = await seed('/noisy');
    await prisma.ignoreRule.create({
      data: { projectId: project.id, messagePattern: 'kaboom', reason: 'known noise' },
    });
    const run = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({
      where: { runId: run.id },
      include: { logEntries: true },
    });
    expect(result.functionalStatus).toBe('pass');
    expect(result.logEntries.every((e) => e.ignored)).toBe(true);
  });

  it('unreachable page → result fail, run still done', async () => {
    const { project, env, baseline } = await seed();
    await prisma.baseline.update({ where: { id: baseline.id }, data: { pagePath: '/nope-timeout' } });
    await prisma.environment.update({ where: { id: env.id }, data: { baseUrl: 'http://127.0.0.1:1' } });
    const run = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run.id, browser);

    const done = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { results: true } });
    expect(done.status).toBe('done');
    expect(done.results[0].visualStatus).toBe('fail');
    expect(done.results[0].error).toBeTruthy();
  });
});

describe('executeRun — compare', () => {
  it('same page on both envs → pass; no baseline versions created', async () => {
    const { project, env } = await seed();
    const refEnv = await prisma.environment.create({
      data: { projectId: project.id, name: 'live', baseUrl: server.url },
    });
    const run = await prisma.run.create({
      data: {
        projectId: project.id,
        environmentId: env.id,
        referenceEnvironmentId: refEnv.id,
        type: 'compare',
        trigger: 'manual',
      },
    });
    await executeRun(run.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({ where: { runId: run.id } });
    expect(result.visualStatus).toBe('pass');
    expect(result.referenceImagePath).toBeTruthy();
    const versions = await prisma.baselineVersion.findMany({
      where: { target: { baseline: { projectId: project.id } } },
    });
    expect(versions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runner.test.ts`
Expected: FAIL with "Cannot find module '@/lib/runner'".

- [ ] **Step 3: Implement**

`src/lib/runner.ts`:
```ts
import type { Browser } from 'playwright';
import { prisma } from './db';
import { capturePage } from './capture';
import { diffImages } from './diff';
import { saveImage, loadImage } from './storage';
import { applyIgnoreRules, functionalStatus, IgnoreRuleInput, JudgedEntry } from './ignore';
import type { CollectedEntry } from './collector';

export async function executeRun(runId: string, browser: Browser): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    include: {
      project: { include: { viewports: true, ignoreRules: true } },
      environment: true,
    },
  });
  const referenceEnv = run.referenceEnvironmentId
    ? await prisma.environment.findUniqueOrThrow({ where: { id: run.referenceEnvironmentId } })
    : null;

  await prisma.run.update({
    where: { id: runId },
    data: { status: 'running', startedAt: new Date() },
  });

  try {
    const selected: string[] = JSON.parse(run.viewportIds);
    const viewports = run.project.viewports.filter(
      (v) => selected.length === 0 || selected.includes(v.id)
    );
    const baselines = await prisma.baseline.findMany({
      where: { projectId: run.projectId },
      include: { targets: { include: { versions: true } } },
    });
    const rules: IgnoreRuleInput[] = run.project.ignoreRules;

    for (const baseline of baselines) {
      for (const viewport of viewports) {
        const target = baseline.targets.find((t) => t.viewportId === viewport.id);
        if (!target) continue; // baseline restricted to a viewport subset

        const result = await prisma.runResult.create({
          data: { runId, baselineId: baseline.id, viewportId: viewport.id },
        });
        try {
          await processResult(browser, {
            runType: run.type,
            resultId: result.id,
            targetId: target.id,
            url: run.environment.baseUrl + baseline.pagePath,
            referenceUrl: referenceEnv ? referenceEnv.baseUrl + baseline.pagePath : null,
            viewport: { width: viewport.width, height: viewport.height },
            elementSelector: baseline.elementSelector,
            maskSelectors: JSON.parse(baseline.maskSelectors) as string[],
            ratioThreshold: baseline.diffThreshold ?? run.project.diffThreshold,
            activeBaselinePath:
              target.versions.find((v) => v.status === 'approved' && v.isActive)?.imagePath ?? null,
            rules,
          });
        } catch (err) {
          await prisma.runResult.update({
            where: { id: result.id },
            data: { visualStatus: 'fail', error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    }

    await prisma.run.update({
      where: { id: runId },
      data: { status: 'done', finishedAt: new Date() },
    });
  } catch (err) {
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

interface ResultJob {
  runType: string;
  resultId: string;
  targetId: string;
  url: string;
  referenceUrl: string | null;
  viewport: { width: number; height: number };
  elementSelector: string | null;
  maskSelectors: string[];
  ratioThreshold: number;
  activeBaselinePath: string | null;
  rules: IgnoreRuleInput[];
}

async function processResult(browser: Browser, job: ResultJob): Promise<void> {
  const capture = await capturePage(browser, {
    url: job.url,
    viewport: job.viewport,
    elementSelector: job.elementSelector,
    maskSelectors: job.maskSelectors,
  });
  const capturePath = await saveImage('captures', job.resultId, capture.png);

  const judged = applyIgnoreRules(capture.entries, job.rules);
  await persistEntries(job.resultId, judged, 'test');
  const funcStatus = functionalStatus(judged);

  let baselinePng: Buffer | null = null;
  let referencePath: string | null = null;

  if (job.runType === 'compare' && job.referenceUrl) {
    const reference = await capturePage(browser, {
      url: job.referenceUrl,
      viewport: job.viewport,
      elementSelector: job.elementSelector,
      maskSelectors: job.maskSelectors,
    });
    referencePath = await saveImage('references', job.resultId, reference.png);
    const refJudged: JudgedEntry[] = reference.entries.map((e: CollectedEntry) => ({
      ...e,
      ignored: false,
    }));
    await persistEntries(job.resultId, refJudged, 'reference');
    baselinePng = reference.png;
  } else if (job.activeBaselinePath) {
    baselinePng = await loadImage(job.activeBaselinePath);
  }

  if (!baselinePng) {
    // no approved baseline: capture becomes a pending version, result is 'new'
    const versionPath = await saveImage('baselines', `${job.targetId}-${Date.now()}`, capture.png);
    await prisma.baselineVersion.create({
      data: { targetId: job.targetId, imagePath: versionPath, status: 'pending' },
    });
    await prisma.runResult.update({
      where: { id: job.resultId },
      data: { captureImagePath: capturePath, visualStatus: 'new', functionalStatus: funcStatus },
    });
    return;
  }

  const diff = await diffImages(baselinePng, capture.png);
  const diffPath = await saveImage('diffs', job.resultId, diff.diffPng);
  await prisma.runResult.update({
    where: { id: job.resultId },
    data: {
      captureImagePath: capturePath,
      referenceImagePath: referencePath,
      diffImagePath: diffPath,
      diffRatio: diff.ratio,
      sizeMismatch: diff.sizeMismatch,
      visualStatus: diff.ratio <= job.ratioThreshold ? 'pass' : 'diff',
      functionalStatus: funcStatus,
    },
  });
}

async function persistEntries(
  resultId: string,
  entries: JudgedEntry[],
  origin: 'test' | 'reference'
): Promise<void> {
  if (entries.length === 0) return;
  await prisma.logEntry.createMany({
    data: entries.map((e) => ({
      resultId,
      type: e.type,
      origin,
      message: e.message,
      url: e.url,
      httpStatus: e.httpStatus,
      stack: e.stack,
      ignored: origin === 'reference' ? true : e.ignored,
      ignoreRuleId: e.ignoreRuleId,
      timestamp: e.timestamp,
    })),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/runner.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/runner.ts tests/runner.test.ts
git commit -m "feat: run executor for visual and compare runs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Sequential queue + CLI trigger

**Files:**
- Create: `src/lib/queue.ts`, `scripts/run.ts`, `scripts/seed.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Consumes: `executeRun` (Task 9), `prisma` (Task 2).
- Produces: `enqueue(job: () => Promise<void>): Promise<void>` — jobs run strictly one at a time in FIFO order; a failing job never blocks the next. CLI: `npx tsx scripts/seed.ts <name> <baseUrl>` creates demo project, `npx tsx scripts/run.ts <projectId>` triggers + awaits a visual run and prints per-result statuses.

- [ ] **Step 1: Write the failing test**

`tests/queue.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/queue.test.ts`
Expected: FAIL with "Cannot find module '@/lib/queue'".

- [ ] **Step 3: Implement**

`src/lib/queue.ts`:
```ts
let chain: Promise<unknown> = Promise.resolve();

export function enqueue(job: () => Promise<void>): Promise<void> {
  const next = chain.then(() => job());
  chain = next.catch(() => {}); // swallow for the chain only; caller still sees the rejection
  return next;
}
```

`scripts/seed.ts`:
```ts
import { prisma } from '../src/lib/db';

async function main() {
  const [name, baseUrl] = process.argv.slice(2);
  if (!name || !baseUrl) {
    console.error('usage: npx tsx scripts/seed.ts <name> <baseUrl>');
    process.exit(1);
  }
  const project = await prisma.project.create({ data: { name } });
  await prisma.environment.create({ data: { projectId: project.id, name: 'default', baseUrl } });
  const viewports = await Promise.all([
    prisma.viewport.create({ data: { projectId: project.id, name: 'mobile', width: 375, height: 812 } }),
    prisma.viewport.create({ data: { projectId: project.id, name: 'desktop', width: 1440, height: 900 } }),
  ]);
  const baseline = await prisma.baseline.create({
    data: { projectId: project.id, name: 'home', pagePath: '/', sourceType: 'capture' },
  });
  for (const vp of viewports) {
    await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: vp.id } });
  }
  console.log(`project ${project.id} seeded (2 viewports, baseline "home" → /)`);
}

main().finally(() => prisma.$disconnect());
```

`scripts/run.ts`:
```ts
import { chromium } from 'playwright';
import { prisma } from '../src/lib/db';
import { executeRun } from '../src/lib/runner';
import { enqueue } from '../src/lib/queue';

async function main() {
  const [projectId] = process.argv.slice(2);
  if (!projectId) {
    console.error('usage: npx tsx scripts/run.ts <projectId>');
    process.exit(1);
  }
  const env = await prisma.environment.findFirstOrThrow({ where: { projectId } });
  const run = await prisma.run.create({
    data: { projectId, environmentId: env.id, type: 'visual', trigger: 'manual' },
  });
  const browser = await chromium.launch();
  await enqueue(() => executeRun(run.id, browser));
  await browser.close();

  const done = await prisma.run.findUniqueOrThrow({
    where: { id: run.id },
    include: { results: { include: { baseline: true, viewport: true, logEntries: true } } },
  });
  console.log(`run ${done.id}: ${done.status}`);
  for (const r of done.results) {
    const logs = r.logEntries.filter((e) => !e.ignored).length;
    console.log(
      `  ${r.baseline.name} @ ${r.viewport.name}: visual=${r.visualStatus} functional=${r.functionalStatus} (${logs} log entries)`
    );
  }
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: End-to-end smoke test**

```bash
npx tsx scripts/seed.ts demo https://example.com
npx tsx scripts/run.ts <printed-project-id>
```
Expected output shape:
```
run <id>: done
  home @ mobile: visual=new functional=pass (0 log entries)
  home @ desktop: visual=new functional=pass (0 log entries)
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test` — expected: all files pass.
Run: `npm run typecheck` — expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queue.ts scripts/ tests/queue.test.ts
git commit -m "feat: sequential run queue and CLI trigger scripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of scope for this plan (later plans)

- Dashboard UI, approval flow UI, SSE progress (spec section 5)
- Figma sync (spec section 4)
- Scheduling, API tokens, admin auth, Docker packaging (spec section 6)
- Functional crawl mode (spec section 3b)
