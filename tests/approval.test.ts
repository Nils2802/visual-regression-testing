import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { saveImage, loadImage } from '@/lib/storage';
import { approveVersion, rejectVersion, promoteResult } from '@/lib/approval';
import { POST as approveRoute } from '@/app/api/versions/[id]/approve/route';
import { POST as rejectRoute } from '@/app/api/versions/[id]/reject/route';
import { POST as promoteRoute } from '@/app/api/results/[id]/promote/route';
import { GET as pendingRoute } from '@/app/api/pending-versions/route';

let targetId: string;
let projectId: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makePendingVersionFor(tid: string): Promise<string> {
  const png = PNG.sync.write(new PNG({ width: 3, height: 3 }));
  const imagePath = await saveImage('baselines', `appr-${Date.now()}-${Math.random()}`, png);
  const v = await prisma.baselineVersion.create({
    data: { targetId: tid, imagePath, status: 'pending' },
  });
  return v.id;
}

const makePendingVersion = () => makePendingVersionFor(targetId);

async function makeFreshTarget(name: string): Promise<string> {
  const viewport = await prisma.viewport.findFirstOrThrow({ where: { projectId } });
  const baseline = await prisma.baseline.create({
    data: {
      projectId,
      name,
      pagePath: `/${name}`,
      sourceType: 'capture',
      targets: { create: [{ viewportId: viewport.id }] },
    },
    include: { targets: true },
  });
  return baseline.targets[0].id;
}

async function makeVisualResult(): Promise<{ resultId: string; capturePath: string }> {
  const target = await prisma.baselineTarget.findUniqueOrThrow({ where: { id: targetId } });
  const env = await prisma.environment.create({
    data: { projectId, name: `env-${Math.random()}`, baseUrl: 'http://127.0.0.1:1' },
  });
  const run = await prisma.run.create({
    data: { projectId, environmentId: env.id, trigger: 'manual', type: 'visual' },
  });
  const capturePng = PNG.sync.write(new PNG({ width: 4, height: 4 }));
  const capturePath = await saveImage('captures', `route-${Date.now()}-${Math.random()}`, capturePng);
  const result = await prisma.runResult.create({
    data: {
      runId: run.id,
      baselineId: target.baselineId,
      viewportId: target.viewportId,
      captureImagePath: capturePath,
      visualStatus: 'diff',
    },
  });
  return { resultId: result.id, capturePath };
}

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'approval-proj',
      viewports: { create: [{ name: 'desktop', width: 1440, height: 900 }] },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  const baseline = await prisma.baseline.create({
    data: {
      projectId: project.id,
      name: 'home',
      pagePath: '/',
      sourceType: 'capture',
      targets: { create: [{ viewportId: project.viewports[0].id }] },
    },
    include: { targets: true },
  });
  targetId = baseline.targets[0].id;
});

describe('approveVersion', () => {
  it('activates the version and deactivates the previous active one', async () => {
    const first = await makePendingVersion();
    const approved1 = await approveVersion(first);
    expect(approved1.status).toBe('approved');
    expect(approved1.isActive).toBe(true);

    const second = await makePendingVersion();
    await approveVersion(second);

    const all = await prisma.baselineVersion.findMany({ where: { targetId } });
    const active = all.filter((v) => v.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second);
    expect(all.find((v) => v.id === first)!.status).toBe('approved'); // history kept
  });

  it('rejects non-pending versions', async () => {
    const id = await makePendingVersion();
    await approveVersion(id);
    await expect(approveVersion(id)).rejects.toThrow('only pending versions can be approved');
  });

  it('concurrent approvals on the same target leave exactly one active version', async () => {
    // Pins the invariant under the concurrency our stack actually allows:
    // SQLite serializes write transactions, so whichever call wins last,
    // exactly one isActive=true row must remain for the target.
    const freshTarget = await makeFreshTarget(`race-${Date.now()}-${Math.random()}`);
    const a = await makePendingVersionFor(freshTarget);
    const b = await makePendingVersionFor(freshTarget);

    await Promise.all([approveVersion(a), approveVersion(b)]);

    const active = await prisma.baselineVersion.findMany({
      where: { targetId: freshTarget, isActive: true },
    });
    expect(active).toHaveLength(1);
    expect([a, b]).toContain(active[0].id);
  });
});

describe('rejectVersion', () => {
  it('marks pending as rejected and never activates it', async () => {
    const id = await makePendingVersion();
    const rejected = await rejectVersion(id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.isActive).toBe(false);
  });
});

