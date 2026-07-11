import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as listProjects, POST as createProject } from '@/app/api/projects/route';
import {
  GET as getProject,
  PATCH as patchProject,
  DELETE as deleteProject,
} from '@/app/api/projects/[id]/route';
import { POST as createEnvironment } from '@/app/api/projects/[id]/environments/route';
import { PATCH as patchEnvironment, DELETE as deleteEnvironment } from '@/app/api/environments/[id]/route';
import { POST as createViewport } from '@/app/api/projects/[id]/viewports/route';
import { PATCH as patchViewport, DELETE as deleteViewport } from '@/app/api/viewports/[id]/route';

function jsonReq(method: string, body: unknown) {
  return new Request('http://test.local', { method, body: JSON.stringify(body) });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('projects API', () => {
  it('creates, lists, patches, deletes a project', async () => {
    const created = await createProject(jsonReq('POST', { name: 'api-proj' }));
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project.name).toBe('api-proj');
    expect(project.diffThreshold).toBe(0.01);

    const list = await (await listProjects()).json();
    const mine = list.projects.find((p: { id: string }) => p.id === project.id);
    expect(mine).toBeDefined();
    expect(mine.lastRun).toBeNull();
    expect(mine.failedResultCount).toBe(0);

    const patched = await patchProject(jsonReq('PATCH', { diffThreshold: 0.05 }), ctx(project.id));
    expect((await patched.json()).diffThreshold).toBe(0.05);

    expect((await deleteProject(new Request('http://test.local'), ctx(project.id))).status).toBe(204);
    expect((await getProject(new Request('http://test.local'), ctx(project.id))).status).toBe(404);
  });

  it('rejects invalid create bodies with 400', async () => {
    expect((await createProject(jsonReq('POST', { name: '' }))).status).toBe(400);
  });

  it('manages environments under a project', async () => {
    const p = await (await createProject(jsonReq('POST', { name: 'env-proj' }))).json();
    const created = await createEnvironment(
      jsonReq('POST', { name: 'staging', baseUrl: 'http://127.0.0.1:9999' }),
      ctx(p.id)
    );
    expect(created.status).toBe(201);
    const env = await created.json();

    const patched = await patchEnvironment(jsonReq('PATCH', { name: 'stage2' }), ctx(env.id));
    expect((await patched.json()).name).toBe('stage2');

    expect((await createEnvironment(jsonReq('POST', { name: 'x', baseUrl: 'not a url' }), ctx(p.id))).status).toBe(400);
    expect((await deleteEnvironment(new Request('http://test.local'), ctx(env.id))).status).toBe(204);
  });

  it('creating a viewport backfills targets for existing baselines', async () => {
    const p = await (await createProject(jsonReq('POST', { name: 'vp-proj' }))).json();
    const baseline = await prisma.baseline.create({
      data: { projectId: p.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });
    const created = await createViewport(
      jsonReq('POST', { name: 'mobile', width: 375, height: 812 }),
      ctx(p.id)
    );
    expect(created.status).toBe(201);
    const vp = await created.json();
    const target = await prisma.baselineTarget.findUnique({
      where: { baselineId_viewportId: { baselineId: baseline.id, viewportId: vp.id } },
    });
    expect(target).not.toBeNull();

    expect((await deleteViewport(new Request('http://test.local'), ctx(vp.id))).status).toBe(204);
  });

  it('404s on unknown ids', async () => {
    expect((await getProject(new Request('http://test.local'), ctx('nope'))).status).toBe(404);
    expect((await patchEnvironment(jsonReq('PATCH', { name: 'x' }), ctx('nope'))).status).toBe(404);
  });

  it('counts failed results from the newest run only', async () => {
    const p = await (await createProject(jsonReq('POST', { name: 'count-proj' }))).json();
    const env = await prisma.environment.create({
      data: { projectId: p.id, name: 'test', baseUrl: 'http://127.0.0.1:9999' },
    });
    const vp = await prisma.viewport.create({
      data: { projectId: p.id, name: 'desktop', width: 1280, height: 800 },
    });
    const baseline = await prisma.baseline.create({
      data: { projectId: p.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });

    // Older run with a failing result — must NOT be counted.
    await prisma.run.create({
      data: {
        projectId: p.id,
        environmentId: env.id,
        trigger: 'manual',
        status: 'done',
        createdAt: new Date(Date.now() - 60000),
        results: {
          create: [
            { baselineId: baseline.id, viewportId: vp.id, visualStatus: 'fail' },
          ],
        },
      },
    });

    // Newest run: diff + fail + functional-fail + fully passing = 3 failed.
    const newestRun = await prisma.run.create({
      data: {
        projectId: p.id,
        environmentId: env.id,
        trigger: 'manual',
        status: 'done',
        results: {
          create: [
            { baselineId: baseline.id, viewportId: vp.id, visualStatus: 'diff', functionalStatus: 'pass' },
            { baselineId: baseline.id, viewportId: vp.id, visualStatus: 'fail', functionalStatus: 'pass' },
            { baselineId: baseline.id, viewportId: vp.id, visualStatus: 'pass', functionalStatus: 'fail' },
            { baselineId: baseline.id, viewportId: vp.id, visualStatus: 'pass', functionalStatus: 'pass' },
          ],
        },
      },
    });

    const list = await (await listProjects()).json();
    const mine = list.projects.find((proj: { id: string }) => proj.id === p.id);
    expect(mine).toBeDefined();
    expect(mine.lastRun).not.toBeNull();
    expect(mine.lastRun.id).toBe(newestRun.id);
    expect(mine.failedResultCount).toBe(3);
  });

  it('404s on remaining unknown-id branches', async () => {
    const req = () => new Request('http://test.local');
    expect((await deleteProject(req(), ctx('nope'))).status).toBe(404);
    expect((await patchProject(jsonReq('PATCH', { name: 'x' }), ctx('nope'))).status).toBe(404);
    expect(
      (await createEnvironment(jsonReq('POST', { name: 'x', baseUrl: 'http://127.0.0.1:1' }), ctx('nope'))).status
    ).toBe(404);
    expect(
      (await createViewport(jsonReq('POST', { name: 'x', width: 100, height: 100 }), ctx('nope'))).status
    ).toBe(404);
    expect((await patchViewport(jsonReq('PATCH', { name: 'x' }), ctx('nope'))).status).toBe(404);
    expect((await deleteViewport(req(), ctx('nope'))).status).toBe(404);
    expect((await deleteEnvironment(req(), ctx('nope'))).status).toBe(404);
  });
});
