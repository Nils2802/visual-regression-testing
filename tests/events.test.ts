import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { emitRunEvent, onRunEvent, type RunEvent } from '@/lib/events';
import { startRun } from '@/lib/run-service';
import { closeBrowser } from '@/lib/browser';
import { startFixtureServer, FixtureServer } from './fixtures/server';
import { GET as sseRoute } from '@/app/api/runs/[id]/events/route';

let server: FixtureServer;
let projectId: string;
let environmentId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

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
});
