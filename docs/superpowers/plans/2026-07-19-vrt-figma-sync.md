# VRT Figma Sync (Spec §4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figma as a baseline source: per-project encrypted token, frame-URL linking per baseline target, PNG export at viewport-matched scale, manual re-sync + optional sync-before-run — every sync producing a pending version through the normal approval flow.

**Architecture:** A pure Figma API client (`src/lib/figma.ts`, injectable fetch) under a sync service (`src/lib/figma-sync.ts`) that groups targets by `(fileKey, scale)` for batched export, runs on its own sequential queue, and writes pending `BaselineVersion`s via the existing storage/approval machinery. Token encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`, key from `VRT_ENCRYPTION_KEY`); the raw/encrypted token NEVER appears in an API response — every project surface serializes to `figmaTokenSet: boolean`. UI: settings gains token field + sync-before-run toggle; baseline dialog gains a `figma` source with per-viewport frame URLs; baseline grid gains re-sync + sync-error surfacing.

**Tech Stack:** node:crypto (AES-256-GCM), Figma REST API (`/v1/files/:key/nodes`, `/v1/images/:key`), Prisma 6 (`prisma db push`), Next.js 16 route handlers, vitest (+ jsdom/RTL for UI).

## Global Constraints

- TypeScript strict; `npm test && npm run typecheck && npm run build` must pass after every task.
- Schema changes: edit `prisma/schema.prisma`, run `npm run db:push`; test DB auto-reset by `tests/global-setup.ts`.
- Services throw `ApiError` (from `@/lib/api-error`) for status-coded failures; routes map via `errorResponse()`; non-ApiError rethrows → 500.
- **Token secrecy is binding:** no API response, log line, or client type may ever carry `figmaToken` (plaintext OR ciphertext). Project responses carry `figmaTokenSet: boolean` instead. A test must assert the absence of the `figmaToken` key on every project response surface (list, get, create, patch).
- Figma API facts (client code must match): auth header `X-Figma-Token`; node metadata `GET https://api.figma.com/v1/files/:fileKey/nodes?ids=<id,id>` → `{ nodes: { "<id>": { document: { absoluteBoundingBox: { width, height } } } } }`; image export `GET https://api.figma.com/v1/images/:fileKey?ids=<id,id>&format=png&scale=<n>` → `{ err: string|null, images: { "<id>": "<temporary URL>"|null } }` — ONE scale per call, so batching is per `(fileKey, scale)`; scale valid range 0.01–4; image URLs are temporary — download immediately.
- Figma frame URLs: `https://www.figma.com/design/<fileKey>/<name>?node-id=<a-b>` (also legacy `/file/<fileKey>/...`); the `node-id` query value uses `-` where the API wants `:` (`12-34` → `12:34`).
- Scale rule: `scale = viewportWidth / frameWidth`. If `scale > 1.02` (frame narrower than viewport → would upscale) OR `scale < 0.01` OR `scale > 4`: the target FAILS sync with message `frame width <w>px incompatible with viewport width <vw>px` — never silently upscale (spec §4). Round exported scale to 4 decimals.
- Sync semantics (spec §4): every sync (including the first import) creates a PENDING `BaselineVersion` — never auto-approve, never touch the active version. Sync failure → `Baseline.syncStatus = 'sync-error'` + `Baseline.syncError = <message>`, last approved version stays active, runs proceed. Sync success → `syncStatus = 'ok'`, `syncError = null`.
- Sync queue is sequential (own chain, separate from the run queue — sync is network-only and must not block behind captures).
- UI conventions: data access ONLY through `src/lib/client.ts`; jsdom/RTL/`.toBeDefined()`/no fetch mocking; injectable fns for mutations; error copy `failed to load` / `something went wrong` / `ApiClientError.message` wins; mono for technical values; `StatusBadge` already maps `sync-error` → fail color.
- `VRT_ENCRYPTION_KEY`: 64 hex chars (32 bytes). Tests set it via `process.env` in the test file. Dev: Task 1 appends a generated key to `.env` (gitignored) if absent. Token operations without a valid key → `ApiError(500, 'VRT_ENCRYPTION_KEY missing or invalid')`.
- All commits end with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## File Structure

