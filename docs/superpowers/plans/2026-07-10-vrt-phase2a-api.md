# VRT Phase 2a — REST API, Approval Flow, Uploads, SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full REST backend for the dashboard: CRUD for projects/environments/viewports/baselines, PNG upload → pending version, approval workflow, run trigger + detail API wired to the Phase 1 engine, live run progress via SSE, ignore-rule management with one-click creation — all covered by tests. Phase 2b builds the UI on top.

**Architecture:** Next.js App Router route handlers under `src/app/api/`, thin over service modules in `src/lib/`. The Phase 1 engine (`executeRun`, `enqueue`) runs in-process in the Next server via a lazily-launched shared Chromium instance. Route handlers are plain `(Request, ctx) → Response` functions, tested directly in vitest against the test DB — no HTTP server needed. Spec: `docs/superpowers/specs/2026-07-06-vrt-tool-design.md` (section 5 + parts of 1).

**Tech Stack:** Next.js 16 (App Router) + TypeScript strict, Prisma + SQLite, zod (new dep), Phase 1 engine modules, vitest.

## Global Constraints

- Node 20+, TypeScript strict mode. `npx tsc --noEmit` must pass after every task.
- SQLite via Prisma; images NEVER stored in DB — filesystem under `DATA_DIR` (default `./data`), DB stores relative paths. All image writes go through `saveImage`, reads through `loadImage` (`src/lib/storage.ts`).
- Log entry types exactly: `console-error`, `console-warning`, `page-error`, `http-error`, `network-error`.
- Statuses: `visualStatus` ∈ `pass | diff | fail | new`; `functionalStatus` ∈ `pass | fail`; run status ∈ `queued | running | done | failed`; version status ∈ `pending | approved | rejected`.
- Exactly one active approved `BaselineVersion` per target; approving deactivates the previous one — always inside a `$transaction`.
- Compare runs never create `BaselineVersion` rows; compare-run results cannot be promoted to baselines.
- Reference-environment log entries: `origin='reference'`, `ignored=false` unless a rule matched — filtering is by `origin`, never by abusing `ignored` (Task 1 fixes the Phase 1 overload).
- Sequential processing: one run at a time via `enqueue` (`src/lib/queue.ts`); the API layer must not await run completion — trigger returns immediately with the queued run.
- API error envelope: `{ "error": string }` with correct HTTP status (400 validation, 404 missing, 409 invalid state transition).
- No auth in this phase (spec build-order stage 5). `trigger` field: dashboard-originated runs use `manual`.
- Tests: `DATABASE_URL=file:./prisma/test.db` (global-setup handles this), local fixture server (`tests/fixtures/server.ts`) only — never external URLs. Route handlers are tested by importing and calling them with `Request` objects; `ctx.params` is a **Promise** in Next 16 route handlers.
- All commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
src/lib/api.ts              — zod body parsing + error envelope helpers
src/lib/browser.ts          — shared Chromium singleton (getBrowser/closeBrowser)
src/lib/run-service.ts      — startRun(): validate → create Run → enqueue executeRun
src/lib/approval.ts         — approveVersion / rejectVersion / promoteResult
src/lib/events.ts           — in-process run-event bus (emit/subscribe per runId)
src/lib/runner.ts           — MODIFIED: emits run events; reference-entry ignored fix
prisma/schema.prisma        — MODIFIED: Run.referenceEnvironment relation
next.config.ts              — MODIFIED: serverExternalPackages
src/app/api/projects/route.ts
src/app/api/projects/[id]/route.ts
src/app/api/projects/[id]/environments/route.ts
src/app/api/environments/[id]/route.ts
src/app/api/projects/[id]/viewports/route.ts
src/app/api/viewports/[id]/route.ts
src/app/api/projects/[id]/baselines/route.ts
src/app/api/baselines/[id]/route.ts
src/app/api/baselines/[id]/targets/[viewportId]/versions/route.ts
src/app/api/versions/[id]/approve/route.ts
src/app/api/versions/[id]/reject/route.ts
src/app/api/results/[id]/promote/route.ts
src/app/api/pending-versions/route.ts
src/app/api/projects/[id]/runs/route.ts
src/app/api/runs/[id]/route.ts
src/app/api/runs/[id]/events/route.ts
src/app/api/projects/[id]/ignore-rules/route.ts
src/app/api/ignore-rules/[id]/route.ts
src/app/api/log-entries/[id]/ignore-rule/route.ts
src/app/api/images/[...path]/route.ts
```

---

### Task 1: Schema relation + reference log-entry semantics

Closes three deferred Phase 1 ledger items while `prisma db push` is still migration-free: the missing `Run.referenceEnvironmentId` FK, the `ignored` flag overload on reference entries, and the unscoped `updateMany` in two old runner tests.

**Files:**
- Modify: `prisma/schema.prisma` (Run + Environment models)
- Modify: `src/lib/runner.ts:184` (persistEntries)
- Modify: `tests/runner.test.ts` (two old `updateMany` call sites; noisy-reference assertion)

**Interfaces:**
- Consumes: existing schema, `persistEntries` internals.
- Produces: `Run.referenceEnvironment: Environment | null` relation (name `"referenceEnv"`, `onDelete: SetNull`) usable via `include`; invariant "reference entries have `ignored=false` unless a rule matched" that Tasks 7/8 and the Phase 2b UI rely on.

- [ ] **Step 1: Update schema — add the relation**

In `prisma/schema.prisma`, replace the `referenceEnvironmentId` line in `model Run` and add the back-relation on `Environment`:

```prisma
model Environment {
  id            String  @id @default(cuid())
  projectId     String
  name          String
  baseUrl       String
  project       Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  runs          Run[]   @relation("testEnv")
  referenceRuns Run[]   @relation("referenceEnv")
}
```

```prisma
  referenceEnvironmentId String? // compare runs only
  referenceEnvironment   Environment? @relation("referenceEnv", fields: [referenceEnvironmentId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: Push schema and regenerate client**

Run: `npm run db:push`
Expected: `Your database is now in sync with your Prisma schema.` (dev.db; test.db is force-reset by global-setup on each test run)

- [ ] **Step 3: Fix the `ignored` overload in persistEntries**

In `src/lib/runner.ts` `persistEntries`, change:

```ts
      ignored: origin === 'reference' ? true : e.ignored,
```

to:

```ts
      ignored: e.ignored,
```

(Reference entries already arrive with `ignored: false` from the mapping at runner.ts:130-133; `functionalStatus` is computed from test entries only, before reference entries are persisted, so behavior of run verdicts is unchanged.)

- [ ] **Step 4: Update the noisy-reference test + retrofit scoped approval helper**

In `tests/runner.test.ts`:
1. The compare-run noisy-reference test currently asserts reference entries are persisted — extend its assertion: reference `console-error` entry has `origin='reference'` AND `ignored === false`.
2. Replace both remaining unscoped `prisma.baselineVersion.updateMany({ where: { status: 'pending' }, data: ... })`-style call sites (see the comment near the scoped helper) with the existing `approveVersionsFor(baselineId)` helper.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/runner.test.ts` then `npm test` and `npm run typecheck`
Expected: all pass (40/40), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/runner.ts tests/runner.test.ts
git commit -m "fix: reference-env FK relation, stop overloading ignored flag on reference entries"
```

---

### Task 2: API utilities + zod + Next server config

**Files:**
- Create: `src/lib/api.ts`
- Modify: `next.config.ts`
- Modify: `package.json` (zod dependency)
- Test: `tests/api-helpers.test.ts`

**Interfaces:**
- Produces: `jsonError(status: number, message: string): Response`; `readJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }>`. Every later API task uses exactly these two.

- [ ] **Step 1: Install zod**

Run: `npm install zod`

- [ ] **Step 2: Write the failing test**

`tests/api-helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonError, readJson } from '@/lib/api';

describe('jsonError', () => {
  it('builds an error envelope with status', async () => {
    const res = jsonError(404, 'project not found');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'project not found' });
  });
});

describe('readJson', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns parsed data for a valid body', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'demo' }),
    });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.name).toBe('demo');
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://test.local', { method: 'POST', body: 'not json' });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.res.status).toBe(400);
      expect((await out.res.json()).error).toContain('invalid JSON');
    }
  });

  it('returns 400 with field detail for schema violations', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.res.status).toBe(400);
      expect((await out.res.json()).error).toContain('name');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api-helpers.test.ts`
Expected: FAIL — cannot resolve `@/lib/api`.

- [ ] **Step 4: Implement `src/lib/api.ts`**

```ts
import { z } from 'zod';

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function readJson<S extends z.ZodTypeAny>(
  req: Request,
  schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: jsonError(400, 'invalid JSON body') };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return { ok: false, res: jsonError(400, detail) };
  }
  return { ok: true, data: parsed.data };
}
```

- [ ] **Step 5: Update `next.config.ts`** (engine deps must not be bundled by the Next server build)

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright', 'sharp', 'pixelmatch', 'pngjs', '@prisma/client'],
};

export default nextConfig;
```

- [ ] **Step 6: Run tests, typecheck, and verify the Next build still works**

Run: `npx vitest run tests/api-helpers.test.ts && npm run typecheck && npm run build`
Expected: tests pass, typecheck clean, `next build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api.ts next.config.ts package.json package-lock.json tests/api-helpers.test.ts
git commit -m "feat: API body-validation helpers and server-external engine packages"
```

---

### Task 3: Image serving route

The dashboard renders baselines/captures/diffs by URL; this route streams files from `DATA_DIR` reusing the traversal-guarded `loadImage`.

**Files:**
- Create: `src/app/api/images/[...path]/route.ts`
- Test: `tests/api-images.test.ts`

**Interfaces:**
- Consumes: `loadImage(relPath)` from `src/lib/storage.ts` (throws `escapes data directory` on traversal, ENOENT on missing).
- Produces: `GET /api/images/<relative/path.png>` → 200 `image/png` body | 400 traversal | 404 missing. Phase 2b `<img src>` uses this.

- [ ] **Step 1: Write the failing test**

`tests/api-images.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-images.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the route**

`src/app/api/images/[...path]/route.ts`:
```ts
import { loadImage } from '@/lib/storage';
import { jsonError } from '@/lib/api';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path: segments } = await ctx.params;
  const rel = segments.join('/');
  try {
    const png = await loadImage(rel);
    return new Response(new Uint8Array(png), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('escapes data directory')) {
      return jsonError(400, 'invalid image path');
    }
    return jsonError(404, 'image not found');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-images.test.ts && npm run typecheck`
Expected: 3/3 pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/images tests/api-images.test.ts
git commit -m "feat: image serving route over DATA_DIR storage"
```

---

### Task 4: Projects, environments, viewports API

**Files:**
- Create: `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/environments/route.ts`, `src/app/api/environments/[id]/route.ts`, `src/app/api/projects/[id]/viewports/route.ts`, `src/app/api/viewports/[id]/route.ts`
- Test: `tests/api-projects.test.ts`

**Interfaces:**
- Consumes: `prisma`, `jsonError`, `readJson`.
- Produces (all JSON):
  - `GET /api/projects` → `{ projects: Array<Project & { lastRun: { id, status, createdAt } | null; failedResultCount: number }> }` (lastRun = newest by createdAt; failedResultCount = results in lastRun with visualStatus in [diff,fail] or functionalStatus fail)
  - `POST /api/projects` body `{ name: string; diffThreshold?: number }` → 201 project
  - `GET /api/projects/:id` → project incl `environments`, `viewports`, `baselines` (with `targets`) | 404
  - `PATCH /api/projects/:id` body `{ name?, diffThreshold? }` → 200 | 404; `DELETE` → 204 | 404
  - `POST /api/projects/:id/environments` body `{ name: string; baseUrl: string (url) }` → 201; `PATCH/DELETE /api/environments/:id`
  - `POST /api/projects/:id/viewports` body `{ name: string; width: int 1..10000; height: int 1..10000 }` → 201 **and creates a BaselineTarget for every existing project baseline**; `PATCH/DELETE /api/viewports/:id`

- [ ] **Step 1: Write the failing test**

`tests/api-projects.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listProjects, POST as createProject } from '@/app/api/projects/route';
import {
  GET as getProject,
  PATCH as patchProject,
  DELETE as deleteProject,
} from '@/app/api/projects/[id]/route';
import { POST as createEnvironment } from '@/app/api/projects/[id]/environments/route';
import { PATCH as patchEnvironment, DELETE as deleteEnvironment } from '@/app/api/environments/[id]/route';
import { POST as createViewport } from '@/app/api/projects/[id]/viewports/route';
import { DELETE as deleteViewport } from '@/app/api/viewports/[id]/route';

