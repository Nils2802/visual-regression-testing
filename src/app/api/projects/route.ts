import { z } from 'zod';
import { prisma } from '@/lib/db';
import { readJson, serializeProject } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  diffThreshold: z.number().gt(0).lt(1).optional(),
});

export async function GET(): Promise<Response> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { results: { select: { visualStatus: true, functionalStatus: true } } },
      },
    },
  });
  return Response.json({
    projects: projects.map(({ runs, ...p }) => {
      const lastRun = runs[0] ?? null;
      const failedResultCount = lastRun
        ? lastRun.results.filter(
            (r) =>
              r.visualStatus === 'diff' ||
              r.visualStatus === 'fail' ||
              r.functionalStatus === 'fail'
          ).length
        : 0;
      return {
        ...serializeProject(p),
        lastRun: lastRun
          ? { id: lastRun.id, status: lastRun.status, createdAt: lastRun.createdAt }
          : null,
        failedResultCount,
      };
    }),
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req, createSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.create({ data: body.data });
  return Response.json(serializeProject(project), { status: 201 });
}
