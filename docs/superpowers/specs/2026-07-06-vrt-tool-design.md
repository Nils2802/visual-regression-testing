# Visual Regression Testing Tool — Design

**Date:** 2026-07-06
**Status:** Approved (sections 1–6 reviewed in brainstorming session)

## Overview

A self-hosted visual regression testing (VRT) tool. It captures screenshots of web pages — or individual elements — with Playwright at every viewport configured for the project, compares them against approved baselines (from Figma frames, uploaded PNGs, or previously approved captures) or against a live reference environment, and reports pixel diffs plus console/network errors through a web dashboard. A later stage adds a functional crawl mode that auto-clicks interactive elements and attributes errors to the exact interaction that caused them.

Single Docker container: Next.js app (UI + API), Playwright + Chromium, SQLite via Prisma, images on a volume. No Redis, no external workers.

---

## 1. Data Model

SQLite + Prisma for metadata. Image files (baselines, captures, diffs) live on the filesystem in a Docker volume; the database stores paths and hashes only.

### Entities

- **Project** — name, Figma access token (encrypted at rest), default diff threshold, crawl config (start URLs, maxDepth, maxPages, click denylist patterns), settings.
- **Environment** — belongs to a project; name (e.g. `staging`, `production`) and base URL. Runs execute against one environment.
- **Viewport** — belongs to a project; name and width × height (e.g. `mobile 375×812`, `tablet 768×1024`, `desktop 1440×900`). Presets offered at creation, freely editable. Viewports are a core capture dimension: every run type captures at every selected viewport.
- **Baseline** — belongs to a project; name, page path (joined with the environment base URL at run time), optional `elementSelector` (element-scoped baseline: only that element is screenshotted via Playwright locator), per-baseline diff threshold override, optional element mask selectors, source type (`figma` | `upload` | `capture`), sync status (`ok` | `sync-error`). Applies to all project viewports by default; an optional per-baseline subset restricts it (e.g. a mobile-only component).
- **BaselineTarget** — one per baseline × viewport; owns the per-viewport version history and active approved image, plus the per-viewport Figma `fileKey` + `nodeId` (a mobile frame can back the mobile viewport while a desktop frame backs desktop). Uploads are also attached per target.
- **BaselineVersion** — image versions of a baseline target with an approval workflow: `pending` → `approved` | `rejected`. Exactly one approved version is active per target. New Figma syncs and promoted captures always enter as `pending`.
- **Run** — belongs to a project + environment; `type` (`visual` | `compare` | `crawl` — crawl implemented in a later stage, field exists from day one), optional `referenceEnvironmentId` (compare runs, see section 2a), selected viewports (default: all), trigger (`manual` | `schedule` | `api`), status (`queued` | `running` | `done` | `failed`), timestamps.
- **RunResult** — one per baseline × viewport per run; viewport FK, capture image path, reference image path (compare runs), diff image path, `visualStatus` (`pass` | `diff` | `fail`), `functionalStatus` (`pass` | `fail`), diff pixel ratio, size-mismatch warning flag.
- **LogEntry** — console/network events collected during capture or crawl; `type` (`console-error` | `console-warning` | `page-error` | `http-error` | `network-error`), message, URL, HTTP status, stack trace, timestamp, `ignored` flag, FK to the matching IgnoreRule when ignored, FK to RunResult (visual runs) or CrawlAction (crawl runs).
- **IgnoreRule** — per project; optional entry-type filter, regex on URL, regex on message, human-readable reason. Matching log entries are stored but flagged `ignored` and do not fail the run.
- **CrawlAction** — later stage; run FK, page URL, element selector, element text, action performed, resulting URL, timestamp. Log entries reference the action that triggered them.
- **ApiToken** — per project; name, token hash (never stored or returned in plaintext after creation), created/last-used timestamps.

### Approval flow

1. A capture, upload, or Figma sync produces a `BaselineVersion` in `pending` on a specific baseline target (baseline × viewport).
2. User approves or rejects in the dashboard (per item or via the cross-project approval queue).
3. Approving deactivates the previous approved version and activates the new one. History is kept.

Uploads accept any PNG — a manual Figma export, a screenshot-tool capture of a page or element, or any other reference image.

---

## 2. Capture & Diff Engine

### Capture (Playwright)

- Chromium via Playwright, one browser instance reused, one fresh context per capture.
- Each run captures every baseline at every selected viewport (default: all project viewports); one result per baseline × viewport. This applies to all run types — visual, compare, and (later) crawl.
- Viewport set from the project's `Viewport` entity per capture.
- Stabilization before screenshot:
  - `prefers-reduced-motion: reduce` emulated.
  - CSS injection disables animations, transitions, and caret blinking.
  - Wait for network idle plus a short settle delay.
  - Optional element masking: selectors from the baseline are covered with solid boxes before screenshot (dynamic content like dates, avatars, ads).
