import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  pagePath: z.string().startsWith('/').optional(),
  elementSelector: z.string().min(1).nullable().optional(),
  diffThreshold: z.number().gt(0).lt(1).nullable().optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
});

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const baseline = await prisma.baseline.findUnique({
    where: { id },
    include: {
      targets: {
        include: { viewport: true, versions: { orderBy: { createdAt: 'desc' } } },
      },
    },
  });
  if (!baseline) return jsonError(404, 'baseline not found');
  return Response.json(baseline);
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  const { maskSelectors, ...fields } = body.data;
  const baseline = await prisma.baseline.update({
    where: { id },
    data: {
      ...fields,
      ...(maskSelectors !== undefined ? { maskSelectors: JSON.stringify(maskSelectors) } : {}),
    },
  });
  return Response.json(baseline);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  await prisma.baseline.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
