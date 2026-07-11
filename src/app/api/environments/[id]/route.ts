import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'environment not found');
  const environment = await prisma.environment.update({ where: { id }, data: body.data });
  return Response.json(environment);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'environment not found');
  await prisma.environment.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
