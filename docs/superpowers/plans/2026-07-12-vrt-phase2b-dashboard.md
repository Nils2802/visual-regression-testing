# VRT Phase 2b — Dashboard UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full dashboard on the Phase 2a REST API: projects list, project detail with baseline grid + run trigger, run detail with three comparison modes + live SSE progress + log panel with one-click ignore, cross-project approval queue, project settings — Tailwind v4 + shadcn/ui, dark-only, tested.

**Architecture:** Client-component pages under `src/app/(dashboard)/` fetching exclusively through a typed API client (`src/lib/client.ts`) against the Phase 2a routes — one data path, the REST API stays the single contract. Presentational components take data as props (RTL/jsdom-testable without fetch mocking); thin page containers own fetching/state. SSE via `EventSource`. Task 1 hardens the API contract first (typed errors + JSON-field deserialization) so the UI never hardcodes `JSON.parse` or error-string matching.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4, shadcn/ui, next/font (Archivo, Instrument Sans, JetBrains Mono), vitest + @testing-library/react (jsdom), Phase 2a API.

## Global Constraints

- TypeScript strict; `npx tsc --noEmit` and `npm run build` must pass after every UI task.
- **Design tokens are binding** (see Design System below): dark-only graphite chassis; pixelmatch-magenta accent doubles as the `diff` status color; all numeric/technical data (viewport dims, diff ratios, paths, counts) renders in JetBrains Mono.
- Status vocabulary everywhere: visual `pass | diff | fail | new`, functional `pass | fail`, run `queued | running | done | failed`, version `pending | approved | rejected`. A result is "failing" iff visualStatus ∈ {diff, fail} or functionalStatus = fail.
- UI data access ONLY through `src/lib/client.ts` (Task 3); components never call `fetch` directly, never import prisma.
- Images render via `<img src={imageUrl(relPath)}>` → `/api/images/<relPath>` (Task 3 helper). No next/image.
- Compare runs: reference (live) LEFT, test (dev) RIGHT; no approve/promote button on compare-run results.
- Ignored log entries collapsed/grey; reference-origin entries never counted in failure badges; grouping by entry type.
- Accessibility floor: visible keyboard focus (`focus-visible` ring in accent), `prefers-reduced-motion` respected (no transitions when set), all icon-only buttons have `aria-label`.
- Component tests: presentational components tested with props via RTL under `// @vitest-environment jsdom` pragma; no fetch mocking in component tests.
- Tests still: `DATABASE_URL=file:./prisma/test.db`, fixture server only. API-touching tests (Task 1) follow Phase 2a patterns.
- All commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Design System (binding for every UI task)

CSS custom properties (defined once in `globals.css`, Task 2):

```css
--bg: #101214;          /* page chassis — graphite, faint blue cast */
--surface: #17191d;     /* cards, panels, table rows */
--surface-2: #1e2126;   /* hover, nested surfaces, inputs */
--border: #2a2e34;      /* hairline borders */
--text: #e8eaed;        /* primary text */
--muted: #9aa0a6;       /* secondary text, labels */
--accent: #ff2da8;      /* pixelmatch magenta — brand accent AND `diff` status */
--pass: #3dd68c;
--fail: #ff5c5c;
--new: #58a6ff;
--pending: #f0b429;
```

Type roles: `--font-display` Archivo (page titles, project names — weight 600, tight tracking); `--font-body` Instrument Sans (everything else); `--font-mono` JetBrains Mono (viewport dims like `1440×900`, diff ratios, paths, counts, badges). Radius: 6px (`--radius: 0.375rem`). Spacing rhythm: 4px base. Signature element: **status is color** — the magenta diff accent threads from nav focus rings through status badges to the diff-highlight comparison mode; nothing else on the page competes with it.

## File Structure

```
src/lib/api-error.ts                    — typed ApiError (code + status) for services (Task 1)
src/lib/client.ts                       — typed API client + imageUrl() (Task 3)
src/app/globals.css                     — Tailwind v4 + tokens (Task 2)
src/app/layout.tsx                      — MODIFIED: fonts, dark chassis, sidebar shell (Task 2)
src/components/ui/*                     — shadcn primitives (Task 2, CLI-generated)
src/components/status-badge.tsx         — visual/functional/run/version status chip (Task 2)
src/components/viewport-chip.tsx        — mono `name w×h` chip (Task 2)
src/app/(dashboard)/projects/page.tsx                    — projects list (Task 4)
src/components/project-card.tsx                          — (Task 4)
src/components/create-project-dialog.tsx                 — (Task 4)
src/app/(dashboard)/projects/[id]/settings/page.tsx      — settings (Task 5)
src/components/settings/environments-table.tsx           — (Task 5)
src/components/settings/viewports-table.tsx              — (Task 5)
src/components/settings/ignore-rules-table.tsx           — (Task 5)
src/app/(dashboard)/projects/[id]/page.tsx               — project detail (Task 6)
src/components/baseline-grid.tsx                         — (Task 6)
src/components/baseline-dialog.tsx                       — create/edit + upload (Task 6)
src/components/run-now-dialog.tsx                        — (Task 7)
src/components/runs-list.tsx                             — (Task 7)
src/app/(dashboard)/runs/[id]/page.tsx                   — run detail (Task 8)
src/components/run-progress.tsx                          — SSE progress bar (Task 8)
src/components/result-list.tsx                           — grouped results + filters (Task 8)
src/components/comparison-viewer.tsx                     — 3 modes (Task 9)
src/components/log-panel.tsx                             — grouped entries + ignore (Task 10)
src/app/(dashboard)/approvals/page.tsx                   — approval queue (Task 10)
src/app/page.tsx                                          — MODIFIED: redirect → /projects (Task 2)
```

---

### Task 1: API contract hardening — typed errors + deserialized JSON fields

Closes the two pre-2b decisions from the 2a final review before any UI code exists.

