import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { baselines: { select: { id: true } } },
  });
  if (!project) return jsonError(404, 'project not found');
  const viewport = await prisma.$transaction(async (tx) => {
    const vp = await tx.viewport.create({ data: { projectId: id, ...body.data } });
    if (project.baselines.length > 0) {
      await tx.baselineTarget.createMany({
        data: project.baselines.map((b) => ({ baselineId: b.id, viewportId: vp.id })),
      });
    }
    return vp;
  });
  return Response.json(viewport, { status: 201 });
}
