import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson, serializeBaseline, errorResponse } from '@/lib/api';
import { parseFigmaFrameUrl } from '@/lib/figma';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  pagePath: z.string().startsWith('/').optional(),
  elementSelector: z.string().min(1).nullable().optional(),
  diffThreshold: z.number().gt(0).lt(1).nullable().optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
  figmaFrames: z.array(z.object({ viewportId: z.string(), url: z.string() })).optional(),
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
  return Response.json(serializeBaseline(baseline));
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.baseline.findUnique({
    where: { id },
    include: { targets: { select: { viewportId: true } } },
  });
  if (!existing) return jsonError(404, 'baseline not found');
  const { maskSelectors, figmaFrames, ...fields } = body.data;

  if (figmaFrames !== undefined) {
    if (existing.sourceType !== 'figma') {
      return jsonError(400, 'figmaFrames only allowed on figma-sourced baselines');
    }
    const targetViewportIds = new Set(existing.targets.map((t) => t.viewportId));
    const unknownViewport = figmaFrames.find((f) => !targetViewportIds.has(f.viewportId));
    if (unknownViewport) {
      return jsonError(400, `figmaFrames viewportId ${unknownViewport.viewportId} does not match a baseline target`);
    }
    let parsed: { viewportId: string; fileKey: string; nodeId: string }[];
    try {
      parsed = figmaFrames.map((f) => ({ viewportId: f.viewportId, ...parseFigmaFrameUrl(f.url) }));
    } catch (err) {
      return errorResponse(err);
    }
    await Promise.all(
      parsed.map((p) =>
        prisma.baselineTarget.updateMany({
          where: { baselineId: id, viewportId: p.viewportId },
          data: { figmaFileKey: p.fileKey, figmaNodeId: p.nodeId },
        })
      )
    );
  }

  const baseline = await prisma.baseline.update({
    where: { id },
    data: {
      ...fields,
      ...(maskSelectors !== undefined ? { maskSelectors: JSON.stringify(maskSelectors) } : {}),
    },
  });
  return Response.json(serializeBaseline(baseline));
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.baseline.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'baseline not found');
  await prisma.baseline.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
