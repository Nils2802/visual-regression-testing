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
