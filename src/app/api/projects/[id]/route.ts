import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson, serializeBaseline } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
});

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      environments: true,
      viewports: true,
      baselines: { include: { targets: true } },
    },
  });
  if (!project) return jsonError(404, 'project not found');
  return Response.json({ ...project, baselines: project.baselines.map(serializeBaseline) });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  const project = await prisma.project.update({ where: { id }, data: body.data });
  return Response.json(project);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  await prisma.project.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
