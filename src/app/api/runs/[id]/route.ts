import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      environment: true,
      referenceEnvironment: true,
      results: {
        include: {
          baseline: { select: { id: true, name: true, elementSelector: true } },
          viewport: true,
          logEntries: { orderBy: { timestamp: 'asc' } },
        },
      },
    },
  });
  if (!run) return jsonError(404, 'run not found');
  return Response.json(run);
}
