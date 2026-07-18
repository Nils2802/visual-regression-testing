# VRT Backend Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two backend fields deferred out of Phase 2b — `Run.expectedResultCount` (restores fractional run progress) and `RunResult.baselineImagePath` (enables slider mode + real side-by-side left pane on visual runs) — plus their UI consumption.

**Architecture:** Both are nullable columns filled by the runner (`src/lib/runner.ts`) and flow to the UI automatically through the existing serializers (`serializeRun` spreads the row; routes return full rows). Each task = schema field + runner write + client type + UI consumption + tests at both layers. No API route changes needed.

**Tech Stack:** Prisma 6 (SQLite, `prisma db push`, no migrations dir), Next.js 16, vitest (node for runner/API tests, jsdom for UI), RTL.

## Global Constraints

- TypeScript strict; `npm test && npm run typecheck && npm run build` must pass after every task.
- Schema changes: edit `prisma/schema.prisma`, then run `npm run db:push` (updates dev.db and regenerates the Prisma client). The test DB is force-reset from the schema by `tests/global-setup.ts` on every `npm test` — no extra step.
- UI data access ONLY through `src/lib/client.ts`; components never call `fetch` directly.
- Test conventions: runner tests in `tests/runner.test.ts` (node env, real test.db, follow existing seed helpers in that file); UI tests in `tests/ui/*.test.tsx` with `// @vitest-environment jsdom` pragma, RTL, `.toBeDefined()` assertions (no jest-dom), no fetch mocking.
- Design tokens binding (UI): numeric progress (`3/50`) renders in JetBrains Mono (`font-mono`) — already the case in `run-progress.tsx`; don't regress it.
- Do NOT fetch the baseline's *current* active version as the left image — the field exists precisely because the compared-against version must be pinned at compare time (a later approval would silently show a newer image than the one compared).
- All commits end with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## File Structure

```
prisma/schema.prisma                          — MODIFIED both tasks (one nullable column each)
src/lib/runner.ts                             — MODIFIED both tasks (write the fields)
src/lib/client.ts                             — MODIFIED both tasks (type additions)
src/app/(dashboard)/runs/[id]/page.tsx        — MODIFIED Task 1 (expectedCount derivation + SSE running reload)
src/components/run-progress.tsx               — unchanged (fractional branch becomes reachable)
src/components/comparison-viewer.tsx          — MODIFIED Task 2 (leftImagePath for visual runs)
tests/runner.test.ts                          — MODIFIED both tasks
tests/ui/run-progress.test.tsx                — MODIFIED Task 1
tests/ui/comparison-viewer.test.tsx           — MODIFIED Task 2
```

---

### Task 1: `Run.expectedResultCount` — fractional run progress

**Files:**
- Modify: `prisma/schema.prisma` (Run model, after `viewportIds`)
- Modify: `src/lib/runner.ts:31-44` (compute + persist before the loop)
- Modify: `src/lib/client.ts:49` (Run interface)
- Modify: `src/app/(dashboard)/runs/[id]/page.tsx:44-52` (SSE handler) and `:71` (expectedCount derivation)
- Test: `tests/runner.test.ts`, `tests/ui/run-progress.test.tsx`

**Interfaces:**
- Consumes: existing `executeRun(runId, browser)`, `serializeRun` (pass-through spread — no change needed), `RunProgress` props `{ run: RunDetail; expectedCount: number | null; completedCount: number }` (unchanged).
- Produces: `Run.expectedResultCount: number | null` on the Prisma model, in the `Run` client interface, and populated by the runner once enumeration is done. Task 2 does not depend on it.

- [ ] **Step 1: Write the failing runner test** — in `tests/runner.test.ts`, following that file's existing seed/execute helpers (read them first; reuse, don't duplicate). Scenario: project with 2 viewports, 2 baselines where baseline B's targets cover only 1 of the 2 viewports → 3 eligible pairs:

```ts
it('persists expectedResultCount from the eligible baseline×viewport pairs before processing', async () => {
  // seed: 2 viewports; baseline A targets both, baseline B targets only viewport 1
  // (use the file's existing seed helpers/patterns)
  await executeRun(run.id, browser);
  const updated = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
  expect(updated.expectedResultCount).toBe(3);
  expect(updated.results?.length ?? (await prisma.runResult.count({ where: { runId: run.id } }))).toBe(3);
});
```

