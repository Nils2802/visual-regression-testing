import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson, serializeBaseline, errorResponse } from '@/lib/api';
import { parseFigmaFrameUrl } from '@/lib/figma';

const createSchema = z.object({
  name: z.string().min(1),
  pagePath: z.string().startsWith('/'),
  elementSelector: z.string().min(1).optional(),
  diffThreshold: z.number().gt(0).lt(1).optional(),
  maskSelectors: z.array(z.string().min(1)).optional(),
  sourceType: z.enum(['upload', 'capture', 'figma']),
  viewportIds: z.array(z.string()).nonempty().optional(),
  figmaFrames: z.array(z.object({ viewportId: z.string(), url: z.string() })).optional(),
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

  const { viewportIds, maskSelectors, figmaFrames, ...fields } = body.data;
  const projectViewportIds = project.viewports.map((v) => v.id);
  const selected = [...new Set(viewportIds ?? projectViewportIds)];
  const unknown = selected.filter((v) => !projectViewportIds.includes(v));
  if (unknown.length > 0) return jsonError(400, `unknown viewport ids: ${unknown.join(', ')}`);

  // figma baselines require exactly one frame URL per effective viewport —
  // no missing, no extras — so every created target has a Figma link to
  // sync against later.
  let framesByViewport: Map<string, { fileKey: string; nodeId: string }> | undefined;
  if (fields.sourceType === 'figma') {
    const frameViewportIds = new Set((figmaFrames ?? []).map((f) => f.viewportId));
    const selectedSet = new Set(selected);
    const coversExactly =
      frameViewportIds.size === selectedSet.size && [...selectedSet].every((v) => frameViewportIds.has(v));
    if (!figmaFrames || figmaFrames.length === 0 || !coversExactly) {
      return jsonError(400, 'figma baselines need a frame URL per viewport');
    }
    try {
      framesByViewport = new Map(figmaFrames.map((f) => [f.viewportId, parseFigmaFrameUrl(f.url)]));
    } catch (err) {
      return errorResponse(err);
    }
  }

  const baseline = await prisma.baseline.create({
    data: {
      projectId: id,
      ...fields,
      maskSelectors: JSON.stringify(maskSelectors ?? []),
      targets: {
        create: selected.map((viewportId) => {
          const frame = framesByViewport?.get(viewportId);
          return {
            viewportId,
            ...(frame ? { figmaFileKey: frame.fileKey, figmaNodeId: frame.nodeId } : {}),
          };
        }),
      },
    },
    include: { targets: true },
  });
  return Response.json(serializeBaseline(baseline), { status: 201 });
}