```
src/lib/crypto.ts                       — Task 1: encryptSecret/decryptSecret (AES-256-GCM)
src/lib/api.ts                          — Task 1: + serializeProject (strips figmaToken → figmaTokenSet)
src/app/api/projects/route.ts           — Task 1: serialize both surfaces
src/app/api/projects/[id]/route.ts      — Task 1: figmaToken in PATCH schema, serialize GET/PATCH
src/app/(dashboard)/projects/[id]/settings/page.tsx — Tasks 1 (token field), 5 (toggle)
src/lib/figma.ts                        — Task 2: parseFigmaFrameUrl, fetchNodeWidths, exportNodeImages, computeScale
src/lib/figma-sync.ts                   — Task 3: syncBaseline + sequential sync queue
src/app/api/baselines/[id]/sync/route.ts — Task 3: POST manual re-sync
src/app/api/projects/[id]/baselines/route.ts — Task 4: figma sourceType + figmaFrames
src/app/api/baselines/[id]/route.ts     — Task 4: PATCH figmaFrames
src/components/baseline-dialog.tsx      — Task 4: figma source + per-viewport URL inputs
src/lib/run-service.ts                  — Task 5: sync-before-run hook
src/components/baseline-grid.tsx        — Task 5: re-sync button + sync-error message
src/lib/client.ts                       — Tasks 1/3/4/5: type + method additions
prisma/schema.prisma                    — Tasks 3 (Baseline.syncError), 5 (Project.syncBeforeRun)
tests/crypto.test.ts                    — Task 1
tests/api-projects.test.ts              — Task 1 (extend: redaction + token set/clear)
tests/figma.test.ts                     — Task 2
tests/figma-sync.test.ts                — Task 3
tests/api-baselines.test.ts             — Task 4 (extend)
tests/run-service.test.ts               — Task 5 (extend)
tests/ui/baseline-dialog.test.tsx       — Task 4 (extend)
tests/ui/baseline-grid.test.tsx         — Task 5 (extend)
```

---

### Task 1: Token crypto + write-only project token

**Files:**
- Create: `src/lib/crypto.ts`, `tests/crypto.test.ts`
- Modify: `src/lib/api.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/lib/client.ts`, `src/app/(dashboard)/projects/[id]/settings/page.tsx`
- Test: `tests/crypto.test.ts`, extend `tests/api-projects.test.ts`

**Interfaces:**
- Produces:

```ts
// src/lib/crypto.ts
export function encryptSecret(plaintext: string): string;  // "v1:<iv b64>:<tag b64>:<ciphertext b64>"
export function decryptSecret(payload: string): string;    // throws ApiError(500) on bad key/payload
```

```ts
// src/lib/api.ts
export function serializeProject<T extends { figmaToken: string | null }>(
  project: T
): Omit<T, 'figmaToken'> & { figmaTokenSet: boolean };
```

- Client: `Project`/`ProjectSummary`/`ProjectDetail` gain `figmaTokenSet: boolean` (and must NOT have `figmaToken`); `api.projects.update` body gains `figmaToken?: string | null` (string sets, null clears).

- [ ] **Step 1: Write failing crypto tests** — `tests/crypto.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { ApiError } from '@/lib/api-error';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  beforeEach(() => {
    process.env.VRT_ENCRYPTION_KEY = KEY;
  });

  it('round-trips a secret and never stores plaintext', () => {
    const payload = encryptSecret('figd_secret-token');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('figd_secret-token');
    expect(decryptSecret(payload)).toBe('figd_secret-token');
  });

  it('produces distinct ciphertexts per call (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('throws ApiError(500) on missing or malformed key', () => {
    delete process.env.VRT_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrowError(ApiError);
    process.env.VRT_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSecret('x')).toThrowError(ApiError);
  });

  it('throws ApiError(500) on tampered payload', () => {
    const payload = encryptSecret('x');
    const parts = payload.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrowError(ApiError);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/crypto.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement** — `src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from '@/lib/api-error';

// Secrets-at-rest encryption (AES-256-GCM). Key comes from VRT_ENCRYPTION_KEY
// (64 hex chars = 32 bytes). Payload format: v1:<iv>:<authTag>:<ciphertext>,
// all base64 — versioned so a future scheme can coexist with stored payloads.

