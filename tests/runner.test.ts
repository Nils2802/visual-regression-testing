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
// Same geometry as PAGE (300x200 div) so the diff is driven purely by color,
// not by a size-mismatch padding artifact.
const CHANGED_PAGE = '<html><body><div style="width:300px;height:200px;background:red"></div></body></html>';

beforeAll(async () => {
  browser = await chromium.launch();
  server = await startFixtureServer({
    '/': PAGE,
    '/noisy': NOISY_PAGE,
    '/regress-base': PAGE,
    '/regress-changed': CHANGED_PAGE,
  });
  process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'vrt-runner-'));
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

async function seed(pagePath = '/', baselineOverrides: Record<string, unknown> = {}) {
  const project = await prisma.project.create({ data: { name: `p-${Date.now()}-${Math.random()}` } });
  const env = await prisma.environment.create({
    data: { projectId: project.id, name: 'test', baseUrl: server.url },
  });
  const viewport = await prisma.viewport.create({
    data: { projectId: project.id, name: 'desktop', width: 800, height: 600 },
  });
  const baseline = await prisma.baseline.create({
    data: { projectId: project.id, name: 'home', pagePath, sourceType: 'capture', ...baselineOverrides },
  });
  await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: viewport.id } });
  return { project, env, viewport, baseline };
}

// Scoped to one baseline's targets — approvals must never use an unscoped
// `baselineVersion.updateMany`, which would flip unrelated baselines' pending
// versions to approved in the shared test.db as other tests append baselines.
async function approveVersionsFor(baselineId: string) {
  await prisma.baselineVersion.updateMany({
    where: { target: { baselineId } },
    data: { status: 'approved', isActive: true },
  });
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
    const { project, env, baseline } = await seed();
    const run1 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run1.id, browser);
    await approveVersionsFor(baseline.id);

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

describe('executeRun — visual regression detected (end-to-end)', () => {
  it('changed page vs approved active baseline → diff detected, diff image written to disk', async () => {
    const { project, env, baseline } = await seed('/regress-base');

    // Establish and approve a baseline from the unchanged page.
    const run1 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run1.id, browser);
    await approveVersionsFor(baseline.id);

    // Simulate the page changing: same target, now serving a visually
    // different page (large color change over the same 300x200 region).
    await prisma.baseline.update({ where: { id: baseline.id }, data: { pagePath: '/regress-changed' } });

    const run2 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run2.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({ where: { runId: run2.id } });
    expect(result.visualStatus).toBe('diff');
    expect(result.diffRatio).toBeGreaterThan(project.diffThreshold);
    expect(result.diffImagePath).toBeTruthy();

    const full = path.join(process.env.DATA_DIR!, result.diffImagePath!);
    await expect(fs.stat(full)).resolves.toBeTruthy();
  });

  it('baseline-level diffThreshold override flips the verdict vs the project default', async () => {
    // Same color-change scenario as above, but this baseline sets a
    // per-baseline threshold above the measured diff ratio, so the same
    // underlying change should now verdict as 'pass' instead of 'diff'.
    const { project, env, baseline } = await seed('/regress-base', { diffThreshold: 0.99 });

    const run1 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run1.id, browser);
    await approveVersionsFor(baseline.id);

    await prisma.baseline.update({ where: { id: baseline.id }, data: { pagePath: '/regress-changed' } });

    const run2 = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'visual', trigger: 'manual' },
    });
    await executeRun(run2.id, browser);

    const result = await prisma.runResult.findFirstOrThrow({ where: { runId: run2.id } });
    // The raw diff still exceeds the project default (proves it's the same
    // underlying change as the previous test, not a fluke of a tiny diff).
    expect(result.diffRatio).toBeGreaterThan(project.diffThreshold);
    expect(result.diffRatio).toBeLessThanOrEqual(0.99);
    expect(result.visualStatus).toBe('pass');
  });
});