function jsonReq(method: string, body: unknown) {
  return new Request('http://test.local', { method, body: JSON.stringify(body) });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('projects API', () => {
  it('creates, lists, patches, deletes a project', async () => {
    const created = await createProject(jsonReq('POST', { name: 'api-proj' }));
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project.name).toBe('api-proj');
    expect(project.diffThreshold).toBe(0.01);

    const list = await (await listProjects()).json();
    const mine = list.projects.find((p: { id: string }) => p.id === project.id);
    expect(mine).toBeDefined();
    expect(mine.lastRun).toBeNull();
    expect(mine.failedResultCount).toBe(0);

    const patched = await patchProject(jsonReq('PATCH', { diffThreshold: 0.05 }), ctx(project.id));
    expect((await patched.json()).diffThreshold).toBe(0.05);

    expect((await deleteProject(new Request('http://test.local'), ctx(project.id))).status).toBe(204);
    expect((await getProject(new Request('http://test.local'), ctx(project.id))).status).toBe(404);
  });

  it('rejects invalid create bodies with 400', async () => {
    expect((await createProject(jsonReq('POST', { name: '' }))).status).toBe(400);
  });

  it('manages environments under a project', async () => {
    const p = await (await createProject(jsonReq('POST', { name: 'env-proj' }))).json();
    const created = await createEnvironment(
      jsonReq('POST', { name: 'staging', baseUrl: 'http://127.0.0.1:9999' }),
      ctx(p.id)
    );
    expect(created.status).toBe(201);
    const env = await created.json();

    const patched = await patchEnvironment(jsonReq('PATCH', { name: 'stage2' }), ctx(env.id));
    expect((await patched.json()).name).toBe('stage2');

    expect((await createEnvironment(jsonReq('POST', { name: 'x', baseUrl: 'not a url' }), ctx(p.id))).status).toBe(400);
    expect((await deleteEnvironment(new Request('http://test.local'), ctx(env.id))).status).toBe(204);
  });

  it('creating a viewport backfills targets for existing baselines', async () => {
    const p = await (await createProject(jsonReq('POST', { name: 'vp-proj' }))).json();
    const baseline = await prisma.baseline.create({
      data: { projectId: p.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });
    const created = await createViewport(
      jsonReq('POST', { name: 'mobile', width: 375, height: 812 }),
      ctx(p.id)
    );
    expect(created.status).toBe(201);
    const vp = await created.json();
    const target = await prisma.baselineTarget.findUnique({
      where: { baselineId_viewportId: { baselineId: baseline.id, viewportId: vp.id } },
    });
    expect(target).not.toBeNull();

    expect((await deleteViewport(new Request('http://test.local'), ctx(vp.id))).status).toBe(204);
  });

  it('404s on unknown ids', async () => {
    expect((await getProject(new Request('http://test.local'), ctx('nope'))).status).toBe(404);
    expect((await patchEnvironment(jsonReq('PATCH', { name: 'x' }), ctx('nope'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-projects.test.ts`
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Implement the routes**

`src/app/api/projects/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  diffThreshold: z.number().gt(0).lt(1).optional(),
});

export async function GET(): Promise<Response> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { results: { select: { visualStatus: true, functionalStatus: true } } },
      },
    },
  });
  return Response.json({
    projects: projects.map(({ runs, ...p }) => {
      const lastRun = runs[0] ?? null;
      const failedResultCount = lastRun
        ? lastRun.results.filter(
            (r) =>
              r.visualStatus === 'diff' ||
              r.visualStatus === 'fail' ||
              r.functionalStatus === 'fail'
          ).length
        : 0;
      return {
        ...p,
        lastRun: lastRun
          ? { id: lastRun.id, status: lastRun.status, createdAt: lastRun.createdAt }
          : null,
        failedResultCount,
      };
    }),
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.create({ data: body.data });
  return Response.json(project, { status: 201 });
}
```

`src/app/api/projects/[id]/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
});

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      environments: true,
      viewports: true,
      baselines: { include: { targets: true } },
    },
  });
  if (!project) return jsonError(404, 'project not found');
  return Response.json(project);
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  const project = await prisma.project.update({ where: { id }, data: body.data });
  return Response.json(project);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  await prisma.project.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