**Files:**
- Create: `src/lib/api-error.ts`
- Modify: `src/lib/run-service.ts`, `src/lib/approval.ts` (throw ApiError), `src/app/api/projects/[id]/runs/route.ts`, `src/app/api/versions/[id]/approve/route.ts`, `src/app/api/versions/[id]/reject/route.ts`, `src/app/api/results/[id]/promote/route.ts` (map by ApiError.status, not string equality)
- Modify: `src/app/api/baselines/[id]/route.ts`, `src/app/api/projects/[id]/baselines/route.ts` (serialize `maskSelectors` as string[] in responses), `src/app/api/runs/[id]/route.ts`, `src/app/api/projects/[id]/runs/route.ts` (serialize `viewportIds` as string[])
- Test: extend `tests/run-service.test.ts`, `tests/approval.test.ts`, `tests/api-baselines.test.ts` assertions

**Interfaces:**
- Produces: `class ApiError extends Error { constructor(public status: 400 | 404 | 409, message: string) }` in `src/lib/api-error.ts`. Services throw `new ApiError(404, 'project not found')` etc.; routes catch and map `err instanceof ApiError ? jsonError(err.status, err.message) : jsonError(500, 'internal error')` — unknown errors become 500, never 400/409.
- Produces: API responses expose `maskSelectors: string[]` (baselines) and `viewportIds: string[]` (runs) — parsed at the route boundary. DB storage stays JSON-string (no schema change). The UI (Task 3 types) relies on this.

- [ ] **Step 1: Write/adjust failing assertions**

In `tests/api-baselines.test.ts`, extend the maskSelectors round-trip test: response `maskSelectors` must equal `['.a', '.b']` (array, not string). In `tests/run-service.test.ts`, run detail + list: `viewportIds` is `[]` (array). Add one 500-mapping test: monkey-patch is not needed — assert instead that a syntactically valid but unknown-project trigger still 404s and that approve of unknown id still 404s (regression net for the refactor), plus unit-test ApiError:

```ts
// tests/api-error.test.ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api-error';

describe('ApiError', () => {
  it('carries status and message and is an Error', () => {
    const e = new ApiError(409, 'only pending versions can be approved');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(409);
    expect(e.message).toBe('only pending versions can be approved');
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/api-error.test.ts tests/api-baselines.test.ts`
Expected: FAIL — module missing; maskSelectors still a string.

- [ ] **Step 3: Implement `src/lib/api-error.ts`**

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

- [ ] **Step 4: Refactor services and routes**

In `src/lib/run-service.ts`: every `throw new Error('project not found')` → `throw new ApiError(404, 'project not found')`; the validation throws (`environment does not belong to project`, `compare run requires referenceEnvironmentId`, `reference environment does not belong to project`, `unknown viewport ids: …`) → `ApiError(400, …)`.

In `src/lib/approval.ts`: `'version not found'` / `'result not found'` / `'no baseline target for this result'` → `ApiError(404, …)`; `'only pending versions can be approved'` / `'only pending versions can be rejected'` / `'compare-run captures cannot be promoted'` / `'result has no capture image'` → `ApiError(409, …)`; keep `'active-version invariant violated'` a plain Error (it must map to 500 now — closes the 2a ledger item).

In the four routes, replace string-matching catch blocks with:

```ts
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.message);
    console.error(err);
    return jsonError(500, 'internal error');
  }
```

(trigger route: 201 on success as before; approve/reject: 200; promote: 201.)