function key(): Buffer {
  const hex = process.env.VRT_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new ApiError(500, 'VRT_ENCRYPTION_KEY missing or invalid');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new ApiError(500, 'stored secret has unknown format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, 'stored secret failed to decrypt');
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/crypto.test.ts` → 4/4.

- [ ] **Step 5: Redaction + PATCH.** Add `serializeProject` to `src/lib/api.ts`:

```ts
export function serializeProject<T extends { figmaToken: string | null }>(
  project: T
): Omit<T, 'figmaToken'> & { figmaTokenSet: boolean } {
  const { figmaToken, ...rest } = project;
  return { ...rest, figmaTokenSet: figmaToken !== null };
}
```

Apply it to EVERY project response: `src/app/api/projects/route.ts` (list rows and POST result) and `src/app/api/projects/[id]/route.ts` (GET — compose with the existing baseline serialization — and PATCH result). Extend the PATCH schema:

```ts
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
  figmaToken: z.string().min(1).nullable().optional(),
});
```

In PATCH, transform before update: if `figmaToken` is a string → `encryptSecret(...)`; if `null` → store null; if absent → leave untouched:

```ts
  const { figmaToken, ...rest } = body.data;
  const data: typeof rest & { figmaToken?: string | null } = { ...rest };
  if (figmaToken !== undefined) data.figmaToken = figmaToken === null ? null : encryptSecret(figmaToken);
```

- [ ] **Step 6: Extend API tests** — in `tests/api-projects.test.ts` (follow its existing request-helper conventions; set `process.env.VRT_ENCRYPTION_KEY = 'a'.repeat(64)` at the top of the new describe block):
  - PATCH with `figmaToken: 'figd_x'` → 200, response has `figmaTokenSet: true` and NO `figmaToken` key (`expect('figmaToken' in body).toBe(false)`); DB row's stored value starts with `v1:` and does not contain `figd_x`.
  - PATCH with `figmaToken: null` → `figmaTokenSet: false`, DB null.
  - GET list, GET detail, POST create → every project object has `figmaTokenSet` boolean and no `figmaToken` key.

- [ ] **Step 7: Client + settings UI.** `src/lib/client.ts`: add `figmaTokenSet: boolean` to the `Project` interface (flows to Summary/Detail via extends); add `figmaToken?: string | null` to `api.projects.update`'s body type. Settings page (`src/app/(dashboard)/projects/[id]/settings/page.tsx`): add a "Figma" section card above the existing tables:
  - When `project.figmaTokenSet`: text `Token set` (mono, muted) + `Replace` toggle revealing the input + `Clear` button (`api.projects.update(id, { figmaToken: null }).then(reload).catch(fail)`).
  - Input (type `password`, placeholder `figd_…`) + `Save` button → `api.projects.update(id, { figmaToken: value }).then(() => { setValue(''); reload(); }).catch(fail)`; Save disabled when input empty.
  - Reuse the page's existing `fail` + `reload` from `useLoad`.

- [ ] **Step 8: Dev key.** If `.env` lacks `VRT_ENCRYPTION_KEY`, append one: `grep -q VRT_ENCRYPTION_KEY .env 2>/dev/null || echo "VRT_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env`. Also ensure `tests/global-setup.ts` sets a test key if unset:

```ts
  process.env.VRT_ENCRYPTION_KEY ??= 'a'.repeat(64);
```

- [ ] **Step 9: Full gate** — `npm test && npm run typecheck && npm run build` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/crypto.ts src/lib/api.ts src/app/api/projects src/lib/client.ts "src/app/(dashboard)/projects/[id]/settings/page.tsx" tests/crypto.test.ts tests/api-projects.test.ts tests/global-setup.ts
git commit -m "feat: encrypted per-project Figma token, write-only via API"
```

---

### Task 2: Figma API client

**Files:**
- Create: `src/lib/figma.ts`, `tests/figma.test.ts`

**Interfaces:**
- Produces (Task 3 consumes all of these; `FetchLike` enables test injection):

```ts
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function parseFigmaFrameUrl(url: string): { fileKey: string; nodeId: string };
  // accepts figma.com/design/<key>/... and figma.com/file/<key>/... with ?node-id=<a-b>;
  // returns nodeId with ':' separator; throws ApiError(400, 'not a valid Figma frame URL') otherwise.

export function computeScale(frameWidth: number, viewportWidth: number): number;
  // viewportWidth / frameWidth rounded to 4 decimals; throws ApiError(422,
  // `frame width ${frameWidth}px incompatible with viewport width ${viewportWidth}px`)
  // when the result is > 1.02 or > 4 or < 0.01.

