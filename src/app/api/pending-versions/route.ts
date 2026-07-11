import { prisma } from '@/lib/db';

export async function GET(): Promise<Response> {
  const versions = await prisma.baselineVersion.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    include: {
      target: {
        include: {
          viewport: true,
          baseline: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return Response.json({ versions });
}
