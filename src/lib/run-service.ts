import type { Run } from '@prisma/client';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { executeRun } from '@/lib/runner';
import { getBrowser } from '@/lib/browser';
import { ApiError } from '@/lib/api-error';
import { syncBaseline } from '@/lib/figma-sync';

export interface StartRunInput {
  projectId: string;
  environmentId: string;
  type?: 'visual' | 'compare';
  referenceEnvironmentId?: string;
  viewportIds?: string[];
  trigger?: 'manual' | 'api';
}

export async function startRun(input: StartRunInput): Promise<Run> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { viewports: { select: { id: true } } },
  });
  if (!project) throw new ApiError(404, 'project not found');

  const environment = await prisma.environment.findUnique({ where: { id: input.environmentId } });
  if (!environment || environment.projectId !== project.id) {
    throw new ApiError(400, 'environment does not belong to project');
  }

  const type = input.type ?? 'visual';
  if (type === 'compare') {
    if (!input.referenceEnvironmentId)
      throw new ApiError(400, 'compare run requires referenceEnvironmentId');
    const reference = await prisma.environment.findUnique({
      where: { id: input.referenceEnvironmentId },
    });
    if (!reference || reference.projectId !== project.id) {
      throw new ApiError(400, 'reference environment does not belong to project');
    }
  }

  const viewportIds = input.viewportIds ?? [];
  const known = project.viewports.map((v) => v.id);
  const unknown = viewportIds.filter((v) => !known.includes(v));
  if (unknown.length > 0) throw new ApiError(400, `unknown viewport ids: ${unknown.join(', ')}`);

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      environmentId: environment.id,
      referenceEnvironmentId: type === 'compare' ? input.referenceEnvironmentId : null,
      type,
      trigger: input.trigger ?? 'manual',
      viewportIds: JSON.stringify(viewportIds),
    },
  });

  // Fire and forget: executeRun marks the run failed on its own errors. The
  // catch below covers failures BEFORE executeRun takes over (browser launch
  // failure, run row deleted before the job starts): log them and mark the
  // run failed if it is still non-terminal, so it never sits at `queued`.
  void enqueue(async () => {
    if (project.syncBeforeRun) {
      const figmaBaselines = await prisma.baseline.findMany({
        where: { projectId: project.id, sourceType: 'figma' },
        select: { id: true },
      });
      for (const baseline of figmaBaselines) {
        // syncBaseline records sync-error (message + last approved version
        // stays active) on the baseline itself before rethrowing — swallow
        // here so a Figma failure never fails the run (spec §4). Called
        // directly rather than via figma-sync's enqueueSync: this job is
        // already serialized on the run queue, so awaiting each sync in
        // order already gives the ordering enqueueSync would provide;
        // routing through the separate sync-only chain would just add a
        // hop with no different guarantee for these baselines.
        await syncBaseline(baseline.id).catch(() => {});
      }
    }
    return executeRun(run.id, await getBrowser());
  }).catch(async (err) => {
    console.error(`run ${run.id} failed before execution:`, err);
    await prisma.run
      .updateMany({
        where: { id: run.id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => {});
  });

  return run;
}
