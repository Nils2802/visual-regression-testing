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
