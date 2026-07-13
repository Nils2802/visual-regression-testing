import { z } from 'zod';
import { prisma } from '@/lib/db';
import { errorResponse, jsonError, readJson, serializeRun } from '@/lib/api';
import { startRun } from '@/lib/run-service';

type Ctx = { params: Promise<{ id: string }> };

const triggerSchema = z.object({
  environmentId: z.string().min(1),
  type: z.enum(['visual', 'compare']).optional(),
  referenceEnvironmentId: z.string().min(1).optional(),
  viewportIds: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, triggerSchema);
  if (!body.ok) return body.res;
  try {
    const run = await startRun({ projectId: id, trigger: 'manual', ...body.data });
    return Response.json(serializeRun(run), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const runs = await prisma.run.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      environment: { select: { id: true, name: true } },
      results: { select: { visualStatus: true, functionalStatus: true } },
    },
  });
  return Response.json({
    runs: runs.map(({ results, ...run }) => ({
      ...serializeRun(run),
      resultCount: results.length,
      failedResultCount: results.filter(
        (r) =>
          r.visualStatus === 'diff' || r.visualStatus === 'fail' || r.functionalStatus === 'fail'
      ).length,
    })),
  });
}
