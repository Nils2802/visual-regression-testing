import { z } from 'zod';
import { prisma } from '@/lib/db';
import { errorResponse, jsonError, readJson, serializeBaseline, serializeProject } from '@/lib/api';
import { encryptSecret } from '@/lib/crypto';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
  figmaToken: z.string().min(1).nullable().optional(),
});

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      environments: true,
      viewports: true,
      baselines: { include: { targets: { include: { versions: true } } } },
    },
  });
  if (!project) return jsonError(404, 'project not found');
  return Response.json({
    ...serializeProject(project),
    baselines: project.baselines.map(serializeBaseline),
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  try {
    const { figmaToken, ...rest } = body.data;
    const data: typeof rest & { figmaToken?: string | null } = { ...rest };
    if (figmaToken !== undefined) data.figmaToken = figmaToken === null ? null : encryptSecret(figmaToken);
    const project = await prisma.project.update({ where: { id }, data });
    return Response.json(serializeProject(project));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'project not found');
  await prisma.project.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