(Adapt the assertion shape to the file's conventions; the essential assertions are `expectedResultCount === 3` and 3 result rows.)

- [ ] **Step 2: Add the schema field and push**

In `prisma/schema.prisma`, Run model, after the `viewportIds` line:

```prisma
  expectedResultCount    Int? // eligible baseline×viewport pairs, set by the runner at enumeration time
```

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema", client regenerated.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/runner.test.ts -t expectedResultCount`
Expected: FAIL — `expectedResultCount` is `null` (field exists but runner never writes it).

- [ ] **Step 4: Implement the runner write**

In `src/lib/runner.ts`, after `baselines` is loaded (currently line ~35-38) and before the `for` loop, insert:

```ts
    // Count eligible pairs up front so the UI can show fractional progress.
    // Mirrors the loop's own eligibility rule: a pair exists iff the baseline
    // has a target for the viewport.
    const expectedResultCount = baselines.reduce(
      (n, baseline) =>
        n + viewports.filter((v) => baseline.targets.some((t) => t.viewportId === v.id)).length,
      0
    );
    await prisma.run.update({ where: { id: runId }, data: { expectedResultCount } });
```

Note: this sits INSIDE the existing try block — if it throws, the existing catch marks the run failed, which is correct (a run that can't enumerate can't execute).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/runner.test.ts`
Expected: all pass (existing runner tests must stay green — they don't assert on the new column but do re-read runs; the extra update must not disturb status ordering: it runs after the `running` update, before any result row).

- [ ] **Step 6: Write the failing UI test** — in `tests/ui/run-progress.test.tsx`, the fractional-while-active path (previously unreachable, now the primary path):

```tsx
it('shows completed/expected fraction and a fractional bar while running when expected is known', () => {
  const run = { status: 'running' } as RunDetail;
  render(<RunProgress run={run} expectedCount={50} completedCount={3} />);
  expect(screen.getByText('3/50')).toBeDefined();
});
```

(Match the file's existing fixture shape for `run` — reuse its builder if one exists. If `run-progress.tsx` renders the fraction with surrounding markup, assert via the same query style the file already uses for the terminal-state fraction test.)

- [ ] **Step 7: Run it** — `npx vitest run tests/ui/run-progress.test.tsx`
Expected: this may already PASS (the fractional branch exists in `run-progress.tsx` but was unreachable from the page). If it passes, keep it — it pins the newly-reachable path. If it fails because the active+known-expected branch renders the indeterminate bar, adjust `run-progress.tsx` so `expectedCount !== null` always renders the fraction + fractional bar (active or terminal), and the indeterminate pulse is only for `expectedCount === null` while active.

Division-by-zero guard: `expectedResultCount` can legitimately be `0` (project with no eligible baseline×viewport pairs). Wherever the bar width is computed as `completed / expected * 100`, guard it: `expected > 0 ? (completed / expected) * 100 : 0` — `0/0` must not produce `NaN%`. Add one test: `expectedCount={0}, completedCount={0}` renders `0/0` with a 0-width (not NaN) bar.

- [ ] **Step 8: Wire the page**

In `src/app/(dashboard)/runs/[id]/page.tsx`:

1. Client type (`src/lib/client.ts:49`): add `expectedResultCount: number | null;` to the `Run` interface.
2. Derivation (currently line ~71) becomes:

```tsx
  const expectedCount = run
    ? run.expectedResultCount ??
      (run.status === 'done' || run.status === 'failed' ? run.results.length : null)
    : null;
```

(The `?? results.length` fallback keeps pre-migration runs — whose `expectedResultCount` is null — rendering exactly as today.)

3. SSE handler (currently lines ~44-52): also reload on the non-terminal `running` status event so the page picks up `expectedResultCount` before the first result lands. The handler becomes:

```tsx
      es.onmessage = (msg) => {
        const event = JSON.parse(msg.data) as { type: string; status?: string };
        if (event.type === 'result') {
          reload();
        } else if (event.type === 'status') {
          if (event.status === 'done' || event.status === 'failed') {
            es.close();
          }
          reload();
        }
      };
```

- [ ] **Step 9: Full gate** — `npm test && npm run typecheck && npm run build`
Expected: all clean. If any existing UI test asserted the indeterminate bar for an active run WITH a non-null expectedCount, that expectation is now wrong — update it (active + null expected keeps the indeterminate test as-is).

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma src/lib/runner.ts src/lib/client.ts "src/app/(dashboard)/runs/[id]/page.tsx" src/components/run-progress.tsx tests/runner.test.ts tests/ui/run-progress.test.tsx
git commit -m "feat: persist expectedResultCount on runs for fractional live progress"
```

---

### Task 2: `RunResult.baselineImagePath` — real left pane + slider on visual runs

**Files:**
- Modify: `prisma/schema.prisma` (RunResult model, after `referenceImagePath`)
- Modify: `src/lib/runner.ts:175-188` (`processResult` final update)
- Modify: `src/lib/client.ts:48` (RunResult interface)
- Modify: `src/components/comparison-viewer.tsx:89` (leftImagePath)
- Test: `tests/runner.test.ts`, `tests/ui/comparison-viewer.test.tsx`

**Interfaces:**
- Consumes: `processResult`'s `job.activeBaselinePath: string | null` (already the exact path of the approved version image the diff ran against — `runner.ts:60-61`), `imageUrl(relPath)`.
- Produces: `RunResult.baselineImagePath: string | null` on the Prisma model and client interface — set ONLY for visual-run results that were diffed against an approved baseline (null for compare runs, `new` results, and pre-migration rows).

- [ ] **Step 1: Write the failing runner test** — in `tests/runner.test.ts`:

```ts
it('pins the compared baseline image path on visual-run results', async () => {
  // seed: baseline with an approved active version (imagePath known from the seed)
  await executeRun(run.id, browser);
  const result = await prisma.runResult.findFirstOrThrow({ where: { runId: run.id } });
  expect(result.baselineImagePath).toBe(approvedVersion.imagePath);
});

it('leaves baselineImagePath null on compare-run results', async () => {
  await executeRun(compareRun.id, browser);
  const result = await prisma.runResult.findFirstOrThrow({ where: { runId: compareRun.id } });
  expect(result.baselineImagePath).toBeNull();
  expect(result.referenceImagePath).not.toBeNull();
});
```

(Reuse the file's existing visual-run-with-approved-baseline and compare-run test setups — both scenarios already exist in that file; extend or mirror them rather than building new seeds from scratch.)

- [ ] **Step 2: Add the schema field and push**

In `prisma/schema.prisma`, RunResult model, after `referenceImagePath`:

```prisma
  baselineImagePath  String? // visual runs: path of the approved baseline version image the diff ran against, pinned at compare time
```

Run: `npm run db:push`

- [ ] **Step 3: Run to verify failure** — `npx vitest run tests/runner.test.ts -t baselineImagePath`
Expected: first test FAILs (`baselineImagePath` null); second may already pass — keep it as a regression pin.

- [ ] **Step 4: Implement the runner write**

In `src/lib/runner.ts`, `processResult`'s final `prisma.runResult.update` (the diff branch, currently lines ~177-188), add one line to `data`:

```ts
      baselineImagePath: job.runType === 'compare' ? null : job.activeBaselinePath,
```

The `new`-result update (lines ~168-171) is untouched — no baseline existed, the field stays null.

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/runner.test.ts`
Expected: all pass.

- [ ] **Step 6: Write the failing UI test** — in `tests/ui/comparison-viewer.test.tsx`, using that file's existing result-fixture builder:

```tsx
it('renders the pinned baseline image and enables slider for visual-run results', () => {
  const result = makeResult({
    visualStatus: 'diff',
    captureImagePath: 'captures/r1.png',
    diffImagePath: 'diffs/r1.png',
    baselineImagePath: 'baselines/t1-123.png',
  });
  render(<ComparisonViewer result={result} runType="visual" onPromoted={() => {}} />);
  expect(screen.getByAltText('baseline')).toBeDefined(); // or the file's established query for the left ImagePane image
  const sliderTab = screen.getByRole('button', { name: 'slider' });
  expect((sliderTab as HTMLButtonElement).disabled).toBe(false);
});
```

(Adapt queries to the file's established patterns — it already asserts on disabled slider tabs and pane placeholders; invert those queries. The fixture builder needs `baselineImagePath` added to its defaults as `null`.)

- [ ] **Step 7: Run to verify failure** — `npx vitest run tests/ui/comparison-viewer.test.tsx -t "pinned baseline"`
Expected: FAIL — left pane renders `baseline image not available`, slider tab disabled.

- [ ] **Step 8: Implement the UI consumption**

1. Client type (`src/lib/client.ts:48`): add `baselineImagePath: string | null;` to the `RunResult` interface.
2. `src/components/comparison-viewer.tsx:89` becomes:

```tsx
  const leftImagePath = isCompare ? result.referenceImagePath : result.baselineImagePath;
```

Everything downstream (hasLeft, sliderAvailable, ImagePane, slider layering, missingReason) already keys off `leftImagePath` — no other viewer change. The existing wording logic stays: visual results with a null path still show `no baseline` (new/null status) or `baseline image not available` (pre-migration diff/pass/fail rows).

- [ ] **Step 9: Run UI tests** — `npx vitest run tests/ui/comparison-viewer.test.tsx`
Expected: all pass, including the pre-existing "baseline image not available" wording tests (they build results with `baselineImagePath` defaulted to null, so their behavior is unchanged).

- [ ] **Step 10: Full gate** — `npm test && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma src/lib/runner.ts src/lib/client.ts src/components/comparison-viewer.tsx tests/runner.test.ts tests/ui/comparison-viewer.test.tsx
git commit -m "feat: pin compared baseline image on run results; enable slider for visual runs"
```