- Full-page or viewport screenshot per baseline configuration. When the baseline has an `elementSelector`, only that element is screenshotted (`locator.screenshot()`); masks still apply inside the element. Element-scoped baselines are captured at every viewport like any other — this is how responsive component breakage is caught (nav collapsing to a burger menu, card grids reflowing).

### Diff (pixelmatch)

- Compare capture against the active approved baseline version.
- If dimensions differ: scale capture to baseline width first, flag the result with a size-mismatch **warning** (not an automatic fail), then diff.
- Pixelmatch with per-baseline threshold (project default fallback). Output: diff image with highlighted regions + diff pixel ratio.
- `visualStatus`: `pass` (ratio ≤ threshold), `diff` (ratio > threshold), `fail` (capture error, e.g. page unreachable).

### 2a. Environment-compare runs (dev vs. live)

Use case: the site is live, a major update sits on a dev/staging URL, and the question is "does dev still look like current live?"

- Run type `compare` with a `referenceEnvironmentId` alongside the normal test environment.
- At run time the engine captures every baseline's page path **twice per viewport**: once on the reference environment (live) and once on the test environment (dev). Same viewport, stabilization, and masks for both.
- The reference capture acts as the baseline **for that run only** — ephemeral, stored with the run, no approval flow. Live changes constantly, so a fresh capture beats a stale snapshot.
- Diffing uses the same pixelmatch pipeline; the run-detail UI shows live left, dev right.
- Log collector runs on both captures, but only **test-environment** entries affect `functionalStatus` — production errors are not this run's fault. Reference entries are stored as informational.
- No new entities: reuses Environment, Run, RunResult; one nullable FK on Run.

### Job queue

Sequential in-process queue. Runs are processed one at a time; captures within a run (baseline × viewport, ×2 for compare runs) are taken sequentially. No Redis or external queue — acceptable for a self-hosted single-instance tool, and keeps the deployment to one container. Multi-viewport runs multiply capture counts (10 baselines × 3 viewports = 30 captures), so runs get slower; parallel capture via multiple browser contexts is a possible later optimization and nothing in the queue design blocks it.

---

## 3. Log Collector & Functional Crawl

### 3a. Log collector (built now, active during every capture)

Playwright listeners are attached before navigation and collect until the screenshot completes:

| Signal | Listener | LogEntry type |
|---|---|---|
| `console.error()` | `page.on('console')` | `console-error` |
| `console.warn()` | `page.on('console')` | `console-warning` |
| Uncaught JS exception | `page.on('pageerror')` | `page-error` (with stack) |
| HTTP 4xx/5xx response | `page.on('response')` | `http-error` (URL, status, method) |
| CORS / timeout / abort / DNS failure | `page.on('requestfailed')` | `network-error` (failure reason) |

- Every entry is persisted and visible in the dashboard per result.
- **Result status has two dimensions:** `visualStatus` and `functionalStatus`. Overall result fails if either fails.
- **Strict policy:** any non-ignored log entry of any collected type fails `functionalStatus`.
- **Ignore rules are therefore essential.** Third-party noise (analytics 403s, framework dev warnings, requests aborted during navigation) would otherwise permanently fail every run. Rules are per project, regex-based on URL and/or message, optionally restricted to an entry type, and require a reason. Ignored entries are still stored, shown collapsed/grey in the UI. The dashboard offers one-click "ignore this" on any log entry, pre-filling a rule.

### 3b. Functional crawl mode (schema now, implementation in a later stage)

- `Run.type = 'crawl'`. Same-origin BFS starting from the project's configured start URLs, bounded by `maxDepth` and `maxPages`.
- Per page: collect interactive elements (`a`, `button`, `[role=button]`, submit inputs). Links are deduplicated and queued; buttons are clicked one at a time with the log collector attached, reloading the page between clicks to reset state.
- **Safety denylist:** configurable text/selector patterns that are never clicked. Defaults include `logout`, `delete`, `remove`, `sign out`. Prevents the crawler from destroying staging data.
- Every interaction is recorded as a `CrawlAction`; log entries link to the action, so each error is attributed to the exact click that caused it.
- Crawl report in the dashboard: pages visited, actions performed, errors per action.
- Viewports apply here too: mobile menus and touch layouts expose different interactive elements than desktop. Default is crawling at one chosen viewport; multi-viewport crawl is optional since crawling is expensive and viewports multiply it.
- The collector implementation is shared between visual capture and crawl — one implementation, two consumers.

