import type { Run } from '@prisma/client';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { executeRun } from '@/lib/runner';
import { getBrowser } from '@/lib/browser';

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
  if (!project) throw new Error('project not found');

  const environment = await prisma.environment.findUnique({ where: { id: input.environmentId } });
  if (!environment || environment.projectId !== project.id) {
    throw new Error('environment does not belong to project');
  }

  const type = input.type ?? 'visual';
  if (type === 'compare') {
    if (!input.referenceEnvironmentId) throw new Error('compare run requires referenceEnvironmentId');
    const reference = await prisma.environment.findUnique({
      where: { id: input.referenceEnvironmentId },
    });
    if (!reference || reference.projectId !== project.id) {
      throw new Error('reference environment does not belong to project');
    }
  }

  const viewportIds = input.viewportIds ?? [];
  const known = project.viewports.map((v) => v.id);
  const unknown = viewportIds.filter((v) => !known.includes(v));
  if (unknown.length > 0) throw new Error(`unknown viewport ids: ${unknown.join(', ')}`);

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

  // Fire and forget: executeRun marks the run failed on its own errors; the
  // catch below only covers enqueue-level failures (e.g. run row deleted
  // before the job starts), which must not surface as unhandled rejections.
  void enqueue(async () => executeRun(run.id, await getBrowser())).catch(() => {});

  return run;
}
