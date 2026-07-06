import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('schema', () => {
  beforeAll(async () => {
    await prisma.project.deleteMany();
  });

  it('creates project → viewport → baseline → target → version graph', async () => {
    const project = await prisma.project.create({ data: { name: 'demo' } });
    const viewport = await prisma.viewport.create({
      data: { projectId: project.id, name: 'desktop', width: 1440, height: 900 },
    });
    const baseline = await prisma.baseline.create({
      data: { projectId: project.id, name: 'home', pagePath: '/', sourceType: 'capture' },
    });
    const target = await prisma.baselineTarget.create({
      data: { baselineId: baseline.id, viewportId: viewport.id },
    });
    const version = await prisma.baselineVersion.create({
      data: { targetId: target.id, imagePath: 'baselines/x.png', status: 'approved', isActive: true },
    });
    expect(version.isActive).toBe(true);
    expect(project.diffThreshold).toBe(0.01);
  });

  it('enforces one target per baseline+viewport', async () => {
    const project = await prisma.project.create({ data: { name: 'uniq' } });
    const vp = await prisma.viewport.create({
      data: { projectId: project.id, name: 'm', width: 375, height: 812 },
    });
    const b = await prisma.baseline.create({
      data: { projectId: project.id, name: 'p', pagePath: '/p', sourceType: 'upload' },
    });
    await prisma.baselineTarget.create({ data: { baselineId: b.id, viewportId: vp.id } });
    await expect(
      prisma.baselineTarget.create({ data: { baselineId: b.id, viewportId: vp.id } })
    ).rejects.toThrow();
  });
});
