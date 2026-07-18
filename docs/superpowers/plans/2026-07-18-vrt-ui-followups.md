# VRT Small UI Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four small follow-ups deferred from the Phase 2b and backend-follow-up reviews: runner emit-order + stale comments, a shared `useLoad` hook (with stale-response guard, unified error copy, retry affordance), SSE reconnect-with-backoff on the run detail page, and a live denominator in the runs list.

**Architecture:** Task 1 is a runner ordering tweak + two comment fixes. Task 2 extracts the repeated load/error scaffold from the five page containers into `src/lib/use-load.ts` — the hook owns data/error/reload plus a monotonic sequence guard, and pages gain a uniform pre-data Retry button. Task 3 rebuilds the run detail SSE `onerror` handling to respect EventSource's native reconnection and add capped manual backoff for fatal closes. Task 4 is a one-line denominator swap in `runs-list.tsx` using the `expectedResultCount` field already on `RunSummary`.

**Tech Stack:** Next.js 16 App Router (client pages), React 19 hooks, vitest + RTL (`renderHook`) under jsdom.

## Global Constraints

- TypeScript strict; `npm test && npm run typecheck && npm run build` must pass after every task.
- UI data access ONLY through `src/lib/client.ts`; components never call `fetch` directly.
- Error copy convention (Task 2 makes it uniform everywhere): load failures → `failed to load`; mutation failures → `something went wrong`; `ApiClientError.message` wins when available in both cases.
- Numeric/technical data renders `font-mono` (don't regress existing usage).
- Test conventions: `tests/ui/*.test.tsx` with `// @vitest-environment jsdom` pragma, RTL, `.toBeDefined()` assertions (no jest-dom), no fetch mocking — hooks tested with `renderHook` + injected fake fetchers, never mocked `fetch`.
- jsdom has no `EventSource`; the SSE effect wiring stays untested (existing convention) — testable logic (backoff delay calc) must live in an exported pure helper with unit tests.
- All commits end with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## File Structure

```
src/lib/runner.ts                             — MODIFIED Task 1 (emit order)
src/app/(dashboard)/runs/[id]/page.tsx        — MODIFIED Tasks 1 (comment), 2 (useLoad), 3 (SSE reconnect)
src/components/comparison-viewer.tsx          — MODIFIED Task 1 (comment only)
src/lib/use-load.ts                           — CREATED Task 2 (shared hook)
src/app/(dashboard)/projects/page.tsx         — MODIFIED Task 2
src/app/(dashboard)/projects/[id]/page.tsx    — MODIFIED Task 2
src/app/(dashboard)/projects/[id]/settings/page.tsx — MODIFIED Task 2
src/app/(dashboard)/approvals/page.tsx        — MODIFIED Task 2
src/lib/sse-retry.ts                          — CREATED Task 3 (backoff helper)
src/components/runs-list.tsx                  — MODIFIED Task 4
tests/events.test.ts                          — possibly MODIFIED Task 1
tests/ui/use-load.test.tsx                    — CREATED Task 2
tests/ui/sse-retry.test.ts                    — CREATED Task 3
tests/ui/runs-list.test.tsx                   — MODIFIED Task 4
```

---

### Task 1: Runner emit-order + stale comments

**Files:**
- Modify: `src/lib/runner.ts` (move the `running` emit below the count persist)
- Modify: `src/app/(dashboard)/runs/[id]/page.tsx:68-74` (comment only)
- Modify: `src/components/comparison-viewer.tsx:~86-88` (comment only)
- Test: `tests/events.test.ts` (verify expectations still hold; extend if trivial)

**Interfaces:**
- Consumes: `emitRunEvent`, existing runner flow.
- Produces: SSE `running` status event is now guaranteed to fire only AFTER `expectedResultCount` is persisted — the run detail page's first `running`-triggered reload always sees the real total. No signature changes.

- [ ] **Step 1: Read `tests/events.test.ts`** and note what it asserts about event ordering (prior knowledge: it asserts `running` appears before the terminal event — the move must keep that true; it does, since both stay inside the try before the loop).

- [ ] **Step 2: Move the emit.** In `src/lib/runner.ts`, delete the line `emitRunEvent(runId, { type: 'status', status: 'running' });` (currently ~line 22, right after the status→running DB update) and re-insert it immediately AFTER the `expectedResultCount` persist (`await prisma.run.update({ where: { id: runId }, data: { expectedResultCount } });`, currently ~line 49) and BEFORE the `for` loop. Add a comment at the new location:

```ts
    // Emitted only after expectedResultCount is persisted, so the client's
    // running-triggered reload always sees the real total.
    emitRunEvent(runId, { type: 'status', status: 'running' });
```

Behavior note (acceptable, document in your report): a run that fails during enumeration (e.g. compare run without reference environment) now emits only the terminal `failed` event, never `running`. The page handles this — any `status` event triggers a reload.

- [ ] **Step 3: Soften the page comment.** In `src/app/(dashboard)/runs/[id]/page.tsx`, the comment block above `expectedCount` (currently lines ~68-74) — replace the sentence "so the true total is known as soon as the SSE `running` status event lands and we reload" with "and emits the `running` status event only after that persist, so the running-triggered reload sees the real total". Keep the rest of the block.

- [ ] **Step 4: Fix the viewer comment.** In `src/components/comparison-viewer.tsx`, the comment above `leftUnavailableText` that says a null path on a diff/pass/fail row means "a row predating this field" — extend it to also name errored results: rows where capture/diff threw before the final update (`visualStatus: 'fail'` via the runner's per-result catch) also never get `baselineImagePath` pinned, and "baseline image not available" is accurate for them too. Comment change only; no logic change.

- [ ] **Step 5: Run the affected suites.**

Run: `npx vitest run tests/events.test.ts tests/runner.test.ts`
Expected: all pass unchanged. If an events test pinned the exact pre-loop update count or ordering more tightly than "running before terminal", update that expectation to the new order and say so in your report.

- [ ] **Step 6: Full gate** — `npm test && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/runner.ts "src/app/(dashboard)/runs/[id]/page.tsx" src/components/comparison-viewer.tsx tests/events.test.ts
git commit -m "fix: emit running event after expectedResultCount persist; correct stale comments"
```

---

### Task 2: `useLoad` hook — shared load/error scaffold, stale-response guard, retry affordance

**Files:**
- Create: `src/lib/use-load.ts`
- Modify: `src/app/(dashboard)/projects/page.tsx`, `src/app/(dashboard)/projects/[id]/page.tsx`, `src/app/(dashboard)/projects/[id]/settings/page.tsx`, `src/app/(dashboard)/runs/[id]/page.tsx`, `src/app/(dashboard)/approvals/page.tsx`
- Test: `tests/ui/use-load.test.tsx`

**Interfaces:**
- Consumes: `ApiClientError` from `@/lib/client`.
- Produces (Tasks 3 uses `reload` from this hook on the run page):

```ts
export function useLoad<T>(fetcher: () => Promise<T>): {
  data: T | null;           // null until first success
  error: string | null;     // load-failure copy; cleared on success
  reload: () => void;       // re-runs fetcher; stale responses discarded
  fail: (e: unknown) => void; // mutation-failure reporter for child callbacks
}
```

The `fetcher` MUST be referentially stable (`useCallback` in the page) — the hook's effect re-runs when it changes, same as the current per-page `load` callbacks.

- [ ] **Step 1: Write the failing hook tests** — `tests/ui/use-load.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLoad } from '@/lib/use-load';
import { ApiClientError } from '@/lib/client';

describe('useLoad', () => {
  it('loads data on mount and clears error on success', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.resolve('hello')));
    await waitFor(() => expect(result.current.data).toBe('hello'));
    expect(result.current.error).toBeNull();
  });

  it('surfaces ApiClientError message on load failure, generic copy otherwise', async () => {
    const { result } = renderHook(() =>
      useLoad(() => Promise.reject(new ApiClientError(500, 'boom')))
    );
    await waitFor(() => expect(result.current.error).toBe('boom'));

    const { result: generic } = renderHook(() =>
      useLoad(() => Promise.reject(new Error('raw')))
    );
    await waitFor(() => expect(generic.current.error).toBe('failed to load'));
  });

  it('discards stale responses: only the latest reload call wins', async () => {
    let resolveFirst!: (v: string) => void;
    const responses: Array<Promise<string>> = [
      new Promise<string>((res) => { resolveFirst = res; }),
      Promise.resolve('second'),
    ];
    let call = 0;
    const fetcher = () => responses[call++];
    const { result } = renderHook(() => useLoad(fetcher));
    act(() => result.current.reload()); // second call resolves immediately
    await waitFor(() => expect(result.current.data).toBe('second'));
    act(() => resolveFirst('first')); // first (stale) resolves late
    await waitFor(() => expect(result.current.data).toBe('second')); // still second
  });

  it('fail() sets mutation copy', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.resolve('x')));
    await waitFor(() => expect(result.current.data).toBe('x'));
    act(() => result.current.fail(new Error('nope')));
    expect(result.current.error).toBe('something went wrong');
    act(() => result.current.fail(new ApiClientError(409, 'conflict')));
    expect(result.current.error).toBe('conflict');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/ui/use-load.test.tsx`
Expected: FAIL — module `@/lib/use-load` not found.

- [ ] **Step 3: Implement the hook** — `src/lib/use-load.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/client';

// Shared page-container load scaffold: data/error state, reload with a
// monotonic sequence guard (a stale in-flight response never overwrites a
// newer one), and a mutation-failure reporter for child callbacks.
export function useLoad<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    fetcher()
      .then((d) => {
        if (seq.current !== id) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (seq.current !== id) return;
        setError(e instanceof ApiClientError ? e.message : 'failed to load');
      });
  }, [fetcher]);

  useEffect(reload, [reload]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof ApiClientError ? e.message : 'something went wrong');
  }, []);

  return { data, error, reload, fail };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/ui/use-load.test.tsx`
Expected: 4/4 pass.

- [ ] **Step 5: Convert the five containers.** Pattern per page — replace the `useState`(data) + `useState`(error) + `useCallback` load + `useEffect` scaffold with `useLoad`; keep each page's `fetcher` as a `useCallback`. Combined loads return one object. Concretely:

  - `projects/page.tsx`: `const fetchProjects = useCallback(() => api.projects.list().then((r) => r.projects), []); const { data: projects, error, reload } = useLoad(fetchProjects);` — `CreateProjectDialog onCreated={reload}`. (This also fixes its off-convention `e instanceof Error` check — the hook uses `ApiClientError`.)
  - `projects/[id]/page.tsx`: fetcher returns `{ project, runs }` via the existing `Promise.all`; destructure `const project = data?.project ?? null; const runs = data?.runs ?? [];`. Replace `handleError` with the hook's `fail` in `deleteBaseline`/`uploadVersion`; `createBaseline`/`updateBaseline` keep returning promises to the dialog (unchanged).
  - `projects/[id]/settings/page.tsx`: fetcher returns `{ project, rules }`; replace `handleError` with `fail` in all mutation callbacks.
  - `runs/[id]/page.tsx`: `const fetchRun = useCallback(() => api.runs.get(runId), [runId]); const { data: run, error, reload } = useLoad(fetchRun);` — SSE effect and children keep using `reload` exactly as before.
  - `approvals/page.tsx`: `const fetchPending = useCallback(() => api.versions.pending().then((r) => r.versions), []);` — `ApprovalRow onDone={reload}`; the per-row `act()` error handling stays local (it is per-row mutation UI, not page scaffold).

  Copy unification falls out automatically: all load failures now say `failed to load` (settings/detail previously matched; projects list gains the `ApiClientError` check).

- [ ] **Step 6: Add the retry affordance.** In each of the five pages, the pre-data render branch (`data === null` / `!project` / `!run`) becomes: when `error` is set, render the error line plus a retry button directly under it:

```tsx
<div className="flex flex-col items-start gap-2">
  <p className="text-sm text-status-fail">{error}</p>
  <Button type="button" variant="outline" size="sm" onClick={reload}>
    Retry
  </Button>
</div>
```

(Import `Button` from `@/components/ui/button` where not already imported.) Post-data error banners (mutation failures / background reload failures) stay as the plain `<p>` they are today — Retry is only for the nothing-rendered-yet state.

- [ ] **Step 7: Full gate** — `npm test && npm run typecheck && npm run build`
Expected: all clean. Existing UI tests are component-level (not page-level), so none should break; if one does, it's asserting scaffold behavior you changed — fix the expectation to the new copy/behavior and note it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/use-load.ts tests/ui/use-load.test.tsx "src/app/(dashboard)/projects/page.tsx" "src/app/(dashboard)/projects/[id]/page.tsx" "src/app/(dashboard)/projects/[id]/settings/page.tsx" "src/app/(dashboard)/runs/[id]/page.tsx" "src/app/(dashboard)/approvals/page.tsx"
git commit -m "refactor: shared useLoad hook with stale-response guard, unified error copy, retry"
```

---

### Task 3: SSE reconnect-with-backoff on the run detail page

**Files:**
- Create: `src/lib/sse-retry.ts`
- Modify: `src/app/(dashboard)/runs/[id]/page.tsx` (SSE effect)
- Test: `tests/ui/sse-retry.test.ts`

**Interfaces:**
- Consumes: `useLoad`'s `reload` (Task 2), `runEventsUrl`.
- Produces: `nextRetryDelay(attempt: number): number` — exported pure helper, `Math.min(30_000, 1000 * 2 ** attempt)` (attempt 0 → 1s, 1 → 2s, … capped at 30s).

Background (why the current code is wrong): `EventSource` reconnects NATIVELY on transient errors — after `onerror`, `readyState` is `CONNECTING` while the browser retries, and `CLOSED` only on fatal failure. The current handler `es.onerror = () => es.close()` kills the native retry on the first blip. The fix: leave native reconnection alone; only when `readyState === EventSource.CLOSED` schedule a manual re-create with capped exponential backoff, and `reload()` on every re-establishment to catch events missed while disconnected.

- [ ] **Step 1: Write the failing helper test** — `tests/ui/sse-retry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextRetryDelay } from '@/lib/sse-retry';

describe('nextRetryDelay', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect(nextRetryDelay(0)).toBe(1000);
    expect(nextRetryDelay(1)).toBe(2000);
    expect(nextRetryDelay(4)).toBe(16000);
    expect(nextRetryDelay(5)).toBe(30000);
    expect(nextRetryDelay(50)).toBe(30000);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/ui/sse-retry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper** — `src/lib/sse-retry.ts`:

```ts
// Capped exponential backoff for manual EventSource re-creation after a
// fatal close (readyState CLOSED — the browser only auto-retries while
// readyState is CONNECTING).
export function nextRetryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/ui/sse-retry.test.ts`

- [ ] **Step 5: Rebuild the SSE effect.** In `src/app/(dashboard)/runs/[id]/page.tsx`, replace the current SSE `useEffect` body with:

```tsx
  useEffect(() => {
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
    const runId = run.id;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      es = new EventSource(runEventsUrl(runId));
      es.onopen = () => {
        attempt = 0;
      };
      es.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as { type: string; status?: string };
        if (event.type === 'result') {
          reload();
        } else if (event.type === 'status') {
          if (event.status === 'done' || event.status === 'failed') {
            stopped = true;
            es?.close();
          }
          reload();
        }
      };
      es.onerror = () => {
        // readyState CONNECTING = the browser is already retrying natively;
        // leave it alone. CLOSED = fatal — re-create with capped backoff and
        // refetch on re-establishment to catch anything missed meanwhile.
        if (stopped || !es || es.readyState !== EventSource.CLOSED) return;
        retryTimer = setTimeout(() => {
          if (stopped) return;
          reload();
          connect();
        }, nextRetryDelay(attempt++));
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [run?.id, run?.status, reload]);
```

Import `nextRetryDelay` from `@/lib/sse-retry`. Note the effect's deps are unchanged — teardown/reopen semantics on status transitions are the same as today; `stopped` prevents both the timer and a late `onerror` from resurrecting a closed stream after unmount or terminal status.

- [ ] **Step 6: Full gate** — `npm test && npm run typecheck && npm run build`
Expected: all clean (no existing test exercises the effect — jsdom has no EventSource).

- [ ] **Step 7: Commit**

```bash
git add src/lib/sse-retry.ts tests/ui/sse-retry.test.ts "src/app/(dashboard)/runs/[id]/page.tsx"
git commit -m "feat: SSE reconnect with capped backoff on run detail; respect native EventSource retry"
```

---

### Task 4: Runs-list live denominator

**Files:**
- Modify: `src/components/runs-list.tsx` (results cell)
- Test: `tests/ui/runs-list.test.tsx`

**Interfaces:**
- Consumes: `RunSummary.expectedResultCount: number | null` (already on the type — `RunSummary extends Run`), `RunSummary.resultCount`.
- Produces: results cell shows `failed/expected` when `expectedResultCount` is non-null, else `failed/resultCount` (pre-migration runs — identical to today).

- [ ] **Step 1: Write the failing test** — in `tests/ui/runs-list.test.tsx`, using the file's existing run-fixture builder (add `expectedResultCount: null` to its defaults first so existing tests pin the fallback):

```tsx
it('uses expectedResultCount as the denominator when present', () => {
  const run = makeRun({ status: 'running', resultCount: 3, failedResultCount: 1, expectedResultCount: 50 });
  render(<RunsList runs={[run]} />);
  expect(screen.getByText('1/50')).toBeDefined();
});

it('falls back to resultCount when expectedResultCount is null', () => {
  const run = makeRun({ resultCount: 4, failedResultCount: 0, expectedResultCount: null });
  render(<RunsList runs={[run]} />);
  expect(screen.getByText('0/4')).toBeDefined();
});
```

(Adapt builder name/shape to the file; if the fixtures are inline objects, add the field there.)

- [ ] **Step 2: Run to verify the first fails** — `npx vitest run tests/ui/runs-list.test.tsx`
Expected: first test FAILs (renders `1/3`); second passes already.

- [ ] **Step 3: Implement.** In `src/components/runs-list.tsx`, the results cell content becomes:

```tsx
          {run.failedResultCount}/{run.expectedResultCount ?? run.resultCount}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/ui/runs-list.test.tsx`

- [ ] **Step 5: Full gate** — `npm test && npm run typecheck && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/components/runs-list.tsx tests/ui/runs-list.test.tsx
git commit -m "feat: runs list shows expected-total denominator for in-flight runs"
```
