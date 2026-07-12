import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';
import { LOG_TYPES } from '@/lib/collector';

type Ctx = { params: Promise<{ id: string }> };

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const patchSchema = z.object({
  reason: z.string().min(1).optional(),
  entryType: z.enum(LOG_TYPES).nullable().optional(),
  urlPattern: z.string().min(1).refine(validRegex, 'invalid regex').nullable().optional(),
  messagePattern: z.string().min(1).refine(validRegex, 'invalid regex').nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  if (!body.ok) return body.res;
  const existing = await prisma.ignoreRule.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'ignore rule not found');
  const merged = { ...existing, ...body.data };
  if (!merged.entryType && !merged.urlPattern && !merged.messagePattern) {
    return jsonError(400, 'at least one of entryType, urlPattern, messagePattern is required');
  }
  const rule = await prisma.ignoreRule.update({ where: { id }, data: body.data });
  return Response.json(rule);
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const existing = await prisma.ignoreRule.findUnique({ where: { id } });
  if (!existing) return jsonError(404, 'ignore rule not found');
  await prisma.ignoreRule.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
