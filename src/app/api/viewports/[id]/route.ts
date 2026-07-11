import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.viewport.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'viewport not found');
  const viewport = await prisma.viewport.update({ where: { id }, data: body.data });
  return Response.json(viewport);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.viewport.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'viewport not found');
  await prisma.viewport.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
