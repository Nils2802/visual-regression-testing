import type { BaselineVersion } from '@prisma/client';
import { prisma } from '@/lib/db';
import { loadImage, saveImage } from '@/lib/storage';

export async function approveVersion(versionId: string): Promise<BaselineVersion> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.baselineVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new Error('version not found');
    if (version.status !== 'pending') throw new Error('only pending versions can be approved');
    await tx.baselineVersion.updateMany({
      where: { targetId: version.targetId, isActive: true },
      data: { isActive: false },
    });
    return tx.baselineVersion.update({
      where: { id: versionId },
      data: { status: 'approved', isActive: true },
    });
  });
}

export async function rejectVersion(versionId: string): Promise<BaselineVersion> {
  const version = await prisma.baselineVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new Error('version not found');
  if (version.status !== 'pending') throw new Error('only pending versions can be rejected');
  return prisma.baselineVersion.update({
    where: { id: versionId },
    data: { status: 'rejected' },
  });
}

export async function promoteResult(resultId: string): Promise<BaselineVersion> {
  const result = await prisma.runResult.findUnique({
    where: { id: resultId },
    include: { run: { select: { type: true } } },
  });
  if (!result) throw new Error('result not found');
  if (result.run.type === 'compare') throw new Error('compare-run captures cannot be promoted');
  if (!result.captureImagePath) throw new Error('result has no capture image');

  const target = await prisma.baselineTarget.findUnique({
    where: {
      baselineId_viewportId: { baselineId: result.baselineId, viewportId: result.viewportId },
    },
  });
  if (!target) throw new Error('no baseline target for this result');

  const png = await loadImage(result.captureImagePath);
  const imagePath = await saveImage('baselines', `${target.id}-${Date.now()}`, png);
  return prisma.baselineVersion.create({
    data: { targetId: target.id, imagePath, status: 'pending' },
  });
}
