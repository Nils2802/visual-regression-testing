import { describe, it, expect, beforeAll } from 'vitest';
import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { POST as createBaseline } from '@/app/api/projects/[id]/baselines/route';
import {
  GET as getBaseline,
  PATCH as patchBaseline,
  DELETE as deleteBaseline,
} from '@/app/api/baselines/[id]/route';
import { POST as uploadVersion } from '@/app/api/baselines/[id]/targets/[viewportId]/versions/route';
import { POST as syncBaselineRoute } from '@/app/api/baselines/[id]/sync/route';

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

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://test.local', { method, body: JSON.stringify(body) });
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
    expect(baseline.maskSelectors).toEqual([]);
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
    expect(detail.maskSelectors).toEqual([]);
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

  it('dedupes duplicate viewportIds on create', async () => {
    const res = await createBaseline(
      jsonReq({
        name: 'dupes',
        pagePath: '/dupes',
        sourceType: 'capture',
        viewportIds: [vpMobile, vpMobile],
      }),
      ctx(projectId)
    );
    expect(res.status).toBe(201);
    const baseline = await res.json();
    expect(baseline.targets).toHaveLength(1);
    expect(baseline.targets[0].viewportId).toBe(vpMobile);
  });

  it('patches scalar fields and leaves the rest untouched', async () => {
    const created = await createBaseline(
      jsonReq({
        name: 'patch-me',
        pagePath: '/patch',
        sourceType: 'capture',
        elementSelector: '#hero',
        diffThreshold: 0.02,
        maskSelectors: ['.ad'],
      }),
      ctx(projectId)
    );
    const baseline = await created.json();

    const res = await patchBaseline(
      jsonReq({ name: 'patched', pagePath: '/patched', diffThreshold: 0.05 }, 'PATCH'),
      ctx(baseline.id)
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe('patched');
    expect(updated.pagePath).toBe('/patched');
    expect(updated.diffThreshold).toBe(0.05);
    // omitted fields stay untouched
    expect(updated.elementSelector).toBe('#hero');
    expect(updated.maskSelectors).toEqual(['.ad']);
    expect(updated.sourceType).toBe('capture');
  });

  it('clears nullable fields with explicit null', async () => {
    const created = await createBaseline(
      jsonReq({
        name: 'null-me',
        pagePath: '/null',
        sourceType: 'capture',
        elementSelector: '#hero',
        diffThreshold: 0.02,
      }),
      ctx(projectId)
    );
    const baseline = await created.json();

    const res = await patchBaseline(
      jsonReq({ elementSelector: null, diffThreshold: null }, 'PATCH'),
      ctx(baseline.id)
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.elementSelector).toBeNull();
    expect(updated.diffThreshold).toBeNull();
    // omitted fields stay untouched
    expect(updated.name).toBe('null-me');
    expect(updated.pagePath).toBe('/null');
  });

  it('round-trips maskSelectors through PATCH', async () => {
    const created = await createBaseline(
      jsonReq({ name: 'mask-me', pagePath: '/mask', sourceType: 'capture' }),
      ctx(projectId)
    );
    const baseline = await created.json();

    const res = await patchBaseline(
      jsonReq({ maskSelectors: ['.a', '.b'] }, 'PATCH'),
      ctx(baseline.id)
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.maskSelectors).toEqual(['.a', '.b']);

    const row = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(JSON.parse(row.maskSelectors)).toEqual(['.a', '.b']);
  });

  it('404s PATCH and DELETE on unknown ids', async () => {
    expect((await patchBaseline(jsonReq({ name: 'x' }, 'PATCH'), ctx('nope'))).status).toBe(404);
    expect((await deleteBaseline(new Request('http://test.local'), ctx('nope'))).status).toBe(404);
  });

  describe('figma-sourced baselines', () => {
    it('creates a figma baseline with a frame URL per viewport, storing parsed fileKey/nodeId (dash→colon)', async () => {
      const res = await createBaseline(
        jsonReq({
          name: 'figma-home',
          pagePath: '/figma-home',
          sourceType: 'figma',
          viewportIds: [vpMobile, vpDesktop],
          figmaFrames: [
            { viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' },
            { viewportId: vpDesktop, url: 'https://www.figma.com/design/ABC123/Home?node-id=3-4' },
          ],
        }),
        ctx(projectId)
      );
      expect(res.status).toBe(201);
      const baseline = await res.json();
      const mobileTarget = baseline.targets.find((t: { viewportId: string }) => t.viewportId === vpMobile);
      const desktopTarget = baseline.targets.find((t: { viewportId: string }) => t.viewportId === vpDesktop);
      expect(mobileTarget.figmaFileKey).toBe('ABC123');
      expect(mobileTarget.figmaNodeId).toBe('1:2');
      expect(desktopTarget.figmaFileKey).toBe('ABC123');
      expect(desktopTarget.figmaNodeId).toBe('3:4');
    });

    it('rejects a figma create missing a viewport frame URL', async () => {
      const res = await createBaseline(
        jsonReq({
          name: 'figma-missing',
          pagePath: '/figma-missing',
          sourceType: 'figma',
          viewportIds: [vpMobile, vpDesktop],
          figmaFrames: [
            { viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' },
          ],
        }),
        ctx(projectId)
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('figma baselines need a frame URL per viewport');
    });

    it('rejects a figma create with an extra frame for a viewport outside the selection', async () => {
      const res = await createBaseline(
        jsonReq({
          name: 'figma-extra',
          pagePath: '/figma-extra',
          sourceType: 'figma',
          viewportIds: [vpMobile],
          figmaFrames: [
            { viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' },
            { viewportId: vpDesktop, url: 'https://www.figma.com/design/ABC123/Home?node-id=3-4' },
          ],
        }),
        ctx(projectId)
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('figma baselines need a frame URL per viewport');
    });

    it('rejects a figma create with no figmaFrames at all', async () => {
      const res = await createBaseline(
        jsonReq({ name: 'figma-none', pagePath: '/figma-none', sourceType: 'figma', viewportIds: [vpMobile] }),
        ctx(projectId)
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('figma baselines need a frame URL per viewport');
    });

    it('rejects a figma create with an invalid frame URL', async () => {
      const res = await createBaseline(
        jsonReq({
          name: 'figma-bad-url',
          pagePath: '/figma-bad-url',
          sourceType: 'figma',
          viewportIds: [vpMobile],
          figmaFrames: [{ viewportId: vpMobile, url: 'not-a-url' }],
        }),
        ctx(projectId)
      );
      expect(res.status).toBe(400);
    });

    it('rejects a figmaFrames PATCH on a non-figma baseline', async () => {
      const created = await createBaseline(
        jsonReq({ name: 'upload-patch', pagePath: '/upload-patch', sourceType: 'upload' }),
        ctx(projectId)
      );
      const baseline = await created.json();
      const res = await patchBaseline(
        jsonReq(
          { figmaFrames: [{ viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' }] },
          'PATCH'
        ),
        ctx(baseline.id)
      );
      expect(res.status).toBe(400);
    });

    it('updates target figma links via PATCH on a figma baseline', async () => {
      const created = await createBaseline(
        jsonReq({
          name: 'figma-patch',
          pagePath: '/figma-patch',
          sourceType: 'figma',
          viewportIds: [vpMobile],
          figmaFrames: [{ viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' }],
        }),
        ctx(projectId)
      );
      const baseline = await created.json();

      const res = await patchBaseline(
        jsonReq(
          { figmaFrames: [{ viewportId: vpMobile, url: 'https://www.figma.com/design/XYZ999/Home?node-id=5-6' }] },
          'PATCH'
        ),
        ctx(baseline.id)
      );
      expect(res.status).toBe(200);

      const detail = await (await getBaseline(new Request('http://test.local'), ctx(baseline.id))).json();
      const target = detail.targets.find((t: { viewportId: string }) => t.viewportId === vpMobile);
      expect(target.figmaFileKey).toBe('XYZ999');
      expect(target.figmaNodeId).toBe('5:6');
    });

    it('rejects a figmaFrames PATCH with a viewportId that does not match a baseline target, leaving targets unchanged', async () => {
      const created = await createBaseline(
        jsonReq({
          name: 'figma-bogus-viewport',
          pagePath: '/figma-bogus-viewport',
          sourceType: 'figma',
          viewportIds: [vpMobile],
          figmaFrames: [{ viewportId: vpMobile, url: 'https://www.figma.com/design/ABC123/Home?node-id=1-2' }],
        }),
        ctx(projectId)
      );
      const baseline = await created.json();

      const res = await patchBaseline(
        jsonReq(
          { figmaFrames: [{ viewportId: vpDesktop, url: 'https://www.figma.com/design/XYZ999/Home?node-id=5-6' }] },
          'PATCH'
        ),
        ctx(baseline.id)
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe(`figmaFrames viewportId ${vpDesktop} does not match a baseline target`);

      const detail = await (await getBaseline(new Request('http://test.local'), ctx(baseline.id))).json();
      const target = detail.targets.find((t: { viewportId: string }) => t.viewportId === vpMobile);
      expect(target.figmaFileKey).toBe('ABC123');
      expect(target.figmaNodeId).toBe('1:2');
    });
  });

  // The route always exercises the real (unmockable) network fetch, so it can
  // only cover paths that fail before any Figma call is made: unknown
  // baseline (404) and no-figma-linked-targets (422). syncBaseline's batching,
  // scale-grouping, sync-error recording, and network-failure paths are
  // covered at the service level in tests/figma-sync.test.ts against a
  // recording fake FetchLike, which the route has no way to inject.
  describe('POST /api/baselines/:id/sync', () => {
    it('404s on an unknown baseline', async () => {
      const res = await syncBaselineRoute(new Request('http://test.local', { method: 'POST' }), ctx('nope'));
      expect(res.status).toBe(404);
    });

    it('400s a non-figma baseline without enqueueing a sync-error', async () => {
      const created = await createBaseline(
        jsonReq({ name: 'no-figma', pagePath: '/no-figma', sourceType: 'capture' }),
        ctx(projectId)
      );
      const baseline = await created.json();

      const res = await syncBaselineRoute(new Request('http://test.local', { method: 'POST' }), ctx(baseline.id));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('only figma-sourced baselines can be synced');

      const row = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
      expect(row.syncStatus).not.toBe('sync-error');
      expect(row.syncError).toBeNull();
    });
  });
});
