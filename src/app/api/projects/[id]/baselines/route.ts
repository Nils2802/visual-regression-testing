import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  pagePath: z.string().startsWith('/'),
  elementSelector: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(['upload', 'capture']),
  viewportIds: z.array(z.string()).nonempty().optional(),
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
    include: { viewports: { select: { id: true } } },
  });
  if (!project) return jsonError(404, 'project not found');

  const { viewportIds, maskSelectors, ...fields } = body.data;
  const projectViewportIds = project.viewports.map((v) => v.id);
  const selected = viewportIds ?? projectViewportIds;
  const unknown = selected.filter((v) => !projectViewportIds.includes(v));
  if (unknown.length > 0) return jsonError(400, `unknown viewport ids: ${unknown.join(', ')}`);
  const baseline = await prisma.baseline.create({
    data: {
      projectId: id,
      ...fields,
      maskSelectors: JSON.stringify(maskSelectors ?? []),
      targets: { create: selected.map((viewportId) => ({ viewportId })) },
    },
    include: { targets: true },
  });
  return Response.json(baseline, { status: 201 });
}
