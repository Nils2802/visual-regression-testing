import { prisma } from '@/lib/db';
import { jsonError, errorResponse, serializeBaseline } from '@/lib/api';
import { enqueueSync, syncBaseline } from '@/lib/figma-sync';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  if (existing.sourceType !== 'figma') {
    return jsonError(400, 'only figma-sourced baselines can be synced');
  }

  try {
    await enqueueSync(() => syncBaseline(id));
  } catch (err) {
    return errorResponse(err);
  }

  const baseline = await prisma.baseline.findUniqueOrThrow({
    where: { id },
    include: {
      targets: {
        include: { viewport: true, versions: { orderBy: { createdAt: 'desc' } } },
      },
    },
  });
  return Response.json(serializeBaseline(baseline));
}
