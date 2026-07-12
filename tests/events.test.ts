import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { emitRunEvent, onRunEvent, runEventListenerCount, type RunEvent } from '@/lib/events';
import { startRun } from '@/lib/run-service';
import { closeBrowser } from '@/lib/browser';
import { startFixtureServer, FixtureServer } from './fixtures/server';
import { GET as sseRoute } from '@/app/api/runs/[id]/events/route';

let server: FixtureServer;
let projectId: string;
let environmentId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function waitForTerminal(runId: string) {
  for (let i = 0; i < 120; i++) {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === 'done' || run.status === 'failed') return run;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`run ${runId} did not reach a terminal status in time`);
}

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

  it('a throwing subscriber does not block other subscribers or the emitter', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: RunEvent[] = [];
    const offBad = onRunEvent('boom-run', () => {
      throw new Error('subscriber boom');
    });
    const offGood = onRunEvent('boom-run', (e) => seen.push(e));
    expect(() => emitRunEvent('boom-run', { type: 'status', status: 'running' })).not.toThrow();
    expect(seen).toEqual([{ type: 'status', status: 'running' }]);
    expect(errorSpy).toHaveBeenCalled();
    offBad();
    offGood();
    errorSpy.mockRestore();
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

  it('a throwing subscriber never affects the run outcome', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = await startRun({ projectId, environmentId });
    const offBad = onRunEvent(run.id, () => {
      throw new Error('subscriber boom');
    });
    const events: RunEvent[] = [];
    const off = onRunEvent(run.id, (e) => events.push(e));
    for (let i = 0; i < 120 && !events.some((e) => e.type === 'status' && e.status !== 'running'); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    offBad();
    off();
    errorSpy.mockRestore();
    const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(finished.status).toBe('done');
    expect(finished.error).toBeNull();
    const results = await prisma.runResult.findMany({ where: { runId: run.id } });
    expect(results).toHaveLength(1);
    // exactly one terminal status event, despite the throwing subscriber
    expect(events.filter((e) => e.type === 'status' && e.status !== 'running')).toEqual([
      { type: 'status', status: 'done' },
    ]);
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

  it('client abort unsubscribes the bus listener', async () => {
    const run = await startRun({ projectId, environmentId });
    const ac = new AbortController();
    const res = await sseRoute(new Request('http://t', { signal: ac.signal }), ctx(run.id));
    // run is queued/running at connect time, so the stream stays subscribed
    expect(runEventListenerCount(run.id)).toBe(1);
    ac.abort();
    expect(runEventListenerCount(run.id)).toBe(0);
    await res.body?.cancel();
    // let the background run finish so afterAll's closeBrowser doesn't interrupt it
    await waitForTerminal(run.id);
  });
});