```

`src/app/api/projects/[id]/environments/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const environment = await prisma.environment.create({
    data: { projectId: id, ...body.data },
  });
  return Response.json(environment, { status: 201 });
}
```

`src/app/api/environments/[id]/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'environment not found');
  const environment = await prisma.environment.update({ where: { id }, data: body.data });
  return Response.json(environment);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'environment not found');
  await prisma.environment.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
```

`src/app/api/projects/[id]/viewports/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { baselines: { select: { id: true } } },
  });
  if (!project) return jsonError(404, 'project not found');
  const viewport = await prisma.$transaction(async (tx) => {
    const vp = await tx.viewport.create({ data: { projectId: id, ...body.data } });
    if (project.baselines.length > 0) {
      await tx.baselineTarget.createMany({
        data: project.baselines.map((b) => ({ baselineId: b.id, viewportId: vp.id })),
      });
    }
    return vp;
  });
  return Response.json(viewport, { status: 201 });
}
```

`src/app/api/viewports/[id]/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.viewport.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'viewport not found');
  const viewport = await prisma.viewport.update({ where: { id }, data: body.data });
  return Response.json(viewport);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.viewport.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'viewport not found');
  await prisma.viewport.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-projects.test.ts && npm test && npm run typecheck`
Expected: new tests pass, full suite green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api tests/api-projects.test.ts
git commit -m "feat: projects, environments, viewports REST API"
```

---

### Task 5: Baselines API + PNG upload

**Files:**
- Create: `src/app/api/projects/[id]/baselines/route.ts`, `src/app/api/baselines/[id]/route.ts`, `src/app/api/baselines/[id]/targets/[viewportId]/versions/route.ts`
- Test: `tests/api-baselines.test.ts`

**Interfaces:**
- Consumes: `prisma`, `saveImage`, `jsonError`, `readJson`, `PNG` (pngjs) for upload validation.
- Produces:
  - `POST /api/projects/:id/baselines` body `{ name, pagePath (starts with /), elementSelector?, diffThreshold?, maskSelectors? (string[]), sourceType: 'upload'|'capture', viewportIds? (string[] — subset; default all project viewports) }` → 201 baseline incl targets. Creates one `BaselineTarget` per selected viewport.
  - `GET /api/baselines/:id` → baseline incl targets (each with viewport + versions newest-first) | 404
  - `PATCH /api/baselines/:id` (same optional fields as create minus viewportIds) → 200; `DELETE` → 204
  - `POST /api/baselines/:id/targets/:viewportId/versions` — raw `image/png` request body → validates PNG magic via `PNG.sync.read`, `saveImage('baselines', ...)`, creates **pending** `BaselineVersion` → 201 version | 400 non-PNG | 404 target missing. This is the spec's upload path ("Uploads accept any PNG").

- [ ] **Step 1: Write the failing test**

`tests/api-baselines.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { POST as createBaseline } from '@/app/api/projects/[id]/baselines/route';
import { GET as getBaseline, DELETE as deleteBaseline } from '@/app/api/baselines/[id]/route';
import { POST as uploadVersion } from '@/app/api/baselines/[id]/targets/[viewportId]/versions/route';

let projectId: string;
let vpMobile: string;
let vpDesktop: string;

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'baseline-api-proj',
      viewports: {
        create: [
          { name: 'mobile', width: 375, height: 812 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  vpMobile = project.viewports.find((v) => v.name === 'mobile')!.id;
  vpDesktop = project.viewports.find((v) => v.name === 'desktop')!.id;
});

function jsonReq(body: unknown) {
  return new Request('http://test.local', { method: 'POST', body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const targetCtx = (id: string, viewportId: string) => ({
  params: Promise.resolve({ id, viewportId }),
});

function pngBuffer(width = 4, height = 4): Buffer {
  return PNG.sync.write(new PNG({ width, height }));
}

describe('baselines API', () => {
  it('creates a baseline with targets for all viewports by default', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'home', pagePath: '/', sourceType: 'capture' }),
      ctx(projectId)
    );
    expect(res.status).toBe(201);
    const baseline = await res.json();
    expect(baseline.targets).toHaveLength(2);
  });

  it('respects a viewport subset', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'nav', pagePath: '/nav', sourceType: 'capture', viewportIds: [vpMobile] }),
      ctx(projectId)
    );
    const baseline = await res.json();
    expect(baseline.targets).toHaveLength(1);
    expect(baseline.targets[0].viewportId).toBe(vpMobile);
  });

  it('rejects a pagePath not starting with /', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'bad', pagePath: 'no-slash', sourceType: 'capture' }),
      ctx(projectId)
    );
    expect(res.status).toBe(400);
  });

  it('uploads a PNG as a pending version', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'upload-me', pagePath: '/up', sourceType: 'upload' }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: pngBuffer() }),
      targetCtx(baseline.id, vpDesktop)
    );
    expect(res.status).toBe(201);
    const version = await res.json();
    expect(version.status).toBe('pending');
    expect(version.isActive).toBe(false);
    expect(version.imagePath).toMatch(/^baselines\//);

    const detail = await (await getBaseline(new Request('http://test.local'), ctx(baseline.id))).json();
    const target = detail.targets.find((t: { viewportId: string }) => t.viewportId === vpDesktop);
    expect(target.versions).toHaveLength(1);
  });

  it('rejects non-PNG uploads with 400', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'bad-upload', pagePath: '/bad', sourceType: 'upload' }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: Buffer.from('not a png') }),
      targetCtx(baseline.id, vpDesktop)
    );
    expect(res.status).toBe(400);
  });

  it('404s upload for a missing target and delete cascades', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'gone', pagePath: '/gone', sourceType: 'capture', viewportIds: [vpMobile] }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: pngBuffer() }),
      targetCtx(baseline.id, vpDesktop) // no target for desktop
    );
    expect(res.status).toBe(404);
    expect((await deleteBaseline(new Request('http://test.local'), ctx(baseline.id))).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-baselines.test.ts`
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Implement the routes**