---

## 4. Figma Integration

- **Auth:** Figma personal access token per project, encrypted at rest.
- **Linking:** user pastes a Figma frame URL (`figma.com/design/:fileKey/...?node-id=:id`) into a baseline target (baseline × viewport). Server parses and stores `fileKey` + `nodeId` per target — a mobile frame backs the mobile viewport, a desktop frame backs desktop.
- **Export:** Figma REST API `GET /v1/images/:fileKey?ids=:nodeId&format=png&scale=N`. Scale chosen so the exported width matches the target's viewport width. If the frame's aspect/width is incompatible (e.g. 375px frame linked to a 1440px viewport), warn instead of silently upscaling.
- **Sync:** manual "re-sync from Figma" per baseline, plus an optional project-level "sync all before run" toggle. The first import creates a version that goes through normal approval; every re-sync creates a new **pending** version so an accidental design change never silently moves the goalposts.
- **Failure handling:** invalid token or deleted frame → baseline flagged `sync-error`, the last good approved image stays active, runs proceed with it.
- **Rate limits:** sync queue is sequential; node IDs belonging to the same file are batched into a single images call where possible.
- No Figma webhooks in v1 (requires public URL + Figma org plan). Manual/pre-run sync is sufficient.

---

## 5. Dashboard / UI

**Stack:** Next.js (App Router), full-stack — UI, API route handlers, and Prisma in one app, one container. The capture engine runs in the same process via the in-process queue. The current empty TypeScript scaffold is replaced by the Next.js structure.

**Pages:**

- **Projects list** — cards with last-run status and error-count badge.
- **Project detail** — baseline grid (thumbnail, name, viewport badges, source icon, sync status), environment selector, "Run now" (with run type, reference environment for compare runs, and viewport multi-select — default all).
- **Run detail** (core screen):
  - Result list grouped by baseline with viewport tabs per result, filterable by status (visual fail / functional fail / pass) and viewport.
  - Per result three comparison modes: side-by-side, overlay slider, diff highlight. Compare runs show live (reference) left, dev (test) right.
  - Log panel beneath the images: entries grouped by type, ignored entries collapsed/grey, one-click "ignore this" rule creation.
  - Approve button promotes the capture to a new pending baseline version on the matching target (not available on compare runs — reference captures are ephemeral).
- **Approval queue** — all pending baseline versions across projects, with viewport badge.
- **Crawl report** (later stage) — page tree, actions table, errors per action.
- **Project settings** — environments, viewports, Figma token, ignore-rules table, crawl config, click denylist, API tokens.

**Live progress:** server-sent events (SSE) from a route handler; run progress bar and results stream in as they are captured.

**API:** REST-style route handlers (`/api/projects/:id/runs`, `/api/runs/:id`, …).

---

## 6. Run Modes, Scheduling, Auth

### Trigger modes

1. **Manual** — dashboard "Run now" with project + environment picker.
2. **Scheduled** — per-project cron expression + target environment, executed by an in-app scheduler (`croner`) in the same process. Runs missed while the container is down are skipped, not backfilled.
3. **CI / webhook** — `POST /api/projects/:id/runs` with a project API token returns a `runId`; body selects run type, environment, reference environment (compare runs), and viewports. `GET /api/runs/:id` polls status. A small CLI helper (`npx vrt-run --wait`: trigger, poll, non-zero exit on fail) is planned for CI gating in a later stage.

### Auth

- **Dashboard:** single admin password from `ADMIN_PASSWORD` env var; session cookie via `iron-session`. No user table or signup — this is a self-hosted internal tool. The schema does not block adding multi-user later.
- **API:** per-project bearer tokens, generated in project settings, stored hashed, scoped to their project.
- **Secrets:** Figma tokens encrypted at rest (`ENCRYPTION_KEY`), API tokens hashed; neither is ever returned by the API after creation.

### Deployment

One Docker container (Next.js + Playwright + Chromium) and one volume (SQLite + images). `docker-compose.yml` with `ADMIN_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`.

---

## Build order (high level)

1. Data model (viewports, baseline targets) + capture/diff engine + log collector (sections 1–3a).
2. Dashboard + approval flow + uploads (section 5).
3. Environment-compare runs (section 2a).
4. Figma integration (section 4).
5. Scheduling, API tokens, CI trigger (section 6).
6. Functional crawl mode + crawl report + CLI helper (section 3b, later stage).