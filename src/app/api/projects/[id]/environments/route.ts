import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const environment = await prisma.environment.create({
    data: { projectId: id, ...body.data },
  });
  return Response.json(environment, { status: 201 });
}