describe('executeRun — viewportIds subset', () => {
  it('non-empty viewportIds restricts results to the named viewport only', async () => {
    const project = await prisma.project.create({ data: { name: `p-${Date.now()}-${Math.random()}` } });
    const env = await prisma.environment.create({
      data: { projectId: project.id, name: 'test', baseUrl: server.url },
    });
    const vpA = await prisma.viewport.create({
      data: { projectId: project.id, name: 'desktop', width: 800, height: 600 },
    });
    const vpB = await prisma.viewport.create({
      data: { projectId: project.id, name: 'mobile', width: 375, height: 812 },
    });
    const baseline = await prisma.baseline.create({
      data: { projectId: project.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });
    await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: vpA.id } });
    await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: vpB.id } });

    const run = await prisma.run.create({
      data: {
        projectId: project.id,
        environmentId: env.id,
        type: 'visual',
        trigger: 'manual',
        viewportIds: JSON.stringify([vpA.id]),
      },
    });
    await executeRun(run.id, browser);

    const results = await prisma.runResult.findMany({ where: { runId: run.id } });
    expect(results).toHaveLength(1);
    expect(results[0].viewportId).toBe(vpA.id);
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

  it('reference environment deleted before execution → run failed, not stuck at queued', async () => {
    // The FK on referenceEnvironmentId (onDelete: SetNull) makes a dangling id
    // impossible to create; the missing-reference case now arises when the
    // environment is deleted between run creation and execution.
    const { project, env } = await seed();
    const refEnv = await prisma.environment.create({
      data: { projectId: project.id, name: 'doomed', baseUrl: server.url },
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
    await prisma.environment.delete({ where: { id: refEnv.id } });
    await executeRun(run.id, browser);

    const done = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe('failed');
    expect(done.error).toBeTruthy();
    expect(done.startedAt).toBeTruthy();
    expect(done.finishedAt).toBeTruthy();
  });

  it('compare run without referenceEnvironmentId → run failed, no baseline versions created', async () => {
    const { project, env } = await seed();
    const run = await prisma.run.create({
      data: { projectId: project.id, environmentId: env.id, type: 'compare', trigger: 'manual' },
    });
    await executeRun(run.id, browser);

    const done = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe('failed');
    expect(done.error).toBeTruthy();
    const versions = await prisma.baselineVersion.findMany({
      where: { target: { baseline: { projectId: project.id } } },
    });
    expect(versions).toHaveLength(0);
  });

  it('console errors on the REFERENCE page never affect functionalStatus; entries persist with origin=reference', async () => {
    // Test env serves the quiet page; a separate server stands in for the
    // reference env and serves the noisy page at the same path, so any
    // functional failure recorded can only have come from the reference
    // capture if the isolation is broken.
    const { project, env } = await seed('/');
    const noisyServer = await startFixtureServer({ '/': NOISY_PAGE });
    try {
      const refEnv = await prisma.environment.create({
        data: { projectId: project.id, name: 'live-noisy', baseUrl: noisyServer.url },
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

      const result = await prisma.runResult.findFirstOrThrow({
        where: { runId: run.id },
        include: { logEntries: true },
      });
      expect(result.functionalStatus).toBe('pass');

      const refEntries = result.logEntries.filter((e) => e.origin === 'reference');
      expect(refEntries.length).toBeGreaterThan(0);
      const refConsoleError = refEntries.find((e) => e.type === 'console-error');
      expect(refConsoleError).toBeDefined();
      expect(refConsoleError?.origin).toBe('reference');
      expect(refConsoleError?.ignored).toBe(false);

      const testEntries = result.logEntries.filter((e) => e.origin === 'test');
      expect(testEntries).toHaveLength(0);
    } finally {
      await noisyServer.close();
    }
  });

  it('an ignore rule matching a REFERENCE-only console error flags that entry, but still never affects functionalStatus', async () => {
    const { project, env } = await seed('/');
    const noisyServer = await startFixtureServer({ '/': NOISY_PAGE });
    try {
      const refEnv = await prisma.environment.create({
        data: { projectId: project.id, name: 'live-noisy-rule', baseUrl: noisyServer.url },
      });
      const rule = await prisma.ignoreRule.create({
        data: { projectId: project.id, messagePattern: 'kaboom', reason: 'known ref noise' },
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

      const result = await prisma.runResult.findFirstOrThrow({
        where: { runId: run.id },
        include: { logEntries: true },
      });
      // Reference-only noise, even when a rule matches it, must never flip
      // functionalStatus — that's computed strictly from test-page entries.
      expect(result.functionalStatus).toBe('pass');

      const refConsoleError = result.logEntries.find(
        (e) => e.origin === 'reference' && e.type === 'console-error'
      );
      expect(refConsoleError).toBeDefined();
      expect(refConsoleError?.ignored).toBe(true);
      expect(refConsoleError?.ignoreRuleId).toBe(rule.id);
    } finally {
      await noisyServer.close();
    }
  });
});