`src/app/api/projects/[id]/baselines/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  pagePath: z.string().startsWith('/'),
  elementSelector: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(['upload', 'capture']),
  viewportIds: z.array(z.string()).nonempty().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { viewports: { select: { id: true } } },
  });
  if (!project) return jsonError(404, 'project not found');

  const { viewportIds, maskSelectors, ...fields } = body.data;
  const projectViewportIds = project.viewports.map((v) => v.id);
  const selected = viewportIds ?? projectViewportIds;
  const unknown = selected.filter((v) => !projectViewportIds.includes(v));
  if (unknown.length > 0) return jsonError(400, `unknown viewport ids: ${unknown.join(', ')}`);
  const baseline = await prisma.baseline.create({
    data: {
      projectId: id,
      ...fields,
      maskSelectors: JSON.stringify(maskSelectors ?? []),
      targets: { create: selected.map((viewportId) => ({ viewportId })) },
    },
    include: { targets: true },
  });
  return Response.json(baseline, { status: 201 });
}
```

`src/app/api/baselines/[id]/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  pagePath: z.string().startsWith('/').optional(),
  elementSelector: z.string().min(1).nullable().optional(),
  diffThreshold: z.number().gt(0).lt(1).nullable().optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
});

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const baseline = await prisma.baseline.findUnique({
    where: { id },
    include: {
      targets: {
        include: { viewport: true, versions: { orderBy: { createdAt: 'desc' } } },
      },
    },
  });
  if (!baseline) return jsonError(404, 'baseline not found');
  return Response.json(baseline);
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  const { maskSelectors, ...fields } = body.data;
  const baseline = await prisma.baseline.update({
    where: { id },
    data: {
      ...fields,
      ...(maskSelectors !== undefined ? { maskSelectors: JSON.stringify(maskSelectors) } : {}),
    },
  });
  return Response.json(baseline);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  await prisma.baseline.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
```

`src/app/api/baselines/[id]/targets/[viewportId]/versions/route.ts`:
```ts
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { saveImage } from '@/lib/storage';
import { jsonError } from '@/lib/api';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; viewportId: string }> }
): Promise<Response> {
  const { id, viewportId } = await ctx.params;
  const target = await prisma.baselineTarget.findUnique({
    where: { baselineId_viewportId: { baselineId: id, viewportId } },
  });
  if (!target) return jsonError(404, 'baseline target not found');

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return jsonError(400, 'empty upload body');
  try {
    PNG.sync.read(buf);
  } catch {
    return jsonError(400, 'body is not a valid PNG');
  }

  const imagePath = await saveImage('baselines', `${target.id}-${Date.now()}`, buf);
  const version = await prisma.baselineVersion.create({
    data: { targetId: target.id, imagePath, status: 'pending' },
  });
  return Response.json(version, { status: 201 });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-baselines.test.ts && npm test && npm run typecheck`
Expected: new tests pass, full suite green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api tests/api-baselines.test.ts
git commit -m "feat: baselines REST API with PNG upload to pending versions"
```

---

### Task 6: Approval service + endpoints

**Files:**
- Create: `src/lib/approval.ts`, `src/app/api/versions/[id]/approve/route.ts`, `src/app/api/versions/[id]/reject/route.ts`, `src/app/api/results/[id]/promote/route.ts`, `src/app/api/pending-versions/route.ts`
- Test: `tests/approval.test.ts`

**Interfaces:**
- Consumes: `prisma`, `loadImage`, `saveImage`.
- Produces (service — the routes are thin wrappers):
  - `approveVersion(versionId: string): Promise<BaselineVersion>` — throws `'version not found'` / `'only pending versions can be approved'`; in one `$transaction` deactivates the target's current `isActive` version and sets this one `status='approved', isActive=true`.
  - `rejectVersion(versionId: string): Promise<BaselineVersion>` — throws same not-found / `'only pending versions can be rejected'`; sets `status='rejected'`.
  - `promoteResult(resultId: string): Promise<BaselineVersion>` — throws `'result not found'` / `'compare-run captures cannot be promoted'` / `'result has no capture image'` / `'no baseline target for this result'`; copies the capture file to a new `baselines/` image and creates a **pending** version on the matching target.
  - Routes: `POST /api/versions/:id/approve` → 200 version | 404 | 409; `POST /api/versions/:id/reject` → same; `POST /api/results/:id/promote` → 201 version | 404 | 409; `GET /api/pending-versions` → `{ versions: Array<version & { target: { viewport, baseline: { name, project: { id, name } } } }> }` newest-first.

- [ ] **Step 1: Write the failing test**

`tests/approval.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { saveImage, loadImage } from '@/lib/storage';
import { approveVersion, rejectVersion, promoteResult } from '@/lib/approval';
import { POST as approveRoute } from '@/app/api/versions/[id]/approve/route';
import { GET as pendingRoute } from '@/app/api/pending-versions/route';

let targetId: string;
let projectId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makePendingVersion(): Promise<string> {
  const png = PNG.sync.write(new PNG({ width: 3, height: 3 }));
  const imagePath = await saveImage('baselines', `appr-${Date.now()}-${Math.random()}`, png);
  const v = await prisma.baselineVersion.create({
    data: { targetId, imagePath, status: 'pending' },
  });
  return v.id;
}

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'approval-proj',
      viewports: { create: [{ name: 'desktop', width: 1440, height: 900 }] },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  const baseline = await prisma.baseline.create({
    data: {
      projectId: project.id,
      name: 'home',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
    include: { targets: true },
  });
  targetId = baseline.targets[0].id;
});

describe('approveVersion', () => {
  it('activates the version and deactivates the previous active one', async () => {
    const first = await makePendingVersion();
    const approved1 = await approveVersion(first);
    expect(approved1.status).toBe('approved');
    expect(approved1.isActive).toBe(true);

    const second = await makePendingVersion();
    await approveVersion(second);

    const all = await prisma.baselineVersion.findMany({ where: { targetId } });
    const active = all.filter((v) => v.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second);
    expect(all.find((v) => v.id === first)!.status).toBe('approved'); // history kept
  });

  it('rejects non-pending versions', async () => {
    const id = await makePendingVersion();
    await approveVersion(id);
    await expect(approveVersion(id)).rejects.toThrow('only pending versions can be approved');
  });
});

describe('rejectVersion', () => {
  it('marks pending as rejected and never activates it', async () => {
    const id = await makePendingVersion();
    const rejected = await rejectVersion(id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.isActive).toBe(false);
  });
});