describe('promoteResult', () => {
  it('copies the capture into a pending version on the matching target', async () => {
    const baseline = await prisma.baselineTarget.findUniqueOrThrow({
      where: { id: targetId },
      include: { baseline: true, viewport: true },
    });
    const env = await prisma.environment.create({
      data: { projectId, name: 'test', baseUrl: 'http://127.0.0.1:1' },
    });
    const run = await prisma.run.create({
      data: { projectId, environmentId: env.id, trigger: 'manual', type: 'visual' },
    });
    const capturePng = PNG.sync.write(new PNG({ width: 5, height: 5 }));
    const capturePath = await saveImage('captures', `promote-${Date.now()}`, capturePng);
    const result = await prisma.runResult.create({
      data: {
        runId: run.id,
        baselineId: baseline.baselineId,
        viewportId: baseline.viewportId,
        captureImagePath: capturePath,
        visualStatus: 'diff',
      },
    });

    const version = await promoteResult(result.id);
    expect(version.status).toBe('pending');
    expect(version.targetId).toBe(targetId);
    expect(version.imagePath).toMatch(/^baselines\//);
    expect(version.imagePath).not.toBe(capturePath); // copied, not aliased
    expect((await loadImage(version.imagePath)).length).toBeGreaterThan(0);
  });

  it('refuses compare-run results', async () => {
    const env = await prisma.environment.create({
      data: { projectId, name: 'ref', baseUrl: 'http://127.0.0.1:1' },
    });
    const run = await prisma.run.create({
      data: {
        projectId,
        environmentId: env.id,
        referenceEnvironmentId: env.id,
        trigger: 'manual',
        type: 'compare',
      },
    });
    const target = await prisma.baselineTarget.findUniqueOrThrow({ where: { id: targetId } });
    const result = await prisma.runResult.create({
      data: {
        runId: run.id,
        baselineId: target.baselineId,
        viewportId: target.viewportId,
        captureImagePath: 'captures/whatever.png',
      },
    });
    await expect(promoteResult(result.id)).rejects.toThrow('compare-run captures cannot be promoted');
  });
});

describe('routes', () => {
  it('approve route returns 409 for non-pending, 404 for unknown', async () => {
    const id = await makePendingVersion();
    await rejectVersion(id);
    expect((await approveRoute(new Request('http://t'), ctx(id))).status).toBe(409);
    expect((await approveRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });

  it('reject route: 200 happy path, 409 already-rejected, 404 unknown', async () => {
    const id = await makePendingVersion();
    const ok = await rejectRoute(new Request('http://t'), ctx(id));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe('rejected');
    expect(body.isActive).toBe(false);

    expect((await rejectRoute(new Request('http://t'), ctx(id))).status).toBe(409);
    expect((await rejectRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });

  it('promote route: 201 happy path with pending version on baselines/ path', async () => {
    const { resultId, capturePath } = await makeVisualResult();
    const res = await promoteRoute(new Request('http://t'), ctx(resultId));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.targetId).toBe(targetId);
    expect(body.imagePath).toMatch(/^baselines\//);
    expect(body.imagePath).not.toBe(capturePath);
  });

  it('promote route: 409 for compare-run result, 404 for unknown result', async () => {
    const env = await prisma.environment.create({
      data: { projectId, name: `cmp-${Math.random()}`, baseUrl: 'http://127.0.0.1:1' },
    });
    const run = await prisma.run.create({
      data: {
        projectId,
        environmentId: env.id,
        referenceEnvironmentId: env.id,
        trigger: 'manual',
        type: 'compare',
      },
    });
    const target = await prisma.baselineTarget.findUniqueOrThrow({ where: { id: targetId } });
    const result = await prisma.runResult.create({
      data: {
        runId: run.id,
        baselineId: target.baselineId,
        viewportId: target.viewportId,
        captureImagePath: 'captures/whatever.png',
      },
    });
    expect((await promoteRoute(new Request('http://t'), ctx(result.id))).status).toBe(409);
    expect((await promoteRoute(new Request('http://t'), ctx('nope'))).status).toBe(404);
  });

  it('pending-versions lists cross-project queue with baseline and viewport context', async () => {
    const id = await makePendingVersion();
    const res = await pendingRoute();
    const body = await res.json();
    const mine = body.versions.find((v: { id: string }) => v.id === id);
    expect(mine).toBeDefined();
    expect(mine.target.baseline.name).toBe('home');
    expect(mine.target.baseline.project.id).toBe(projectId);
    expect(mine.target.viewport.name).toBe('desktop');
  });
});