export async function fetchNodeWidths(
  token: string, fileKey: string, nodeIds: string[], fetchImpl?: FetchLike
): Promise<Map<string, number>>;
  // GET /v1/files/:fileKey/nodes?ids=...; missing node in response → ApiError(422, `Figma node ${id} not found`);
  // 403 → ApiError(422, 'Figma token rejected'); other non-ok → ApiError(502, `Figma API error (${status})`).

export async function exportNodeImages(
  token: string, fileKey: string, nodeIds: string[], scale: number, fetchImpl?: FetchLike
): Promise<Map<string, Buffer>>;
  // GET /v1/images/:fileKey?ids=...&format=png&scale=...; null image URL → ApiError(422, `Figma export failed for node ${id}`);
  // then downloads each URL (temporary — immediately) via fetchImpl; non-ok download → ApiError(502, ...).
```

- [ ] **Step 1: Write failing tests** — `tests/figma.test.ts`, plain vitest, fake `FetchLike` implementations (no network):

```ts
import { describe, expect, it } from 'vitest';
import { parseFigmaFrameUrl, computeScale, fetchNodeWidths, exportNodeImages } from '@/lib/figma';
import { ApiError } from '@/lib/api-error';

describe('parseFigmaFrameUrl', () => {
  it('parses design URLs and converts node-id dashes to colons', () => {
    expect(parseFigmaFrameUrl('https://www.figma.com/design/AbC123/My-File?node-id=12-34&t=xyz'))
      .toEqual({ fileKey: 'AbC123', nodeId: '12:34' });
  });
  it('parses legacy file URLs', () => {
    expect(parseFigmaFrameUrl('https://www.figma.com/file/K9/Name?node-id=1-2'))
      .toEqual({ fileKey: 'K9', nodeId: '1:2' });
  });
  it('rejects non-figma URLs and missing node-id', () => {
    expect(() => parseFigmaFrameUrl('https://example.com/design/x?node-id=1-2')).toThrowError(ApiError);
    expect(() => parseFigmaFrameUrl('https://www.figma.com/design/AbC123/File')).toThrowError(ApiError);
  });
});

describe('computeScale', () => {
  it('computes downscale ratios to 4 decimals', () => {
    expect(computeScale(2880, 1440)).toBe(0.5);
    expect(computeScale(1512, 1440)).toBe(0.9524);
  });
  it('allows same-width within tolerance', () => {
    expect(computeScale(1440, 1440)).toBe(1);
  });
  it('rejects upscaling beyond tolerance with the spec message', () => {
    expect(() => computeScale(375, 1440)).toThrowError('frame width 375px incompatible with viewport width 1440px');
  });
});