describe('promoteResult', () => {
  it('copies the capture into a pending version on the matching target', async () => {
    const baseline = await prisma.baselineTarget.findUniqueOrThrow({
      where: { id: targetId },
      include: { baseline: true, viewport: true },
    });
    const env = await prisma.environment.create({
      data: { projectId, name: 'test', baseUrl: 'http://127.0.0.1:1' },
    });
    const run = await prisma.run.create({
      data: { projectId, environmentId: env.id, trigger: 'manual', type: 'visual' },
    });
    const capturePng = PNG.sync.write(new PNG({ width: 5, height: 5 }));
    const capturePath = await saveImage('captures', `promote-${Date.now()}`, capturePng);
    const result = await prisma.runResult.create({
      data: {
        runId: run.id,
        baselineId: baseline.baselineId,
        viewportId: baseline.viewportId,
        captureImagePath: capturePath,
        visualStatus: 'diff',
      },
    });

    const version = await promoteResult(result.id);
    expect(version.status).toBe('pending');
    expect(version.targetId).toBe(targetId);
    expect(version.imagePath).toMatch(/^baselines\//);
    expect(version.imagePath).not.toBe(capturePath); // copied, not aliased
    expect((await loadImage(version.imagePath)).length).toBeGreaterThan(0);
  });

  it('refuses compare-run results', async () => {
    const env = await prisma.environment.create({
      data: { projectId, name: 'ref', baseUrl: 'http://127.0.0.1:1' },
    });
    const run = await prisma.run.create({
      data: {
        projectId,
        environmentId: env.id,
        referenceEnvironmentId: env.id,
        trigger: 'manual',
        type: 'compare',
      },
    });
    const target = await prisma.baselineTarget.findUniqueOrThrow({ where: { id: targetId } });
    const result = await prisma.runResult.create({
      data: {
        runId: run.id,
        baselineId: target.baselineId,
        viewportId: target.viewportId,
        captureImagePath: 'captures/whatever.png',
      },
    });
    await expect(promoteResult(result.id)).rejects.toThrow('compare-run captures cannot be promoted');
  });
});

describe('routes', () => {
  it('approve route returns 409 for non-pending, 404 for unknown', async () => {
    const id = await makePendingVersion();
    await rejectVersion(id);
    expect((await approveRoute(new Request('http://t'), ctx(id))).status).toBe(409);
    expect((await approveRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });

  it('pending-versions lists cross-project queue with baseline and viewport context', async () => {
    const id = await makePendingVersion();
    const res = await pendingRoute();
    const body = await res.json();
    const mine = body.versions.find((v: { id: string }) => v.id === id);
    expect(mine).toBeDefined();
    expect(mine.target.baseline.name).toBe('home');
    expect(mine.target.baseline.project.id).toBe(projectId);
    expect(mine.target.viewport.name).toBe('desktop');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/approval.test.ts`
Expected: FAIL — `@/lib/approval` does not exist.

- [ ] **Step 3: Implement `src/lib/approval.ts`**

```ts
import type { BaselineVersion } from '@prisma/client';
import { prisma } from '@/lib/db';
import { loadImage, saveImage } from '@/lib/storage';

export async function approveVersion(versionId: string): Promise<BaselineVersion> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.baselineVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new Error('version not found');
    if (version.status !== 'pending') throw new Error('only pending versions can be approved');
    await tx.baselineVersion.updateMany({
      where: { targetId: version.targetId, isActive: true },
      data: { isActive: false },
    });
    return tx.baselineVersion.update({
      where: { id: versionId },
      data: { status: 'approved', isActive: true },
    });
  });
}

export async function rejectVersion(versionId: string): Promise<BaselineVersion> {
  const version = await prisma.baselineVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error('version not found');
  if (version.status !== 'pending') throw new Error('only pending versions can be rejected');
  return prisma.baselineVersion.update({
    where: { id: versionId },
    data: { status: 'rejected' },
  });
}

export async function promoteResult(resultId: string): Promise<BaselineVersion> {
  const result = await prisma.runResult.findUnique({
    where: { id: resultId },
    include: { run: { select: { type: true } } },
  });
  if (!result) throw new Error('result not found');
  if (result.run.type === 'compare') throw new Error('compare-run captures cannot be promoted');
  if (!result.captureImagePath) throw new Error('result has no capture image');

  const target = await prisma.baselineTarget.findUnique({
    where: {
      baselineId_viewportId: { baselineId: result.baselineId, viewportId: result.viewportId },
    },
  });
  if (!target) throw new Error('no baseline target for this result');

  const png = await loadImage(result.captureImagePath);
  const imagePath = await saveImage('baselines', `${target.id}-${Date.now()}`, png);
  return prisma.baselineVersion.create({
    data: { targetId: target.id, imagePath, status: 'pending' },
  });
}
```

- [ ] **Step 4: Implement the routes**

`src/app/api/versions/[id]/approve/route.ts`:
```ts
import { approveVersion } from '@/lib/approval';
import { jsonError } from '@/lib/api';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await approveVersion(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'version not found') return jsonError(404, message);
    return jsonError(409, message);
  }
}
```

`src/app/api/versions/[id]/reject/route.ts`:
```ts
import { rejectVersion } from '@/lib/approval';
import { jsonError } from '@/lib/api';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await rejectVersion(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'version not found') return jsonError(404, message);
    return jsonError(409, message);
  }
}
```

`src/app/api/results/[id]/promote/route.ts`:
```ts
import { promoteResult } from '@/lib/approval';
import { jsonError } from '@/lib/api';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await promoteResult(id), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'result not found' || message === 'no baseline target for this result') {
      return jsonError(404, message);
    }
    return jsonError(409, message);
  }
}
```

`src/app/api/pending-versions/route.ts`:
```ts
import { prisma } from '@/lib/db';

