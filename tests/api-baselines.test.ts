import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { POST as createBaseline } from '@/app/api/projects/[id]/baselines/route';
import { GET as getBaseline, DELETE as deleteBaseline } from '@/app/api/baselines/[id]/route';
import { POST as uploadVersion } from '@/app/api/baselines/[id]/targets/[viewportId]/versions/route';

let projectId: string;
let vpMobile: string;
let vpDesktop: string;

beforeAll(async () => {
  const project = await prisma.project.create({
    data: {
      name: 'baseline-api-proj',
      viewports: {
        create: [
          { name: 'mobile', width: 375, height: 812 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      },
    },
    include: { viewports: true },
  });
  projectId = project.id;
  vpMobile = project.viewports.find((v) => v.name === 'mobile')!.id;
  vpDesktop = project.viewports.find((v) => v.name === 'desktop')!.id;
});

function jsonReq(body: unknown) {
  return new Request('http://test.local', { method: 'POST', body: JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const targetCtx = (id: string, viewportId: string) => ({
  params: Promise.resolve({ id, viewportId }),
});

function pngBuffer(width = 4, height = 4): Buffer {
  return PNG.sync.write(new PNG({ width, height }));
}

describe('baselines API', () => {
  it('creates a baseline with targets for all viewports by default', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'home', pagePath: '/', sourceType: 'capture' }),
      ctx(projectId)
    );
    expect(res.status).toBe(201);
    const baseline = await res.json();
    expect(baseline.targets).toHaveLength(2);
  });

  it('respects a viewport subset', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'nav', pagePath: '/nav', sourceType: 'capture', viewportIds: [vpMobile] }),
      ctx(projectId)
    );
    const baseline = await res.json();
    expect(baseline.targets).toHaveLength(1);
    expect(baseline.targets[0].viewportId).toBe(vpMobile);
  });

  it('rejects a pagePath not starting with /', async () => {
    const res = await createBaseline(
      jsonReq({ name: 'bad', pagePath: 'no-slash', sourceType: 'capture' }),
      ctx(projectId)
    );
    expect(res.status).toBe(400);
  });

  it('uploads a PNG as a pending version', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'upload-me', pagePath: '/up', sourceType: 'upload' }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: new Uint8Array(pngBuffer()) }),
      targetCtx(baseline.id, vpDesktop)
    );
    expect(res.status).toBe(201);
    const version = await res.json();
    expect(version.status).toBe('pending');
    expect(version.isActive).toBe(false);
    expect(version.imagePath).toMatch(/^baselines\//);

    const detail = await (await getBaseline(new Request('http://test.local'), ctx(baseline.id))).json();
    const target = detail.targets.find((t: { viewportId: string }) => t.viewportId === vpDesktop);
    expect(target.versions).toHaveLength(1);
  });

  it('rejects non-PNG uploads with 400', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'bad-upload', pagePath: '/bad', sourceType: 'upload' }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: new Uint8Array(Buffer.from('not a png')) }),
      targetCtx(baseline.id, vpDesktop)
    );
    expect(res.status).toBe(400);
  });

  it('404s upload for a missing target and delete cascades', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'gone', pagePath: '/gone', sourceType: 'capture', viewportIds: [vpMobile] }),
      ctx(projectId)
    );
    const baseline = await created.json();
    const res = await uploadVersion(
      new Request('http://test.local', { method: 'POST', body: new Uint8Array(pngBuffer()) }),
      targetCtx(baseline.id, vpDesktop) // no target for desktop
    );
    expect(res.status).toBe(404);
    expect((await deleteBaseline(new Request('http://test.local'), ctx(baseline.id))).status).toBe(204);
  });
});