describe('fetchNodeWidths', () => {
  const nodesResponse = (widths: Record<string, number>) => ({
    ok: true, status: 200,
    json: async () => ({
      nodes: Object.fromEntries(
        Object.entries(widths).map(([id, width]) => [id, { document: { absoluteBoundingBox: { width, height: 100 } } }])
      ),
    }),
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  it('returns widths per node id and sends the token header', async () => {
    let seenUrl = ''; let seenHeaders: Record<string, string> | undefined;
    const widths = await fetchNodeWidths('tok', 'KEY', ['1:2', '3:4'], async (url, init) => {
      seenUrl = url; seenHeaders = init?.headers;
      return nodesResponse({ '1:2': 1440, '3:4': 375 });
    });
    expect(widths.get('1:2')).toBe(1440);
    expect(widths.get('3:4')).toBe(375);
    expect(seenUrl).toContain('/v1/files/KEY/nodes?ids=');
    expect(seenHeaders?.['X-Figma-Token']).toBe('tok');
  });

  it('maps 403 to a token-rejected ApiError', async () => {
    await expect(
      fetchNodeWidths('bad', 'KEY', ['1:2'], async () => ({ ok: false, status: 403, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }))
    ).rejects.toThrowError('Figma token rejected');
  });

  it('flags a node missing from the response', async () => {
    await expect(
      fetchNodeWidths('tok', 'KEY', ['1:2', '9:9'], async () => nodesResponse({ '1:2': 100 }))
    ).rejects.toThrowError('Figma node 9:9 not found');
  });
});

describe('exportNodeImages', () => {
  it('exports then downloads each image', async () => {
    const png = Buffer.from('PNGDATA');
    const images = await exportNodeImages('tok', 'KEY', ['1:2'], 0.5, async (url) => {
      if (url.includes('/v1/images/')) {
        expect(url).toContain('scale=0.5');
        expect(url).toContain('format=png');
        return { ok: true, status: 200, json: async () => ({ err: null, images: { '1:2': 'https://cdn/img.png' } }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    });
    expect(images.get('1:2')?.equals(png)).toBe(true);
  });

  it('flags a null export URL', async () => {
    await expect(
      exportNodeImages('tok', 'KEY', ['1:2'], 1, async () => ({ ok: true, status: 200, json: async () => ({ err: null, images: { '1:2': null } }), arrayBuffer: async () => new ArrayBuffer(0) }))
    ).rejects.toThrowError('Figma export failed for node 1:2');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/figma.test.ts` → module not found.

- [ ] **Step 3: Implement** `src/lib/figma.ts` per the Interfaces block. Implementation notes (write real code, these are the decisions): parse with `new URL(url)`, host must be `figma.com` or `www.figma.com`, path `^/(design|file)/([^/]+)`, `node-id` query required, replace ALL `-` with `:`; `fetchNodeWidths`/`exportNodeImages` default `fetchImpl` to the global `fetch` (cast through the `FetchLike` shape); encode ids with `encodeURIComponent(nodeIds.join(','))`; 403 check BEFORE generic non-ok; `computeScale` tolerance: `raw = viewportWidth / frameWidth`; if `raw > 1.02 || raw > 4 || raw < 0.01` throw, else `Math.round(Math.min(raw, 1) * 10000) / 10000` — clamp the ≤1.02 tolerance window to exactly 1 so a 1.01 ratio exports at native scale rather than upscaling.

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/figma.test.ts` → all pass.

- [ ] **Step 5: Full gate**, then **Step 6: Commit**

```bash
git add src/lib/figma.ts tests/figma.test.ts
git commit -m "feat: Figma API client — frame URL parsing, node widths, scaled PNG export"
```

---

### Task 3: Sync service + manual re-sync endpoint

**Files:**
- Create: `src/lib/figma-sync.ts`, `src/app/api/baselines/[id]/sync/route.ts`, `tests/figma-sync.test.ts`
- Modify: `prisma/schema.prisma` (Baseline: `syncError String?` after `syncStatus`), `src/lib/client.ts`

**Interfaces:**
- Consumes: Task 2's client fns, `decryptSecret`, `saveImage('baselines', …)`, prisma.
- Produces:

```ts
// src/lib/figma-sync.ts
export function enqueueSync(job: () => Promise<void>): Promise<void>; // sequential chain, same shape as lib/queue.ts but a SEPARATE chain
export async function syncBaseline(baselineId: string, fetchImpl?: FetchLike): Promise<void>;
  // loads baseline + project + figma-linked targets (figmaFileKey & figmaNodeId non-null) + each target's viewport;
  // throws ApiError(422, 'baseline has no Figma-linked targets') if none;
  // throws ApiError(422, 'project has no Figma token') if project.figmaToken null;
  // groups targets by (fileKey, computeScale(frameWidth, viewport.width));
  // one exportNodeImages call per group; one fetchNodeWidths call per distinct fileKey;
  // per exported target: saveImage('baselines', `${target.id}-${Date.now()}`, png) + create BaselineVersion { status: 'pending' };
  // ON SUCCESS: baseline.update { syncStatus: 'ok', syncError: null };
  // ON ANY FAILURE (ApiError or not): baseline.update { syncStatus: 'sync-error', syncError: message }, then rethrow.
```

- Route: `POST /api/baselines/:id/sync` → 404 unknown baseline; otherwise `await enqueueSync(() => syncBaseline(id))` inside try/catch with `errorResponse`; success returns the re-fetched serialized baseline (with targets+versions, same shape as the existing baseline GET).
- Client: `Baseline` type gains `syncError: string | null`; `api.baselines.sync = (id: string) => request<BaselineDetail>('POST', `/api/baselines/${id}/sync`)`.

- [ ] **Step 1: Schema first** — add `syncError String?` to Baseline (after `syncStatus`), `npm run db:push`.

- [ ] **Step 2: Write failing sync-service tests** — `tests/figma-sync.test.ts` (node env, real test.db like `tests/runner.test.ts`; seed project+viewports+figma-linked baseline directly with prisma; set `process.env.VRT_ENCRYPTION_KEY` and store an `encryptSecret('tok')` token on the project). Cover:
  - happy path: 2 targets, same fileKey, different viewport widths matching different frame widths → creates 2 pending versions with distinct imagePaths, syncStatus `ok`, ONE `/v1/files/` metadata call, one images call per distinct scale (assert via a recording fake `FetchLike`);
  - same-scale batching: 2 targets whose (fileKey, scale) match → a single `/v1/images/` call containing both ids;
  - incompatible frame width (375 vs 1440) → rejects, baseline `sync-error`, `syncError` contains `incompatible`, NO version created;
  - token missing → ApiError 422, sync-error recorded;
  - Figma 403 → sync-error recorded with `Figma token rejected`, active/approved versions untouched (seed an approved version first, assert still there and still the only approved one);
  - `enqueueSync` is sequential (start two syncs, assert second's first fetch happens after first completes — reuse the ordering-test pattern from `tests/queue.test.ts`).

- [ ] **Step 3: Run to verify failure**, **Step 4: Implement** per the Interfaces block. Error-message capture: `err instanceof Error ? err.message : String(err)`. The sync-error update must be in a `catch` that RETHROWS after recording. Decrypt the token once per `syncBaseline` call.

- [ ] **Step 5: Route + client.** Create `src/app/api/baselines/[id]/sync/route.ts` following the existing route-handler style (see `src/app/api/baselines/[id]/route.ts` for Ctx/params/serialize conventions). Add the client method + `syncError` field.

- [ ] **Step 6: Route test** — extend `tests/figma-sync.test.ts` or `tests/api-baselines.test.ts` (whichever matches the project's route-test conventions — API tests live where the fixture server/app harness already runs): POST sync on unknown id → 404; POST sync on a figma baseline with a fake-injectable path is NOT available through the route (route uses real fetch) — so the route test covers 404 + the no-figma-targets 422 mapping only; service-level tests carry the sync logic. Note this split in your report.

- [ ] **Step 7: Full gate**, **Step 8: Commit**

```bash
git add prisma/schema.prisma src/lib/figma-sync.ts src/app/api/baselines src/lib/client.ts tests/figma-sync.test.ts tests/api-baselines.test.ts
git commit -m "feat: Figma sync service with batched export, pending versions, sync-error recording"
```

---

### Task 4: Figma-sourced baselines — API + dialog

**Files:**
- Modify: `src/app/api/projects/[id]/baselines/route.ts` (create), `src/app/api/baselines/[id]/route.ts` (PATCH), `src/lib/client.ts`, `src/components/baseline-dialog.tsx`
- Test: extend `tests/api-baselines.test.ts`, `tests/ui/baseline-dialog.test.tsx`

**Interfaces:**
- Create schema changes: `sourceType: z.enum(['upload', 'capture', 'figma'])`; new optional `figmaFrames: z.array(z.object({ viewportId: z.string(), url: z.string() })).optional()`. Validation: when `sourceType === 'figma'`, `figmaFrames` must be present, non-empty, and cover EXACTLY the baseline's effective viewportIds (the `viewportIds` body field or all project viewports) — else 400 `figma baselines need a frame URL per viewport`. Each url goes through `parseFigmaFrameUrl` (its ApiError(400) surfaces as the response). Store `figmaFileKey`/`figmaNodeId` on the matching created targets. Do NOT auto-sync on create (explicit re-sync or sync-before-run does it; keeps create fast and decoupled — note this in the dialog copy).
- Baseline PATCH gains the same optional `figmaFrames` (updates per-target links; only allowed when the baseline's `sourceType === 'figma'`, else 400).
- Client: `api.baselines.create` body: `sourceType: 'upload' | 'capture' | 'figma'`, `figmaFrames?: { viewportId: string; url: string }[]`; same optional field on `update`; `BaselineTarget` type gains `figmaFileKey: string | null; figmaNodeId: string | null` (verify current type shape first).
- Dialog: source select gains `figma` option; when chosen, one URL input per checked viewport (labeled with the viewport name, placeholder `https://www.figma.com/design/…?node-id=…`); `canSubmit` additionally requires every checked viewport's URL non-empty; values passed through `BaselineFormValues` (extend the type: `figmaFrames?: { viewportId: string; url: string }[]`); edit mode: pre-fill URLs from `baseline.targets` (`https://www.figma.com/design/<fileKey>/frame?node-id=<nodeId with : → ->`); helper text: `Frames are imported on the next sync.`

- [ ] **Step 1: Failing API tests** — extend `tests/api-baselines.test.ts`: figma create with matching frames → 201, targets carry parsed fileKey/nodeId (dash→colon); figma create missing a viewport's frame → 400; invalid URL → 400; PATCH figmaFrames on an upload baseline → 400; PATCH figmaFrames on a figma baseline → targets updated.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement API** per Interfaces.
- [ ] **Step 4: Failing dialog tests** — extend `tests/ui/baseline-dialog.test.tsx` (house style, injected submit fn): choosing figma source reveals per-viewport URL inputs; submit disabled until all filled; submitted values include `figmaFrames` with the typed URLs; edit-mode prefill renders reconstructed URLs.
- [ ] **Step 5: Implement dialog**, **Step 6: green**, **Step 7: Full gate**, **Step 8: Commit**

```bash
git add src/app/api src/lib/client.ts src/components/baseline-dialog.tsx tests/api-baselines.test.ts tests/ui/baseline-dialog.test.tsx
git commit -m "feat: figma-sourced baselines — frame URLs per viewport in API and dialog"
```

---

### Task 5: Re-sync UI, sync-error surfacing, sync-before-run

**Files:**
- Modify: `prisma/schema.prisma` (Project: `syncBeforeRun Boolean @default(false)` after `figmaToken`), `src/app/api/projects/[id]/route.ts` (PATCH schema `syncBeforeRun: z.boolean().optional()`), `src/lib/run-service.ts`, `src/lib/client.ts`, `src/components/baseline-grid.tsx`, `src/app/(dashboard)/projects/[id]/settings/page.tsx`, `src/app/(dashboard)/projects/[id]/page.tsx`
- Test: extend `tests/run-service.test.ts`, `tests/ui/baseline-grid.test.tsx`

**Interfaces:**
- `Project` client type gains `syncBeforeRun: boolean`; `api.projects.update` body gains `syncBeforeRun?: boolean`.
- Run integration: in `src/lib/run-service.ts`'s `startRun`, INSIDE the queued job and BEFORE browser/capture work: if the project has `syncBeforeRun` true, load its figma baselines (`sourceType === 'figma'`) and for each `await syncBaseline(id).catch(() => {})` — sync failures are recorded on the baseline by the service itself (sync-error + last approved stays active) and MUST NOT fail the run (spec §4 failure handling). Read `startRun`'s current structure first and place the hook so run status/events semantics are untouched.
- BaselineGrid: for `sourceType === 'figma'` baselines add a `Sync` button (injectable `syncFn` prop defaulting to `api.baselines.sync`, house pattern) → on success call existing refresh callback (check the grid's current prop names and reuse); when `syncStatus === 'sync-error'`, show the existing sync-error badge PLUS `baseline.syncError` text (small, `text-status-fail`, truncated with `title` for full message).
- Settings page: `Sync baselines from Figma before every run` checkbox in the Figma section (Task 1's card) → `api.projects.update(id, { syncBeforeRun: checked }).then(reload).catch(fail)`.

- [ ] **Step 1: Schema + push** (`syncBeforeRun`), extend project PATCH schema + client types.
- [ ] **Step 2: Failing run-service test** — extend `tests/run-service.test.ts`: project with `syncBeforeRun: true` + a figma baseline whose sync will fail (no token) → run still completes (status reaches a terminal state as before) and the baseline ends `sync-error`; project with `syncBeforeRun: false` → no sync attempted (baseline `syncStatus` stays `ok`). Follow the file's existing startRun test harness.
- [ ] **Step 3: Implement run hook**, verify pass.
- [ ] **Step 4: Failing grid tests** — extend `tests/ui/baseline-grid.test.tsx`: figma baseline renders Sync button, upload baseline doesn't; clicking calls injected `syncFn` with the baseline id; sync-error baseline shows the `syncError` message text.
- [ ] **Step 5: Implement grid + settings toggle + project page wiring** (pass the grid's new props from `projects/[id]/page.tsx` — sync success should `reload`; sync failure surfaces via the page's `fail`).
- [ ] **Step 6: Full gate**, **Step 7: Commit**

```bash
git add prisma/schema.prisma src/app/api src/lib/run-service.ts src/lib/client.ts src/components/baseline-grid.tsx "src/app/(dashboard)/projects/[id]/settings/page.tsx" "src/app/(dashboard)/projects/[id]/page.tsx" tests/run-service.test.ts tests/ui/baseline-grid.test.tsx
git commit -m "feat: manual re-sync, sync-error surfacing, and sync-before-run toggle"
```
