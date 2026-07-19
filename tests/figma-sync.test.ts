import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { enqueueSync, syncBaseline } from '@/lib/figma-sync';
import type { FetchLike } from '@/lib/figma';

process.env.VRT_ENCRYPTION_KEY ??= 'a'.repeat(64);

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Records every fetch call (by URL) so tests can assert on batching, and
// serves synthetic /v1/files, /v1/images, and image-download responses.
function recordingFetch(widths: Record<string, number>, opts: { forbidden?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (opts.forbidden) {
      return { ok: false, status: 403, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (url.includes('/nodes?')) {
      const ids = (new URL(url).searchParams.get('ids') ?? '').split(',');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nodes: Object.fromEntries(
            ids.map((id) => [id, { document: { absoluteBoundingBox: { width: widths[id], height: 100 } } }])
          ),
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    if (url.includes('/v1/images/')) {
      const ids = (new URL(url).searchParams.get('ids') ?? '').split(',');
      return {
        ok: true,
        status: 200,
        json: async () => ({ err: null, images: Object.fromEntries(ids.map((id) => [id, `https://cdn/${id}.png`])) }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    // image download URL: https://cdn/<id>.png
    const id = url.split('https://cdn/')[1]?.replace('.png', '') ?? 'unknown';
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => toArrayBuffer(Buffer.from(`PNG-${id}`)) };
  };
  return { fetchImpl, calls };
}

async function seedProject(tokenSet = true) {
  return prisma.project.create({
    data: {
      name: `p-${Date.now()}-${Math.random()}`,
      figmaToken: tokenSet ? encryptSecret('figd_tok') : null,
    },
  });
}

async function seedTarget(
  projectId: string,
  baselineId: string,
  opts: { fileKey?: string; nodeId: string; viewportWidth: number }
) {
  const viewport = await prisma.viewport.create({
    data: { projectId, name: `vp-${Math.random()}`, width: opts.viewportWidth, height: 900 },
  });
  return prisma.baselineTarget.create({
    data: {
      baselineId,
      viewportId: viewport.id,
      figmaFileKey: opts.fileKey ?? 'FILEKEY',
      figmaNodeId: opts.nodeId,
    },
  });
}

async function seedBaseline(projectId: string) {
  return prisma.baseline.create({
    data: { projectId, name: 'b', pagePath: '/', sourceType: 'figma' },
  });
}

describe('syncBaseline', () => {
  it('happy path: 2 targets, same fileKey, different frame widths → 2 pending versions, syncStatus ok, one /v1/files/ call, one images call per scale', async () => {
    const project = await seedProject();
    const baseline = await seedBaseline(project.id);
    await seedTarget(project.id, baseline.id, { nodeId: '1:1', viewportWidth: 1440 });
    await seedTarget(project.id, baseline.id, { nodeId: '2:2', viewportWidth: 375 });

    const { fetchImpl, calls } = recordingFetch({ '1:1': 1440, '2:2': 750 }); // scales: 1 and 0.5

    await syncBaseline(baseline.id, fetchImpl);

    const nodesCalls = calls.filter((u) => u.includes('/nodes?'));
    const imagesCalls = calls.filter((u) => u.includes('/v1/images/'));
    expect(nodesCalls).toHaveLength(1);
    expect(imagesCalls).toHaveLength(2);

    const targets = await prisma.baselineTarget.findMany({
      where: { baselineId: baseline.id },
      include: { versions: true },
    });
    const versions = targets.flatMap((t) => t.versions);
    expect(versions).toHaveLength(2);
    expect(versions.every((v) => v.status === 'pending')).toBe(true);
    expect(new Set(versions.map((v) => v.imagePath)).size).toBe(2);

    const refreshed = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(refreshed.syncStatus).toBe('ok');
    expect(refreshed.syncError).toBeNull();
  });

  it('same-scale batching: 2 targets whose (fileKey, scale) match → a single /v1/images/ call with both ids', async () => {
    const project = await seedProject();
    const baseline = await seedBaseline(project.id);
    await seedTarget(project.id, baseline.id, { nodeId: '1:1', viewportWidth: 1440 });
    await seedTarget(project.id, baseline.id, { nodeId: '2:2', viewportWidth: 1440 });

    const { fetchImpl, calls } = recordingFetch({ '1:1': 1440, '2:2': 1440 }); // both scale 1

    await syncBaseline(baseline.id, fetchImpl);

    const imagesCalls = calls.filter((u) => u.includes('/v1/images/'));
    expect(imagesCalls).toHaveLength(1);
    expect(imagesCalls[0]).toContain(encodeURIComponent('1:1'));
    expect(imagesCalls[0]).toContain(encodeURIComponent('2:2'));
  });

  it('incompatible frame width (375 vs 1440) rejects: baseline sync-error, syncError contains "incompatible", no version created', async () => {
    const project = await seedProject();
    const baseline = await seedBaseline(project.id);
    await seedTarget(project.id, baseline.id, { nodeId: '1:1', viewportWidth: 1440 });

    const { fetchImpl } = recordingFetch({ '1:1': 375 }); // frame 375, viewport 1440 → upscale > tolerance

    await expect(syncBaseline(baseline.id, fetchImpl)).rejects.toThrow('incompatible');

    const refreshed = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(refreshed.syncStatus).toBe('sync-error');
    expect(refreshed.syncError).toContain('incompatible');

    const versions = await prisma.baselineVersion.findMany({ where: { target: { baselineId: baseline.id } } });
    expect(versions).toHaveLength(0);
  });

  it('no Figma-linked targets → ApiError 422, sync-error recorded', async () => {
    const project = await seedProject();
    const baseline = await seedBaseline(project.id);
    // a non-figma-linked target: create directly with null figma fields
    const viewport = await prisma.viewport.create({
      data: { projectId: project.id, name: 'vp', width: 1440, height: 900 },
    });
    await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: viewport.id } });

    await expect(syncBaseline(baseline.id)).rejects.toThrow('baseline has no Figma-linked targets');

    const refreshed = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(refreshed.syncStatus).toBe('sync-error');
    expect(refreshed.syncError).toBe('baseline has no Figma-linked targets');
  });

  it('token missing → ApiError 422, sync-error recorded', async () => {
    const project = await seedProject(false);
    const baseline = await seedBaseline(project.id);
    await seedTarget(project.id, baseline.id, { nodeId: '1:1', viewportWidth: 1440 });

    await expect(syncBaseline(baseline.id)).rejects.toThrow('project has no Figma token');

    const refreshed = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(refreshed.syncStatus).toBe('sync-error');
    expect(refreshed.syncError).toBe('project has no Figma token');
  });

  it('Figma 403 → sync-error recorded with "Figma token rejected"; approved versions untouched', async () => {
    const project = await seedProject();
    const baseline = await seedBaseline(project.id);
    const target = await seedTarget(project.id, baseline.id, { nodeId: '1:1', viewportWidth: 1440 });
    const approved = await prisma.baselineVersion.create({
      data: { targetId: target.id, imagePath: 'baselines/preexisting.png', status: 'approved', isActive: true },
    });

    const { fetchImpl } = recordingFetch({}, { forbidden: true });

    await expect(syncBaseline(baseline.id, fetchImpl)).rejects.toThrow('Figma token rejected');

    const refreshed = await prisma.baseline.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(refreshed.syncStatus).toBe('sync-error');
    expect(refreshed.syncError).toContain('Figma token rejected');

    const versions = await prisma.baselineVersion.findMany({ where: { targetId: target.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(approved.id);
    expect(versions[0].status).toBe('approved');
    expect(versions[0].isActive).toBe(true);
  });
});

describe('enqueueSync', () => {
  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  it('runs jobs strictly sequentially in FIFO order', async () => {
    const order: number[] = [];
    const p1 = enqueueSync(async () => {
      await sleep(100);
      order.push(1);
    });
    const p2 = enqueueSync(async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('a failing job does not block the next one', async () => {
    const order: string[] = [];
    const p1 = enqueueSync(async () => {
      throw new Error('boom');
    });
    const p2 = enqueueSync(async () => {
      order.push('ran');
    });
    await expect(p1).rejects.toThrow('boom');
    await p2;
    expect(order).toEqual(['ran']);
  });
});