Boundary serialization — in `src/app/api/baselines/[id]/route.ts` GET/PATCH responses and `src/app/api/projects/[id]/baselines/route.ts` POST response, return `{ ...baseline, maskSelectors: JSON.parse(baseline.maskSelectors) as string[] }` (for GET's included targets, spread at the top level only). In `src/app/api/runs/[id]/route.ts` and the runs list route, return runs with `viewportIds: JSON.parse(run.viewportIds) as string[]`.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green (102+ tests), build clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-error.ts src/lib/run-service.ts src/lib/approval.ts src/app/api tests/
git commit -m "refactor: typed ApiError status mapping and array serialization at API boundary"
```

---

### Task 2: UI foundation — Tailwind v4, shadcn/ui, tokens, app shell

**Files:**
- Create: `src/app/globals.css`, `src/components/status-badge.tsx`, `src/components/viewport-chip.tsx`, `src/components/app-sidebar.tsx`, `components.json` + `src/components/ui/*` + `src/lib/utils.ts` (shadcn CLI)
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `package.json`, `vitest.config.ts`
- Test: `tests/ui/status-badge.test.tsx`

**Interfaces:**
- Produces: design tokens as CSS vars + Tailwind theme (usable as `bg-surface`, `text-muted`, `text-status-pass`, etc.); `<StatusBadge kind="visual|functional|run|version" value={string}>`; `<ViewportChip name width height>`; sidebar shell with nav (Projects, Approvals). Every later task consumes these.

- [ ] **Step 1: Install dependencies**

```bash
npm install tailwindcss @tailwindcss/postcss postcss
npm install -D @testing-library/react @testing-library/user-event jsdom @vitejs/plugin-react
```

Create `postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

- [ ] **Step 2: Create `src/app/globals.css`** (Tailwind v4 CSS-first config — tokens ARE the theme)

```css
@import 'tailwindcss';

@theme {
  --color-bg: #101214;
  --color-surface: #17191d;
  --color-surface-2: #1e2126;
  --color-border: #2a2e34;
  --color-text: #e8eaed;
  --color-muted: #9aa0a6;
  --color-accent: #ff2da8;
  --color-status-pass: #3dd68c;
  --color-status-diff: #ff2da8;
  --color-status-fail: #ff5c5c;
  --color-status-new: #58a6ff;
  --color-status-pending: #f0b429;
  --font-display: var(--font-archivo);
  --font-body: var(--font-instrument);
  --font-mono: var(--font-jetbrains);
  --radius: 0.375rem;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}

*:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Initialize shadcn/ui and add primitives**

```bash
npx shadcn@latest init --yes -b neutral
npx shadcn@latest add button dialog input label select table tabs badge slider switch textarea --yes
```

If `init` demands interactive answers despite flags, create `components.json` manually:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```
then re-run the `add` command. shadcn's generated neutral variables coexist with our tokens; where shadcn components use `--background`/`--foreground` etc., override those vars in `globals.css` after init to point at our palette:
```css
:root {
  --background: #101214; --foreground: #e8eaed;
  --card: #17191d; --card-foreground: #e8eaed;
  --popover: #17191d; --popover-foreground: #e8eaed;
  --primary: #ff2da8; --primary-foreground: #101214;
  --secondary: #1e2126; --secondary-foreground: #e8eaed;
  --muted: #1e2126; --muted-foreground: #9aa0a6;
  --accent: #1e2126; --accent-foreground: #e8eaed;
  --destructive: #ff5c5c; --border: #2a2e34; --input: #2a2e34; --ring: #ff2da8;
}
```

- [ ] **Step 4: Rewrite `src/app/layout.tsx`** — fonts + shell

```tsx
import type { Metadata } from 'next';
import { Archivo, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { AppSidebar } from '@/components/app-sidebar';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' });
const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = { title: 'VRT', description: 'Visual regression testing' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <AppSidebar />
          <main className="flex-1 overflow-x-hidden p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

`src/components/app-sidebar.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/projects', label: 'Projects' },
  { href: '/approvals', label: 'Approvals' },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r border-border bg-surface p-4">
      <Link href="/projects" className="mb-6 block font-display text-lg font-semibold tracking-tight">
        VRT<span className="text-accent">.</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-3 py-2 text-sm ${
                active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

`src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/projects');
}
```

- [ ] **Step 5: Write the failing badge test**

`tests/ui/status-badge.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/status-badge';

describe('StatusBadge', () => {
  it('renders the value with the matching status class', () => {
    render(<StatusBadge kind="visual" value="diff" />);
    const badge = screen.getByText('diff');
    expect(badge.className).toContain('status-diff');
  });

  it('falls back to muted styling for unknown values', () => {
    render(<StatusBadge kind="run" value="queued" />);
    expect(screen.getByText('queued').className).toContain('muted');
  });
});
```

Add react plugin + jsdom support to `vitest.config.ts` (keep existing settings):
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/ui/status-badge.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 7: Implement the primitives**

`src/components/status-badge.tsx`:
```tsx
const STATUS_COLOR: Record<string, string> = {
  pass: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  diff: 'text-status-diff border-status-diff/40 bg-status-diff/10 status-diff',
  fail: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
  new: 'text-status-new border-status-new/40 bg-status-new/10 status-new',
  done: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  failed: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
  running: 'text-status-new border-status-new/40 bg-status-new/10 status-new',
  pending: 'text-status-pending border-status-pending/40 bg-status-pending/10 status-pending',
  approved: 'text-status-pass border-status-pass/40 bg-status-pass/10 status-pass',
  rejected: 'text-status-fail border-status-fail/40 bg-status-fail/10 status-fail',
};

export function StatusBadge({ kind, value }: { kind: 'visual' | 'functional' | 'run' | 'version'; value: string }) {
  const color = STATUS_COLOR[value] ?? 'text-muted border-border bg-surface-2 muted';
  return (
    <span
      data-kind={kind}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs ${color}`}
    >
      {value}
    </span>
  );
}
```

`src/components/viewport-chip.tsx`:
```tsx
export function ViewportChip({ name, width, height }: { name: string; width: number; height: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
      {name}
      <span className="text-text">
        {width}×{height}
      </span>
    </span>
  );
}
```

- [ ] **Step 8: Verify**

Run: `npx vitest run tests/ui/status-badge.test.tsx && npm test && npm run typecheck && npm run build`
Expected: all green; build clean (fonts fetched at build — if the sandbox blocks Google Fonts at build time, switch to `next/font/local` with a note, or verify build offline behavior; report as concern if hit).

- [ ] **Step 9: Commit**

```bash
git add src/app src/components src/lib/utils.ts components.json postcss.config.mjs package.json package-lock.json vitest.config.ts tests/ui
git commit -m "feat: dashboard foundation — Tailwind v4 tokens, shadcn/ui, app shell, status primitives"
```

---

### Task 3: Typed API client

**Files:**
- Create: `src/lib/client.ts`
- Test: `tests/ui/client.test.ts`

**Interfaces:**
- Produces (every page consumes these — exact names):
  - Types: `Project`, `ProjectSummary` (list item with `lastRun`, `failedResultCount`), `ProjectDetail` (with environments/viewports/baselines), `Baseline`, `BaselineDetail` (targets + versions), `Viewport`, `Environment`, `Run`, `RunSummary` (list item with `resultCount`/`failedResultCount`), `RunDetail` (results with baseline/viewport/logEntries), `RunResult`, `LogEntry`, `BaselineVersion`, `PendingVersion`, `IgnoreRule` — mirror Phase 2a response shapes (`maskSelectors: string[]`, `viewportIds: string[]` per Task 1).
  - `api.<resource>.<verb>` namespace: `api.projects.list/get/create/update/delete`, `api.environments.create/update/delete`, `api.viewports.create/update/delete`, `api.baselines.create/get/update/delete/uploadVersion`, `api.versions.approve/reject/pending`, `api.results.promote`, `api.runs.trigger/list/get`, `api.ignoreRules.list/create/update/delete/fromLogEntry`.
  - `imageUrl(relPath: string): string` → `/api/images/${relPath}`.
  - `runEventsUrl(runId: string): string` → `/api/runs/${runId}/events`.
  - `ApiClientError extends Error { status: number }` thrown on non-2xx with the server's `{ error }` message.

- [ ] **Step 1: Write the failing test** (unit-test the request core with a stubbed global fetch — the API itself is integration-tested in Phase 2a; this pins client behavior: URL construction, error surfacing, JSON vs binary bodies)

`tests/ui/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, imageUrl, runEventsUrl, ApiClientError } from '@/lib/client';

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), { status })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('GETs and returns parsed JSON', async () => {
    const fn = stubFetch(200, { projects: [] });
    const out = await api.projects.list();
    expect(fn).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'GET' }));
    expect(out.projects).toEqual([]);
  });

  it('POSTs JSON bodies', async () => {
    const fn = stubFetch(201, { id: 'p1', name: 'demo' });
    await api.projects.create({ name: 'demo' });
    const [, init] = fn.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'demo' });
  });

  it('throws ApiClientError with server message on non-2xx', async () => {
    stubFetch(409, { error: 'only pending versions can be approved' });
    await expect(api.versions.approve('v1')).rejects.toMatchObject({
      status: 409,
      message: 'only pending versions can be approved',
    });
    stubFetch(409, { error: 'x' });
    await expect(api.versions.approve('v1')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('sends raw bytes for uploads', async () => {
    const fn = stubFetch(201, { id: 'v1', status: 'pending' });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await api.baselines.uploadVersion('b1', 'vp1', bytes);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/baselines/b1/targets/vp1/versions');
    expect(init.body).toBe(bytes);
  });

  it('returns undefined for 204 deletes', async () => {
    stubFetch(204, null);
    await expect(api.projects.delete('p1')).resolves.toBeUndefined();
  });

  it('builds image and SSE urls', () => {
    expect(imageUrl('captures/x.png')).toBe('/api/images/captures/x.png');
    expect(runEventsUrl('r1')).toBe('/api/runs/r1/events');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/client.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `src/lib/client.ts`**

```ts
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof Uint8Array) {
    init.body = body;
    init.headers = { 'content-type': 'image/png' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body — keep default message */
    }
    throw new ApiClientError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ——— types (mirror Phase 2a responses) ———

