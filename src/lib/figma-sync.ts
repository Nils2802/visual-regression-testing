import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api-error';
import { decryptSecret } from '@/lib/crypto';
import { saveImage } from '@/lib/storage';
import { FetchLike, computeScale, fetchNodeWidths, exportNodeImages } from '@/lib/figma';

// Sync jobs run through their own sequential chain, separate from
// lib/queue.ts's capture-run chain, so a slow Figma sync never blocks (or is
// blocked by) capture jobs.
let chain: Promise<unknown> = Promise.resolve();

export function enqueueSync(job: () => Promise<void>): Promise<void> {
  const next = chain.then(() => job());
  chain = next.catch(() => {}); // swallow for the chain only; caller still sees the rejection
  return next;
}

type LinkedTarget = {
  id: string;
  figmaFileKey: string;
  figmaNodeId: string;
  viewport: { width: number };
};

export async function syncBaseline(baselineId: string, fetchImpl?: FetchLike): Promise<void> {
  try {
    const baseline = await prisma.baseline.findUniqueOrThrow({
      where: { id: baselineId },
      include: { project: true, targets: { include: { viewport: true } } },
    });

    const targets: LinkedTarget[] = baseline.targets.filter(
      (t): t is typeof t & { figmaFileKey: string; figmaNodeId: string } =>
        t.figmaFileKey !== null && t.figmaNodeId !== null
    );
    if (targets.length === 0) {
      throw new ApiError(422, 'baseline has no Figma-linked targets');
    }
    if (baseline.project.figmaToken === null) {
      throw new ApiError(422, 'project has no Figma token');
    }
    const token = decryptSecret(baseline.project.figmaToken);

    // One fetchNodeWidths call per distinct fileKey.
    const fileKeys = [...new Set(targets.map((t) => t.figmaFileKey))];
    const widthsByFileKey = new Map<string, Map<string, number>>();
    for (const fileKey of fileKeys) {
      const nodeIds = [
        ...new Set(targets.filter((t) => t.figmaFileKey === fileKey).map((t) => t.figmaNodeId)),
      ];
      widthsByFileKey.set(fileKey, await fetchNodeWidths(token, fileKey, nodeIds, fetchImpl));
    }

    // Group targets by (fileKey, scale) so each group needs exactly one
    // exportNodeImages call.
    const groups = new Map<string, { fileKey: string; scale: number; targets: LinkedTarget[] }>();
    for (const target of targets) {
      const frameWidth = widthsByFileKey.get(target.figmaFileKey)!.get(target.figmaNodeId)!;
      const scale = computeScale(frameWidth, target.viewport.width);
      const key = `${target.figmaFileKey}::${scale}`;
      const group = groups.get(key);
      if (group) {
        group.targets.push(target);
      } else {
        groups.set(key, { fileKey: target.figmaFileKey, scale, targets: [target] });
      }
    }

    for (const group of groups.values()) {
      const nodeIds = [...new Set(group.targets.map((t) => t.figmaNodeId))];
      const images = await exportNodeImages(token, group.fileKey, nodeIds, group.scale, fetchImpl);
      for (const target of group.targets) {
        const png = images.get(target.figmaNodeId)!;
        const imagePath = await saveImage('baselines', `${target.id}-${Date.now()}`, png);
        await prisma.baselineVersion.create({
          data: { targetId: target.id, imagePath, status: 'pending' },
        });
      }
    }

    await prisma.baseline.update({
      where: { id: baselineId },
      data: { syncStatus: 'ok', syncError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.baseline.update({
        where: { id: baselineId },
        data: { syncStatus: 'sync-error', syncError: message },
      });
    } catch {
      // Recording failure (e.g. DB down) must never mask the original error.
    }
    throw err;
  }
}
