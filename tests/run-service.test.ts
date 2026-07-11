import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium } from 'playwright';
import { prisma } from '@/lib/db';
import { startRun } from '@/lib/run-service';
import { getBrowser, closeBrowser } from '@/lib/browser';
import { enqueue } from '@/lib/queue';
import { startFixtureServer, FixtureServer } from './fixtures/server';
import { POST as triggerRoute, GET as listRoute } from '@/app/api/projects/[id]/runs/route';
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

  it('list route returns runs newest-first with result counts', async () => {
    const res = await listRoute(new Request('http://t'), ctx(projectId));
    expect(res.status).toBe(200);
    const { runs } = await res.json();
    expect(runs.length).toBeGreaterThanOrEqual(2); // startRun test + trigger route test

    const times = runs.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times); // newest-first

    const done = runs.find((r: { status: string }) => r.status === 'done');
    expect(done).toBeDefined();
    expect(done.environment).toEqual({ id: environmentId, name: 'test' });
    expect(done.resultCount).toBe(1);
    expect(done.failedResultCount).toBe(0); // visualStatus 'new' is not a failure

    expect((await listRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
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

describe('pre-execution failure handling', () => {
  it('recovers the browser singleton after a failed launch', async () => {
    await closeBrowser();
    const launchSpy = vi
      .spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error('launch boom'));
    try {
      await expect(getBrowser()).rejects.toThrow('launch boom');
      // The failed launch must not be cached: the next call relaunches for real.
      const browser = await getBrowser();
      expect(browser.isConnected()).toBe(true);
    } finally {
      launchSpy.mockRestore();
    }
  });

  it('marks the run failed and logs when the browser cannot launch', async () => {
    await closeBrowser();
    const launchSpy = vi
      .spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error('no browser for you'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const run = await startRun({ projectId, environmentId });
      expect(run.status).toBe('queued');

      expect(await waitForTerminal(run.id)).toBe('failed');
      const failed = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
      expect(failed.error).toBe('no browser for you');
      expect(failed.finishedAt).not.toBeNull();
      expect(
        errorSpy.mock.calls.some((args) => String(args[0]).includes(run.id))
      ).toBe(true);
    } finally {
      launchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('logs (without crashing) when the run row vanishes before the job starts', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      void enqueue(() => gate); // hold the FIFO queue

      const run = await startRun({ projectId, environmentId });
      await prisma.run.delete({ where: { id: run.id } });
      release();
      await enqueue(async () => {}); // drain: resolves after the doomed job settled

      // The catch handler runs asynchronously after the job rejects; poll briefly.
      for (let i = 0; i < 40; i++) {
        if (errorSpy.mock.calls.some((args) => String(args[0]).includes(run.id))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(
        errorSpy.mock.calls.some((args) => String(args[0]).includes(run.id))
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