export async function GET(): Promise<Response> {
  const versions = await prisma.baselineVersion.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    include: {
      target: {
        include: {
          viewport: true,
          baseline: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return Response.json({ versions });
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/approval.test.ts && npm test && npm run typecheck`
Expected: new tests pass, full suite green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/approval.ts src/app/api tests/approval.test.ts
git commit -m "feat: baseline version approval workflow and capture promotion"
```

---

### Task 7: Browser singleton + run service + runs API

**Files:**
- Create: `src/lib/browser.ts`, `src/lib/run-service.ts`, `src/app/api/projects/[id]/runs/route.ts`, `src/app/api/runs/[id]/route.ts`
- Test: `tests/run-service.test.ts`

**Interfaces:**
- Consumes: `enqueue` (queue.ts), `executeRun` (runner.ts), `prisma`, fixture server (tests).
- Produces:
  - `getBrowser(): Promise<Browser>` — lazily launches one shared Chromium, reused across runs; `closeBrowser(): Promise<void>` for teardown.
  - `startRun(input: { projectId: string; environmentId: string; type?: 'visual' | 'compare'; referenceEnvironmentId?: string; viewportIds?: string[]; trigger?: 'manual' | 'api' }): Promise<Run>` — validates: project exists; environment belongs to project; compare requires `referenceEnvironmentId`, which must belong to the same project (closes Phase 1 deferred minor); viewportIds must all belong to the project. Creates the Run (`status='queued'`), enqueues `executeRun` **without awaiting**, returns the Run row immediately.
  - `POST /api/projects/:id/runs` body `{ environmentId, type?, referenceEnvironmentId?, viewportIds? }` → 201 run | 400/404; `GET /api/projects/:id/runs` → `{ runs }` newest-first incl environment + result-status counts.
  - `GET /api/runs/:id` → run incl environment, referenceEnvironment, results (with baseline name, viewport, logEntries) | 404. Phase 2b run-detail page reads exactly this.

- [ ] **Step 1: Write the failing test**

`tests/run-service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { startRun } from '@/lib/run-service';
import { closeBrowser } from '@/lib/browser';
import { startFixtureServer, FixtureServer } from './fixtures/server';
import { POST as triggerRoute } from '@/app/api/projects/[id]/runs/route';
import { GET as runDetailRoute } from '@/app/api/runs/[id]/route';

let server: FixtureServer;
let projectId: string;
let environmentId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  server = await startFixtureServer({
    '/': '<html><body><h1>run service page</h1></body></html>',
  });
  const project = await prisma.project.create({
    data: {
      name: 'run-service-proj',
      viewports: { create: [{ name: 'desktop', width: 800, height: 600 }] },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  const env = await prisma.environment.create({
    data: { projectId, name: 'test', baseUrl: server.url },
  });
  environmentId = env.id;
  await prisma.baseline.create({
    data: {
      projectId,
      name: 'home',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await server.close();
});

async function waitForTerminal(runId: string): Promise<string> {
  for (let i = 0; i < 120; i++) {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'done' || run.status === 'failed') return run.status;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('run never reached a terminal status');
}

describe('startRun', () => {
  it('returns a queued run immediately, then the engine completes it', async () => {
    const run = await startRun({ projectId, environmentId });
    expect(run.status).toBe('queued');
    expect(run.trigger).toBe('manual');

    expect(await waitForTerminal(run.id)).toBe('done');
    const results = await prisma.runResult.findMany({ where: { runId: run.id } });
    expect(results).toHaveLength(1);
    expect(results[0].visualStatus).toBe('new'); // no approved baseline yet
  });

  it('rejects an environment from another project', async () => {
    const other = await prisma.project.create({ data: { name: 'other-proj' } });
    const foreignEnv = await prisma.environment.create({
      data: { projectId: other.id, name: 'foreign', baseUrl: server.url },
    });
    await expect(startRun({ projectId, environmentId: foreignEnv.id })).rejects.toThrow(
      'environment does not belong to project'
    );
  });

  it('rejects compare without reference and cross-project references', async () => {
    await expect(
      startRun({ projectId, environmentId, type: 'compare' })
    ).rejects.toThrow('compare run requires referenceEnvironmentId');

    const other = await prisma.project.create({ data: { name: 'other-proj-2' } });
    const foreignEnv = await prisma.environment.create({
      data: { projectId: other.id, name: 'foreign2', baseUrl: server.url },
    });
    await expect(
      startRun({ projectId, environmentId, type: 'compare', referenceEnvironmentId: foreignEnv.id })
    ).rejects.toThrow('reference environment does not belong to project');
  });

  it('rejects unknown viewport ids', async () => {
    await expect(
      startRun({ projectId, environmentId, viewportIds: ['nope'] })
    ).rejects.toThrow('unknown viewport ids');
  });
});

describe('runs API', () => {
  it('trigger route returns 201 with the queued run; detail route includes results', async () => {
    const res = await triggerRoute(
      new Request('http://t', { method: 'POST', body: JSON.stringify({ environmentId }) }),
      ctx(projectId)
    );
    expect(res.status).toBe(201);
    const run = await res.json();
    await waitForTerminal(run.id);

    const detail = await (await runDetailRoute(new Request('http://t'), ctx(run.id))).json();
    expect(detail.environment.id).toBe(environmentId);
    expect(detail.results).toHaveLength(1);
    expect(detail.results[0].baseline.name).toBe('home');
    expect(detail.results[0].viewport.name).toBe('desktop');
  });

  it('trigger route 400s bad bodies and 404s unknown projects/runs', async () => {
    expect(
      (await triggerRoute(new Request('http://t', { method: 'POST', body: '{}' }), ctx(projectId))).status
    ).toBe(400);
    expect(
      (
        await triggerRoute(
          new Request('http://t', { method: 'POST', body: JSON.stringify({ environmentId }) }),
          ctx('nope')
        )
      ).status
    ).toBe(404);
    expect((await runDetailRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-service.test.ts`
Expected: FAIL — `@/lib/run-service` does not exist.

- [ ] **Step 3: Implement `src/lib/browser.ts`**

```ts
import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch().then((b) => {
      browser = b;
      launching = null;
      return b;
    });
  }
  return launching;
}

export async function closeBrowser(): Promise<void> {
  const b = browser ?? (launching ? await launching : null);
  browser = null;
  launching = null;
  if (b) await b.close();
}
```

- [ ] **Step 4: Implement `src/lib/run-service.ts`**

```ts
import type { Run } from '@prisma/client';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { executeRun } from '@/lib/runner';
import { getBrowser } from '@/lib/browser';

export interface StartRunInput {
  projectId: string;
  environmentId: string;
  type?: 'visual' | 'compare';
  referenceEnvironmentId?: string;
  viewportIds?: string[];
  trigger?: 'manual' | 'api';
}

export async function startRun(input: StartRunInput): Promise<Run> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { viewports: { select: { id: true } } },
  });
  if (!project) throw new Error('project not found');

  const environment = await prisma.environment.findUnique({ where: { id: input.environmentId } });
  if (!environment || environment.projectId !== project.id) {
    throw new Error('environment does not belong to project');
  }

  const type = input.type ?? 'visual';
  if (type === 'compare') {
    if (!input.referenceEnvironmentId) throw new Error('compare run requires referenceEnvironmentId');
    const reference = await prisma.environment.findUnique({
      where: { id: input.referenceEnvironmentId },
    });
    if (!reference || reference.projectId !== project.id) {
      throw new Error('reference environment does not belong to project');
    }
  }

  const viewportIds = input.viewportIds ?? [];
  const known = project.viewports.map((v) => v.id);
  const unknown = viewportIds.filter((v) => !known.includes(v));
  if (unknown.length > 0) throw new Error(`unknown viewport ids: ${unknown.join(', ')}`);

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      environmentId: environment.id,
      referenceEnvironmentId: type === 'compare' ? input.referenceEnvironmentId : null,
      type,
      trigger: input.trigger ?? 'manual',
      viewportIds: JSON.stringify(viewportIds),
    },
  });

  // Fire and forget: executeRun marks the run failed on its own errors; the
  // catch below only covers enqueue-level failures (e.g. run row deleted
  // before the job starts), which must not surface as unhandled rejections.
  void enqueue(async () => executeRun(run.id, await getBrowser())).catch(() => {});

  return run;
}
```

- [ ] **Step 5: Implement the routes**

`src/app/api/projects/[id]/runs/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';
import { startRun } from '@/lib/run-service';

type Ctx = { params: Promise<{ id: string }> };

const triggerSchema = z.object({
  environmentId: z.string().min(1),
  type: z.enum(['visual', 'compare']).optional(),
  referenceEnvironmentId: z.string().min(1).optional(),
  viewportIds: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, triggerSchema);
  if (!body.ok) return body.res;
  try {
    const run = await startRun({ projectId: id, trigger: 'manual', ...body.data });
    return Response.json(run, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'project not found') return jsonError(404, message);
    return jsonError(400, message);
  }
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const runs = await prisma.run.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      environment: { select: { id: true, name: true } },
      results: { select: { visualStatus: true, functionalStatus: true } },
    },
  });
  return Response.json({
    runs: runs.map(({ results, ...run }) => ({
      ...run,
      resultCount: results.length,
      failedResultCount: results.filter(
        (r) =>
          r.visualStatus === 'diff' || r.visualStatus === 'fail' || r.functionalStatus === 'fail'
      ).length,
    })),
  });
}
```

`src/app/api/runs/[id]/route.ts`:
```ts
import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      environment: true,
      referenceEnvironment: true,
      results: {
        include: {
          baseline: { select: { id: true, name: true, elementSelector: true } },
          viewport: true,
          logEntries: { orderBy: { timestamp: 'asc' } },
        },
      },
    },
  });
  if (!run) return jsonError(404, 'run not found');
  return Response.json(run);
}
```

- [ ] **Step 6: Run tests** (this file launches real Chromium runs — expect ~30s)

Run: `npx vitest run tests/run-service.test.ts && npm test && npm run typecheck`
Expected: new tests pass, full suite green, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/browser.ts src/lib/run-service.ts src/app/api tests/run-service.test.ts
git commit -m "feat: run trigger service with shared browser and runs API"
```

---

### Task 8: Run progress events + SSE endpoint

**Files:**
- Create: `src/lib/events.ts`, `src/app/api/runs/[id]/events/route.ts`
- Modify: `src/lib/runner.ts` (emit events at status changes and per result)
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: `executeRun` internals (emission points), run-service test setup patterns.
- Produces:
  - `type RunEvent = { type: 'status'; status: 'running' | 'done' | 'failed'; error?: string } | { type: 'result'; resultId: string; baselineId: string; viewportId: string; visualStatus: string | null; functionalStatus: string | null }`
  - `emitRunEvent(runId: string, event: RunEvent): void`; `onRunEvent(runId: string, listener: (e: RunEvent) => void): () => void` (returns unsubscribe).
  - `GET /api/runs/:id/events` → `text/event-stream`; on connect replays a `status` snapshot from the DB, then streams live events as `data: <JSON>\n\n`; stream closes after a terminal `status` event (`done`/`failed`); client disconnect unsubscribes. Phase 2b progress bar consumes this.

- [ ] **Step 1: Write the failing test**

`tests/events.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { emitRunEvent, onRunEvent, type RunEvent } from '@/lib/events';
import { startRun } from '@/lib/run-service';
import { closeBrowser } from '@/lib/browser';
import { startFixtureServer, FixtureServer } from './fixtures/server';
import { GET as sseRoute } from '@/app/api/runs/[id]/events/route';

let server: FixtureServer;
let projectId: string;
let environmentId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  server = await startFixtureServer({ '/': '<html><body>events page</body></html>' });
  const project = await prisma.project.create({
    data: {
      name: 'events-proj',
      viewports: { create: [{ name: 'desktop', width: 800, height: 600 }] },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  const env = await prisma.environment.create({
    data: { projectId, name: 'test', baseUrl: server.url },
  });
  environmentId = env.id;
  await prisma.baseline.create({
    data: {
      projectId,
      name: 'home',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
  });
});

afterAll(async () => {
  await closeBrowser();
  await server.close();
});

describe('event bus', () => {
  it('delivers events to subscribers and stops after unsubscribe', () => {
    const seen: RunEvent[] = [];
    const off = onRunEvent('bus-run', (e) => seen.push(e));
    emitRunEvent('bus-run', { type: 'status', status: 'running' });
    off();
    emitRunEvent('bus-run', { type: 'status', status: 'done' });
    expect(seen).toEqual([{ type: 'status', status: 'running' }]);
  });

  it('scopes events by runId', () => {
    const seen: RunEvent[] = [];
    const off = onRunEvent('run-a', (e) => seen.push(e));
    emitRunEvent('run-b', { type: 'status', status: 'done' });
    expect(seen).toHaveLength(0);
    off();
  });
});

describe('runner emission', () => {
  it('emits running, one result event, and a terminal done event', async () => {
    const events: RunEvent[] = [];
    const run = await startRun({ projectId, environmentId });
    const off = onRunEvent(run.id, (e) => events.push(e));
    for (let i = 0; i < 120 && !events.some((e) => e.type === 'status' && e.status !== 'running'); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    off();
    expect(events.some((e) => e.type === 'status' && e.status === 'running')).toBe(true);
    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    if (result && result.type === 'result') expect(result.visualStatus).toBe('new');
    expect(events.at(-1)).toEqual({ type: 'status', status: 'done' });
  });
});

describe('SSE route', () => {
  it('streams events until the terminal status and then closes', async () => {
    const run = await startRun({ projectId, environmentId });
    const res = await sseRoute(new Request('http://t'), ctx(run.id));
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text(); // resolves when the stream closes
    const events = text
      .split('\n\n')
      .filter((chunk) => chunk.startsWith('data: '))
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as RunEvent);
    expect(events.length).toBeGreaterThanOrEqual(2); // snapshot + terminal at minimum
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'done' });
  });

  it('404s for an unknown run', async () => {
    expect((await sseRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/events.test.ts`
Expected: FAIL — `@/lib/events` does not exist.

- [ ] **Step 3: Implement `src/lib/events.ts`**

```ts
import { EventEmitter } from 'node:events';

export type RunEvent =
  | { type: 'status'; status: 'running' | 'done' | 'failed'; error?: string }
  | {
      type: 'result';
      resultId: string;
      baselineId: string;
      viewportId: string;
      visualStatus: string | null;
      functionalStatus: string | null;
    };

const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open SSE connection

export function emitRunEvent(runId: string, event: RunEvent): void {
  bus.emit(`run:${runId}`, event);
}

export function onRunEvent(runId: string, listener: (e: RunEvent) => void): () => void {
  bus.on(`run:${runId}`, listener);
  return () => bus.off(`run:${runId}`, listener);
}
```

- [ ] **Step 4: Add emission to `src/lib/runner.ts`**

Import at the top: `import { emitRunEvent } from './events';`

After the `status: 'running'` update (inside the try), add:
```ts
    emitRunEvent(runId, { type: 'status', status: 'running' });
```

At the end of each baseline × viewport iteration (after the try/catch around `processResult`, still inside both `for` loops), add:
```ts
        const finished = await prisma.runResult.findUniqueOrThrow({ where: { id: result.id } });
        emitRunEvent(runId, {
          type: 'result',
          resultId: finished.id,
          baselineId: finished.baselineId,
          viewportId: finished.viewportId,
          visualStatus: finished.visualStatus,
          functionalStatus: finished.functionalStatus,
        });
```

After the `status: 'done'` update, add:
```ts
    emitRunEvent(runId, { type: 'status', status: 'done' });
```

After the `status: 'failed'` update in the catch block, add:
```ts
    emitRunEvent(runId, {
      type: 'status',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
```

- [ ] **Step 5: Implement the SSE route**

`src/app/api/runs/[id]/events/route.ts`:
```ts
import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';
import { onRunEvent, type RunEvent } from '@/lib/events';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return jsonError(404, 'run not found');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: RunEvent | { type: 'status'; status: string; error?: string }) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(heartbeat);
        controller.close();
      };

      const off = onRunEvent(id, (event) => {
        send(event);
        if (event.type === 'status' && (event.status === 'done' || event.status === 'failed')) {
          close();
        }
      });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15000);
      req.signal.addEventListener('abort', close);

      // Snapshot so late subscribers see the current state immediately; if the
      // run is already terminal, replay that and close.
      send({ type: 'status', status: run.status, error: run.error ?? undefined });
      if (run.status === 'done' || run.status === 'failed') close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
}
```

Note for the SSE-until-terminal test: the snapshot races the live run — if the run is still `queued`/`running` at connect time the stream stays open and the terminal event arrives live; if the run already finished, the snapshot itself is terminal. Both paths end with a terminal `status` event, which is exactly what the test asserts.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/events.test.ts && npm test && npm run typecheck`
Expected: new tests pass, full suite green (runner tests unaffected by added emission), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/events.ts src/lib/runner.ts src/app/api tests/events.test.ts
git commit -m "feat: run progress event bus with SSE endpoint"
```

---

### Task 9: Ignore rules API + one-click rule from log entry

**Files:**
- Create: `src/app/api/projects/[id]/ignore-rules/route.ts`, `src/app/api/ignore-rules/[id]/route.ts`, `src/app/api/log-entries/[id]/ignore-rule/route.ts`
- Test: `tests/api-ignore-rules.test.ts`

**Interfaces:**
- Consumes: `prisma`, `jsonError`, `readJson`.
- Produces:
  - `GET /api/projects/:id/ignore-rules` → `{ rules }`; `POST` body `{ reason: string; entryType?: one of the 5 log types; urlPattern?: string; messagePattern?: string }` — at least one of entryType/urlPattern/messagePattern required (fail-closed rules match nothing; reject them at the API boundary) and regex patterns must compile → 201.
  - `PATCH /api/ignore-rules/:id` (same fields optional) / `DELETE` → 204.
  - `POST /api/log-entries/:id/ignore-rule` body `{ reason: string }` → 201 `{ rule, entry }`: creates a project rule pre-filled from the entry (`entryType` = entry type, `messagePattern` = regex-escaped exact message), flags THIS entry `ignored=true` with `ignoreRuleId`. Future runs judge new entries against the rule at runtime; historical entries are untouched (spec: entries are immutable history).

- [ ] **Step 1: Write the failing test**

`tests/api-ignore-rules.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listRules, POST as createRule } from '@/app/api/projects/[id]/ignore-rules/route';
import { PATCH as patchRule, DELETE as deleteRule } from '@/app/api/ignore-rules/[id]/route';
import { POST as ruleFromEntry } from '@/app/api/log-entries/[id]/ignore-rule/route';

let projectId: string;
let entryId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (method: string, body: unknown) =>
  new Request('http://t', { method, body: JSON.stringify(body) });

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'rules-proj',
      viewports: { create: [{ name: 'd', width: 800, height: 600 }] },
      environments: { create: [{ name: 'test', baseUrl: 'http://127.0.0.1:1' }] },
    },
    include: { viewports: true, environments: true },
  });
  projectId = project.id;
  const baseline = await prisma.baseline.create({
    data: {
      projectId,
      name: 'b',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
    include: { targets: true },
  });
  const run = await prisma.run.create({
    data: { projectId, environmentId: project.environments[0].id, trigger: 'manual' },
  });
  const result = await prisma.runResult.create({
    data: { runId: run.id, baselineId: baseline.id, viewportId: project.viewports[0].id },
  });
  const entry = await prisma.logEntry.create({
    data: {
      resultId: result.id,
      type: 'console-error',
      origin: 'test',
      message: 'analytics blocked (tracker.js?v=1.2)',
    },
  });
  entryId = entry.id;
});

describe('ignore rules CRUD', () => {
  it('creates, lists, patches, deletes', async () => {
    const created = await createRule(
      jsonReq('POST', { reason: 'third-party noise', urlPattern: 'tracker\\.example' }),
      ctx(projectId)
    );
    expect(created.status).toBe(201);
    const rule = await created.json();

    const list = await (await listRules(new Request('http://t'), ctx(projectId))).json();
    expect(list.rules.some((r: { id: string }) => r.id === rule.id)).toBe(true);

    const patched = await patchRule(jsonReq('PATCH', { reason: 'updated' }), ctx(rule.id));
    expect((await patched.json()).reason).toBe('updated');

    expect((await deleteRule(new Request('http://t'), ctx(rule.id))).status).toBe(204);
  });

  it('rejects a rule with no criteria and invalid regex', async () => {
    expect((await createRule(jsonReq('POST', { reason: 'empty' }), ctx(projectId))).status).toBe(400);
    expect(
      (await createRule(jsonReq('POST', { reason: 'bad', messagePattern: '(' }), ctx(projectId))).status
    ).toBe(400);
  });
});

describe('one-click rule from log entry', () => {
  it('creates an escaped rule and flags the source entry', async () => {
    const res = await ruleFromEntry(jsonReq('POST', { reason: 'known noise' }), ctx(entryId));
    expect(res.status).toBe(201);
    const { rule, entry } = await res.json();
    expect(rule.entryType).toBe('console-error');
    expect(rule.messagePattern).toBe('analytics blocked \\(tracker\\.js\\?v=1\\.2\\)');
    expect(new RegExp(rule.messagePattern).test('analytics blocked (tracker.js?v=1.2)')).toBe(true);
    expect(entry.ignored).toBe(true);
    expect(entry.ignoreRuleId).toBe(rule.id);
  });

  it('404s for an unknown entry', async () => {
    expect((await ruleFromEntry(jsonReq('POST', { reason: 'x' }), ctx('nope'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-ignore-rules.test.ts`
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Implement the routes**

`src/app/api/projects/[id]/ignore-rules/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const LOG_TYPES = [
  'console-error',
  'console-warning',
  'page-error',
  'http-error',
  'network-error',
] as const;

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// NOTE: not exported — Next.js route modules may only export HTTP handlers/config
const ruleSchema = z
  .object({
    reason: z.string().min(1),
    entryType: z.enum(LOG_TYPES).optional(),
    urlPattern: z.string().min(1).refine(validRegex, 'invalid regex').optional(),
    messagePattern: z.string().min(1).refine(validRegex, 'invalid regex').optional(),
  })
  .refine((r) => r.entryType || r.urlPattern || r.messagePattern, {
    message: 'at least one of entryType, urlPattern, messagePattern is required',
  });

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const rules = await prisma.ignoreRule.findMany({ where: { projectId: id } });
  return Response.json({ rules });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, ruleSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const rule = await prisma.ignoreRule.create({ data: { projectId: id, ...body.data } });
  return Response.json(rule, { status: 201 });
}
```

`src/app/api/ignore-rules/[id]/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const patchSchema = z.object({
  reason: z.string().min(1).optional(),
  entryType: z
    .enum(['console-error', 'console-warning', 'page-error', 'http-error', 'network-error'])
    .nullable()
    .optional(),
  urlPattern: z.string().min(1).refine(validRegex, 'invalid regex').nullable().optional(),
  messagePattern: z.string().min(1).refine(validRegex, 'invalid regex').nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.ignoreRule.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'ignore rule not found');
  const merged = { ...existing, ...body.data };
  if (!merged.entryType && !merged.urlPattern && !merged.messagePattern) {
    return jsonError(400, 'at least one of entryType, urlPattern, messagePattern is required');
  }
  const rule = await prisma.ignoreRule.update({ where: { id }, data: body.data });
  return Response.json(rule);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.ignoreRule.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'ignore rule not found');
  await prisma.ignoreRule.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
```

`src/app/api/log-entries/[id]/ignore-rule/route.ts`:
```ts
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const bodySchema = z.object({ reason: z.string().min(1) });

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, bodySchema);
  if (!body.ok) return body.res;

  const entry = await prisma.logEntry.findUnique({
    where: { id },
    include: { result: { include: { run: { select: { projectId: true } } } } },
  });
  if (!entry || !entry.result) return jsonError(404, 'log entry not found');

  const rule = await prisma.ignoreRule.create({
    data: {
      projectId: entry.result.run.projectId,
      reason: body.data.reason,
      entryType: entry.type,
      messagePattern: escapeRegex(entry.message),
    },
  });
  const updated = await prisma.logEntry.update({
    where: { id },
    data: { ignored: true, ignoreRuleId: rule.id },
  });
  return Response.json({ rule, entry: updated }, { status: 201 });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-ignore-rules.test.ts && npm test && npm run typecheck && npm run build`
Expected: new tests pass, full suite green, typecheck clean, production build succeeds (final gate for the whole API surface).

- [ ] **Step 5: Commit**

```bash
git add src/app/api tests/api-ignore-rules.test.ts
git commit -m "feat: ignore rules API with one-click rule creation from log entries"
```