export interface Environment { id: string; projectId: string; name: string; baseUrl: string }
export interface Viewport { id: string; projectId: string; name: string; width: number; height: number }
export interface BaselineVersion { id: string; targetId: string; imagePath: string; status: string; isActive: boolean; createdAt: string }
export interface BaselineTarget { id: string; baselineId: string; viewportId: string; viewport?: Viewport; versions?: BaselineVersion[] }
export interface Baseline { id: string; projectId: string; name: string; pagePath: string; elementSelector: string | null; diffThreshold: number | null; maskSelectors: string[]; sourceType: string; syncStatus: string; targets?: BaselineTarget[] }
export interface Project { id: string; name: string; diffThreshold: number; createdAt: string }
export interface ProjectSummary extends Project { lastRun: { id: string; status: string; createdAt: string } | null; failedResultCount: number }
export interface ProjectDetail extends Project { environments: Environment[]; viewports: Viewport[]; baselines: Baseline[] }
export interface LogEntry { id: string; type: string; origin: string; message: string; url: string | null; httpStatus: number | null; stack: string | null; ignored: boolean; ignoreRuleId: string | null; timestamp: string }
export interface RunResult { id: string; runId: string; baselineId: string; viewportId: string; captureImagePath: string | null; referenceImagePath: string | null; diffImagePath: string | null; visualStatus: string | null; functionalStatus: string | null; diffRatio: number | null; sizeMismatch: boolean; error: string | null; baseline: { id: string; name: string; elementSelector: string | null }; viewport: Viewport; logEntries: LogEntry[] }
export interface Run { id: string; projectId: string; environmentId: string; referenceEnvironmentId: string | null; type: string; trigger: string; status: string; viewportIds: string[]; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
export interface RunSummary extends Run { environment: { id: string; name: string }; resultCount: number; failedResultCount: number }
export interface RunDetail extends Run { environment: Environment; referenceEnvironment: Environment | null; results: RunResult[] }
export interface PendingVersion extends BaselineVersion { target: { id: string; viewport: Viewport; baseline: { id: string; name: string; project: { id: string; name: string } } } }
export interface IgnoreRule { id: string; projectId: string; entryType: string | null; urlPattern: string | null; messagePattern: string | null; reason: string }

// ——— client ———

export const api = {
  projects: {
    list: () => request<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
    get: (id: string) => request<ProjectDetail>('GET', `/api/projects/${id}`),
    create: (body: { name: string; diffThreshold?: number }) => request<Project>('POST', '/api/projects', body),
    update: (id: string, body: { name?: string; diffThreshold?: number }) => request<Project>('PATCH', `/api/projects/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/projects/${id}`),
  },
  environments: {
    create: (projectId: string, body: { name: string; baseUrl: string }) => request<Environment>('POST', `/api/projects/${projectId}/environments`, body),
    update: (id: string, body: { name?: string; baseUrl?: string }) => request<Environment>('PATCH', `/api/environments/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/environments/${id}`),
  },
  viewports: {
    create: (projectId: string, body: { name: string; width: number; height: number }) => request<Viewport>('POST', `/api/projects/${projectId}/viewports`, body),
    update: (id: string, body: { name?: string; width?: number; height?: number }) => request<Viewport>('PATCH', `/api/viewports/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/viewports/${id}`),
  },
  baselines: {
    create: (projectId: string, body: { name: string; pagePath: string; elementSelector?: string; diffThreshold?: number; maskSelectors?: string[]; sourceType: 'upload' | 'capture'; viewportIds?: string[] }) => request<Baseline>('POST', `/api/projects/${projectId}/baselines`, body),
    get: (id: string) => request<Baseline>('GET', `/api/baselines/${id}`),
    update: (id: string, body: Partial<{ name: string; pagePath: string; elementSelector: string | null; diffThreshold: number | null; maskSelectors: string[] }>) => request<Baseline>('PATCH', `/api/baselines/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/baselines/${id}`),
    uploadVersion: (baselineId: string, viewportId: string, png: Uint8Array) => request<BaselineVersion>('POST', `/api/baselines/${baselineId}/targets/${viewportId}/versions`, png),
  },
  versions: {
    approve: (id: string) => request<BaselineVersion>('POST', `/api/versions/${id}/approve`),
    reject: (id: string) => request<BaselineVersion>('POST', `/api/versions/${id}/reject`),
    pending: () => request<{ versions: PendingVersion[] }>('GET', '/api/pending-versions'),
  },
  results: {
    promote: (id: string) => request<BaselineVersion>('POST', `/api/results/${id}/promote`),
  },
  runs: {
    trigger: (projectId: string, body: { environmentId: string; type?: 'visual' | 'compare'; referenceEnvironmentId?: string; viewportIds?: string[] }) => request<Run>('POST', `/api/projects/${projectId}/runs`, body),
    list: (projectId: string) => request<{ runs: RunSummary[] }>('GET', `/api/projects/${projectId}/runs`),
    get: (id: string) => request<RunDetail>('GET', `/api/runs/${id}`),
  },
  ignoreRules: {
    list: (projectId: string) => request<{ rules: IgnoreRule[] }>('GET', `/api/projects/${projectId}/ignore-rules`),
    create: (projectId: string, body: { reason: string; entryType?: string; urlPattern?: string; messagePattern?: string }) => request<IgnoreRule>('POST', `/api/projects/${projectId}/ignore-rules`, body),
    update: (id: string, body: Partial<{ reason: string; entryType: string | null; urlPattern: string | null; messagePattern: string | null }>) => request<IgnoreRule>('PATCH', `/api/ignore-rules/${id}`, body),
    delete: (id: string) => request<undefined>('DELETE', `/api/ignore-rules/${id}`),
    fromLogEntry: (logEntryId: string, reason: string) => request<{ rule: IgnoreRule; entry: LogEntry }>('POST', `/api/log-entries/${logEntryId}/ignore-rule`, { reason }),
  },
};

export function imageUrl(relPath: string): string {
  return `/api/images/${relPath}`;
}

export function runEventsUrl(runId: string): string {
  return `/api/runs/${runId}/events`;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/client.test.ts && npm test && npm run typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client.ts tests/ui/client.test.ts
git commit -m "feat: typed API client for the dashboard"
```

---

### Task 4: Projects list page

**Files:**
- Create: `src/app/(dashboard)/projects/page.tsx`, `src/components/project-card.tsx`, `src/components/create-project-dialog.tsx`
- Test: `tests/ui/project-card.test.tsx`

**Interfaces:**
- Consumes: `api.projects.list/create`, `StatusBadge`, `ProjectSummary`.
- Produces: `/projects` — card grid; each card: project name (display font), last-run status badge + relative time, failing-result count badge in `--fail` when > 0; "New project" button opens create dialog (name + optional diffThreshold); card links to `/projects/[id]`. Empty state: "No projects yet — create one to start capturing baselines."

- [ ] **Step 1: Write the failing test**

`tests/ui/project-card.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCard } from '@/components/project-card';
import type { ProjectSummary } from '@/lib/client';

const base: ProjectSummary = {
  id: 'p1',
  name: 'marketing-site',
  diffThreshold: 0.01,
  createdAt: new Date().toISOString(),
  lastRun: { id: 'r1', status: 'done', createdAt: new Date().toISOString() },
  failedResultCount: 3,
};

describe('ProjectCard', () => {
  it('shows name, last-run status, and failing count', () => {
    render(<ProjectCard project={base} />);
    expect(screen.getByText('marketing-site')).toBeDefined();
    expect(screen.getByText('done')).toBeDefined();
    expect(screen.getByText('3 failing')).toBeDefined();
  });

  it('omits failing badge at zero and handles no runs', () => {
    render(<ProjectCard project={{ ...base, lastRun: null, failedResultCount: 0 }} />);
    expect(screen.queryByText(/failing/)).toBeNull();
    expect(screen.getByText('no runs yet')).toBeDefined();
  });

  it('links to the project page', () => {
    render(<ProjectCard project={base} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects/p1');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui/project-card.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/components/project-card.tsx`:
```tsx
import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import type { ProjectSummary } from '@/lib/client';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-md border border-border bg-surface p-4 transition-colors hover:border-muted"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight">{project.name}</h2>
        {project.failedResultCount > 0 && (
          <span className="rounded border border-status-fail/40 bg-status-fail/10 px-1.5 py-0.5 font-mono text-xs text-status-fail">
            {project.failedResultCount} failing
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        {project.lastRun ? (
          <>
            <StatusBadge kind="run" value={project.lastRun.status} />
            <span className="font-mono">{new Date(project.lastRun.createdAt).toLocaleString()}</span>
          </>
        ) : (
          <span>no runs yet</span>
        )}
      </div>
    </Link>
  );
}
```

`src/components/create-project-dialog.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await api.projects.create({ name });
      setOpen(false);
      setName('');
      onCreated();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-status-fail">{error}</p>}
          <Button type="submit" disabled={busy || name.length === 0}>
            Create project
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/app/(dashboard)/projects/page.tsx`:
```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectSummary } from '@/lib/client';
import { ProjectCard } from '@/components/project-card';
import { CreateProjectDialog } from '@/components/create-project-dialog';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.projects
      .list()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Projects</h1>
        <CreateProjectDialog onCreated={load} />
      </div>
      {error && <p className="text-sm text-status-fail">{error}</p>}
      {projects && projects.length === 0 && (
        <p className="text-sm text-muted">No projects yet — create one to start capturing baselines.</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/project-card.test.tsx && npm test && npm run typecheck && npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: projects list page with create dialog"
```

---

### Task 5: Project settings page

**Files:**
- Create: `src/app/(dashboard)/projects/[id]/settings/page.tsx`, `src/components/settings/environments-table.tsx`, `src/components/settings/viewports-table.tsx`, `src/components/settings/ignore-rules-table.tsx`
- Test: `tests/ui/settings-tables.test.tsx`

**Interfaces:**
- Consumes: `api.environments.*`, `api.viewports.*`, `api.ignoreRules.list/create/update/delete`, `api.projects.get`, `ViewportChip`.
- Produces: `/projects/[id]/settings` with three sections. Each table: rows + inline add-form. Environments: name, baseUrl (mono). Viewports: name, width, height, rendered chip preview; **viewport presets** offered as quick-add buttons: `mobile 375×812`, `tablet 768×1024`, `desktop 1440×900` (spec: presets offered at creation, freely editable). Ignore rules: reason, entryType select (5 types + any), urlPattern, messagePattern (mono inputs), delete per row. All tables presentational components taking `items` + callback props (`onAdd`, `onDelete`) — page container wires them to the client.

- [ ] **Step 1: Write the failing test** — render `ViewportsTable` with items + `vi.fn()` callbacks: preset button click calls `onAdd({ name: 'mobile', width: 375, height: 812 })`; custom add-form submits parsed ints; delete button per row calls `onDelete(id)`. Render `IgnoreRulesTable`: shows reason + patterns in mono, add-form requires reason and at least one criterion before enabling submit (button disabled otherwise).

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewportsTable } from '@/components/settings/viewports-table';
import { IgnoreRulesTable } from '@/components/settings/ignore-rules-table';

describe('ViewportsTable', () => {
  it('quick-adds presets', () => {
    const onAdd = vi.fn();
    render(<ViewportsTable items={[]} onAdd={onAdd} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('mobile 375×812'));
    expect(onAdd).toHaveBeenCalledWith({ name: 'mobile', width: 375, height: 812 });
  });

  it('deletes a row', () => {
    const onDelete = vi.fn();
    render(
      <ViewportsTable
        items={[{ id: 'v1', projectId: 'p', name: 'desktop', width: 1440, height: 900 }]}
        onAdd={vi.fn()}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByLabelText('Delete desktop'));
    expect(onDelete).toHaveBeenCalledWith('v1');
  });
});

describe('IgnoreRulesTable', () => {
  it('disables add until reason and one criterion are set', () => {
    render(<IgnoreRulesTable items={[]} onAdd={vi.fn()} onDelete={vi.fn()} />);
    const button = screen.getByText('Add rule') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'third-party noise' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Message pattern'), { target: { value: 'analytics' } });
    expect(button.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/ui/settings-tables.test.tsx`

- [ ] **Step 3: Implement the three tables + page.** Tables are `'use client'` presentational components with the prop contracts above (`items`, `onAdd`, `onDelete`; environments also `onUpdate` optional — skip inline edit, delete + re-add covers phase needs). Viewports table renders `ViewportChip` per row and the three preset buttons (label text exactly `mobile 375×812` etc.). IgnoreRules entryType select offers `any` (maps to omitted) + the 5 LOG_TYPES (import from `@/lib/collector`). The page container (`settings/page.tsx`, `'use client'`) loads `api.projects.get(id)` + `api.ignoreRules.list(id)` (use `use client` + `useParams()`), wires callbacks (each mutate → reload), renders the three sections under `font-display` h2s ("Environments", "Viewports", "Ignore rules") plus a back-link to the project. Follow Task 4's page pattern (useState/useCallback/useEffect, error line, mono for technical values).

- [ ] **Step 4: Verify** — focused test, `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: project settings — environments, viewports, ignore rules"
```

---

### Task 6: Project detail — baseline grid + baseline dialog + upload

**Files:**
- Create: `src/app/(dashboard)/projects/[id]/page.tsx`, `src/components/baseline-grid.tsx`, `src/components/baseline-dialog.tsx`
- Test: `tests/ui/baseline-grid.test.tsx`

**Interfaces:**
- Consumes: `api.projects.get`, `api.baselines.*`, `imageUrl`, `ViewportChip`, `StatusBadge`.
- Produces: `/projects/[id]`: header (project name display-font, settings link, RunNowDialog slot — Task 7 fills it), baseline grid. Each baseline card: thumbnail (active approved version of the FIRST target with one, else "no baseline yet" placeholder box), name, pagePath (mono), `elementSelector` chip when set (mono, prefixed `⌖`), viewport chips per target, sourceType label, sync-error badge when `syncStatus === 'sync-error'`. "New baseline" opens `BaselineDialog` (name, pagePath, sourceType select upload|capture, optional elementSelector, optional diffThreshold, maskSelectors as one-per-line textarea, viewport subset checkboxes defaulting all). Per-card "Upload PNG" (when any target exists): file input → `api.baselines.uploadVersion(baselineId, viewportId, bytes)` for a selected viewport; validate `.png` extension client-side; surface server errors.
- `BaselineGrid` is presentational: `baselines`, `viewports`, `onUpload(baselineId, viewportId, bytes)`, `onEdit(baseline)`, `onDelete(id)` props.

- [ ] **Step 1: Write the failing test** — `BaselineGrid` with two baselines (one with an active approved version → `<img>` src contains `/api/images/`; one without → placeholder text "no baseline yet"); sync-error badge renders; viewport chips render per target; delete button calls `onDelete`.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BaselineGrid } from '@/components/baseline-grid';
import type { Baseline, Viewport } from '@/lib/client';

const viewports: Viewport[] = [{ id: 'vp1', projectId: 'p', name: 'desktop', width: 1440, height: 900 }];

function baseline(overrides: Partial<Baseline>): Baseline {
  return {
    id: 'b1',
    projectId: 'p',
    name: 'home',
    pagePath: '/',
    elementSelector: null,
    diffThreshold: null,
    maskSelectors: [],
    sourceType: 'capture',
    syncStatus: 'ok',
    targets: [
      {
        id: 't1',
        baselineId: 'b1',
        viewportId: 'vp1',
        versions: [{ id: 'v1', targetId: 't1', imagePath: 'baselines/x.png', status: 'approved', isActive: true, createdAt: '' }],
      },
    ],
    ...overrides,
  };
}

describe('BaselineGrid', () => {
  it('shows active-version thumbnail when present, placeholder otherwise', () => {
    render(
      <BaselineGrid
        baselines={[baseline({}), baseline({ id: 'b2', name: 'nav', targets: [{ id: 't2', baselineId: 'b2', viewportId: 'vp1', versions: [] }] })]}
        viewports={viewports}
        onUpload={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toContain('/api/images/baselines/x.png');
    expect(screen.getByText('no baseline yet')).toBeDefined();
  });

  it('flags sync errors', () => {
    render(
      <BaselineGrid baselines={[baseline({ syncStatus: 'sync-error' })]} viewports={viewports} onUpload={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText('sync-error')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `BaselineGrid` (cards as described; thumbnail `<img className="h-32 w-full rounded-t-md border-b border-border object-cover object-top bg-surface-2">`), `BaselineDialog` (form per interface; maskSelectors textarea split on newlines, trimmed, empties dropped; edit mode pre-fills; submit calls `onSubmit(values)` prop), and the page container (loads project detail, renders header + grid, wires create/edit/delete/upload to the client, reload after each mutation). Upload UX: per-card select (viewport) + file input inside a small popover or inline row — keep simple: a details/summary block per card. Read file via `new Uint8Array(await file.arrayBuffer())`.

- [ ] **Step 4: Verify** — focused, `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: project detail with baseline grid, baseline dialog, PNG upload"
```

---

### Task 7: Run trigger dialog + runs list

**Files:**
- Create: `src/components/run-now-dialog.tsx`, `src/components/runs-list.tsx`
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx` (mount both)
- Test: `tests/ui/run-now-dialog.test.tsx`

**Interfaces:**
- Consumes: `api.runs.trigger/list`, `StatusBadge`, `ViewportChip`, `ProjectDetail`.
- Produces: `RunNowDialog` props: `project: ProjectDetail`, `onTriggered(run)`. Form: environment select (required), run type radio visual|compare, reference-environment select shown ONLY for compare (required then, options exclude the chosen test environment), viewport multi-select checkboxes default ALL checked (all checked → send `viewportIds: undefined` = all; subset → explicit ids). Submit → `api.runs.trigger` → `onTriggered(run)` (page navigates to `/runs/[id]`). Disabled submit until valid. `RunsList` (presentational, `runs: RunSummary[]`): table rows — created time (mono), type, environment name, StatusBadge, `failedResultCount/resultCount` (mono, fail-colored when > 0), row links to `/runs/[id]`.

- [ ] **Step 1: Write the failing test** — RunNowDialog rendered open with a 2-env/2-viewport project + `vi.fn()` trigger spy injected via a `triggerFn` prop defaulting to `api.runs.trigger` (dependency-inject for testability): compare type without reference disables submit; selecting reference enables; unchecking one viewport sends explicit array; all-checked sends undefined viewportIds. (Render with `open` controlled — expose `defaultOpen` prop for the test.)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunNowDialog } from '@/components/run-now-dialog';
import type { ProjectDetail } from '@/lib/client';

const project: ProjectDetail = {
  id: 'p1', name: 'demo', diffThreshold: 0.01, createdAt: '',
  environments: [
    { id: 'e1', projectId: 'p1', name: 'staging', baseUrl: 'http://s' },
    { id: 'e2', projectId: 'p1', name: 'production', baseUrl: 'http://p' },
  ],
  viewports: [
    { id: 'v1', projectId: 'p1', name: 'mobile', width: 375, height: 812 },
    { id: 'v2', projectId: 'p1', name: 'desktop', width: 1440, height: 900 },
  ],
  baselines: [],
};

function setup(triggerFn = vi.fn().mockResolvedValue({ id: 'r1' })) {
  render(<RunNowDialog project={project} onTriggered={vi.fn()} triggerFn={triggerFn} defaultOpen />);
  return triggerFn;
}

describe('RunNowDialog', () => {
  it('requires a reference environment for compare runs', () => {
    setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByLabelText('compare'));
    const submit = screen.getByText('Start run') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('production'));
    expect(submit.disabled).toBe(false);
  });

  it('sends explicit viewportIds only for a subset', async () => {
    const trigger = setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByLabelText('desktop 1440×900')); // uncheck
    fireEvent.click(screen.getByText('Start run'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(trigger.mock.calls[0][1]).toMatchObject({ environmentId: 'e1', viewportIds: ['v1'] });
  });

  it('sends undefined viewportIds when all are selected', async () => {
    const trigger = setup();
    fireEvent.click(screen.getByLabelText('staging'));
    fireEvent.click(screen.getByText('Start run'));
    await waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(trigger.mock.calls[0][1].viewportIds).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** both components per the interface (environment/reference as radio-style labeled options or shadcn Select — use plain labeled radios/checkboxes for testability; viewport checkbox labels exactly `name width×height`). Page: mount `RunNowDialog` in header (`onTriggered` → `router.push('/runs/' + run.id)`), `RunsList` below the baseline grid fed by `api.runs.list`.

- [ ] **Step 4: Verify** — focused, `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: run trigger dialog and runs list"
```

---

### Task 8: Run detail page — results, filters, SSE progress

**Files:**
- Create: `src/app/(dashboard)/runs/[id]/page.tsx`, `src/components/run-progress.tsx`, `src/components/result-list.tsx`
- Test: `tests/ui/result-list.test.tsx`

**Interfaces:**
- Consumes: `api.runs.get`, `runEventsUrl`, `StatusBadge`, `ViewportChip`, `RunDetail`, `RunResult`.
- Produces:
  - `ResultList` (presentational): props `results: RunResult[]`, `selectedId: string | null`, `onSelect(id)`, `statusFilter: 'all' | 'visual-fail' | 'functional-fail' | 'pass'`, `onFilterChange`, `viewportFilter: string | null` (viewport id), `onViewportFilterChange`, `viewports: Viewport[]`. Groups results by baseline name; per row: baseline name, ViewportChip, visual + functional StatusBadges, diffRatio (mono, 4 decimals) when set, sizeMismatch warning icon `⚠` with `title="size mismatch"`, non-ignored test-origin log count. Filters: status pill group + viewport pill group (tabs). `visual-fail` = visualStatus diff|fail; `functional-fail` = functionalStatus fail; `pass` = visual pass|new AND functional pass|null.
  - `RunProgress`: props `run: RunDetail`, `expectedCount: number | null`, `completedCount: number`; renders StatusBadge + `completed/expected` (mono) + accent progress bar while running.
  - Page: loads run; while status queued/running opens `EventSource(runEventsUrl(id))` — on `result` event increments completed + refetches run detail (cheap, keeps one data path); on terminal `status` event closes stream + final refetch. Left column ResultList, right column comparison viewer (Task 9 placeholder: selected result's capture image full-width `<img>` for now). Compare-run header note: "reference (live) left — test (dev) right".

- [ ] **Step 1: Write the failing test** — `ResultList` with 4 results (pass / diff / functional-fail / capture-fail with error): groups by baseline name; filter `visual-fail` shows diff+fail rows only; filter `functional-fail` shows the functional failure; viewport filter narrows; clicking a row calls `onSelect`; ignored/reference log entries are NOT counted in the log badge (feed one result logEntries: 1 test non-ignored, 1 test ignored, 1 reference → badge shows 1).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the three files. SSE wiring in the page:

```tsx
useEffect(() => {
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  const es = new EventSource(runEventsUrl(run.id));
  es.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as { type: string; status?: string };
    if (event.type === 'result') {
      setCompleted((c) => c + 1);
      reload();
    } else if (event.type === 'status' && (event.status === 'done' || event.status === 'failed')) {
      es.close();
      reload();
    }
  };
  es.onerror = () => es.close();
  return () => es.close();
}, [run?.id, run?.status, reload]);
```

`expectedCount` = results.length once run is running (results rows are created eagerly per baseline×viewport) — show `completed/results.length`.

- [ ] **Step 4: Verify** — focused, `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: run detail page with grouped results, filters, live SSE progress"
```

---

### Task 9: Comparison viewer + approve

**Files:**
- Create: `src/components/comparison-viewer.tsx`
- Modify: `src/app/(dashboard)/runs/[id]/page.tsx` (replace placeholder)
- Test: `tests/ui/comparison-viewer.test.tsx`

**Interfaces:**
- Consumes: `imageUrl`, `api.results.promote` (injected as `promoteFn` prop for testability, defaulting to the client), `RunResult`, `StatusBadge`.
- Produces: `ComparisonViewer` props: `result: RunResult`, `runType: string`, `promoteFn?`, `onPromoted()`. Three modes as tabs — labels exactly `side by side`, `slider`, `diff`:
  - **side by side**: baseline/reference image LEFT, capture RIGHT (labels: visual runs `baseline` / `capture`; compare runs `reference (live)` / `test (dev)`); for `visualStatus='new'` or missing left image, left shows "no baseline" placeholder.
  - **slider**: images stacked; `<input type="range">` (aria-label `comparison slider`) controls `clip-path: inset(0 0 0 X%)` on the top (capture) layer.
  - **diff**: capture with the diff image absolutely overlaid (`mix-blend-mode: normal`, full opacity — pixelmatch output is transparent-ish/red on white; render diff image alone with a toggle `show capture underneath` switch).
  - Header row: visual + functional badges, diffRatio mono, sizeMismatch `⚠ size mismatch` warning in `--pending`, error message when visualStatus='fail'.
  - **Approve button** (`Approve as baseline`): visible only when `runType !== 'compare'` AND `result.captureImagePath` set; click → `promoteFn(result.id)` → success note "pending version created — review in Approvals" + `onPromoted()`; ApiClientError message shown inline.
  - Modes unavailable when images missing (slider/diff need both sides → tab disabled with `title` reason).

- [ ] **Step 1: Write the failing test** — diff-status result renders three tabs, switching to slider shows the range input; approve button hidden for compare runs, shown for visual, click calls injected promoteFn and shows the success note; 'new' result: slider + diff tabs disabled, side-by-side shows "no baseline".

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** per interface. Images: `max-h-[70vh] w-full object-contain bg-surface-2` inside bordered rounded boxes; mode state local; slider layering with a relative container and absolute top image.

- [ ] **Step 4: Verify** — focused, `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: comparison viewer with side-by-side, slider, diff modes and approve"
```

---

### Task 10: Log panel, one-click ignore, approval queue

**Files:**
- Create: `src/components/log-panel.tsx`, `src/app/(dashboard)/approvals/page.tsx`
- Modify: `src/app/(dashboard)/runs/[id]/page.tsx` (mount LogPanel under the viewer)
- Test: `tests/ui/log-panel.test.tsx`

**Interfaces:**
- Consumes: `api.ignoreRules.fromLogEntry` (injected `ignoreFn` prop), `api.versions.pending/approve/reject`, `imageUrl`, `StatusBadge`, `ViewportChip`, `LogEntry`, `PendingVersion`.
- Produces:
  - `LogPanel` props: `entries: LogEntry[]`, `ignoreFn?`, `onIgnored()`. Groups by `type` (the 5 LOG_TYPES order, empty groups omitted) with mono count per group; entry row: message (truncate + expand on click), url (mono, dimmed), httpStatus when set, origin tag `reference` in muted when reference-origin. Ignored entries: collapsed under a per-group toggle `n ignored` (grey, strikethrough-free, 60% opacity). Each non-ignored entry: `ignore` button → inline reason input + confirm → `ignoreFn(entry.id, reason)` → `onIgnored()`. Reference entries get no ignore button (informational).
  - Approvals page: loads `api.versions.pending()`; list grouped by project name; each row: thumbnail `<img>` (imageUrl of version), baseline name, ViewportChip, created time (mono), Approve / Reject buttons → `api.versions.approve/reject` → reload; empty state "Nothing pending — approved baselines are up to date."
  - Run detail page mounts `<LogPanel entries={selected.logEntries} onIgnored={reload}>` beneath the viewer.

- [ ] **Step 1: Write the failing test** — LogPanel: groups render with counts; ignored entries hidden until toggle; reference entry shows `reference` tag and no ignore button; ignore flow calls injected fn with (id, reason) after typing reason + confirm.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** both files per interface; wire LogPanel into the run page.

- [ ] **Step 4: Full verification** — `npm test && npm run typecheck && npm run build` (final Phase 2b gate). Additionally do a smoke check via dev server if the environment allows: `npm run dev` + seed script + trigger a run from the UI; report findings (screenshots optional).

- [ ] **Step 5: Commit**

```bash
git add src/app src/components tests/ui
git commit -m "feat: log panel with one-click ignore and cross-project approval queue"
```
