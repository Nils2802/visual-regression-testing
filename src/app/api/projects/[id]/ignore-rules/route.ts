import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

const LOG_TYPES = [
  'console-error',
  'console-warning',
  'page-error',
  'http-error',
  'network-error',
] as const;

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// NOTE: not exported — Next.js route modules may only export HTTP handlers/config
const ruleSchema = z
  .object({
    reason: z.string().min(1),
    entryType: z.enum(LOG_TYPES).optional(),
    urlPattern: z.string().min(1).refine(validRegex, 'invalid regex').optional(),
    messagePattern: z.string().min(1).refine(validRegex, 'invalid regex').optional(),
  })
  .refine((r) => r.entryType || r.urlPattern || r.messagePattern, {
    message: 'at least one of entryType, urlPattern, messagePattern is required',
  });

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const rules = await prisma.ignoreRule.findMany({ where: { projectId: id } });
  return Response.json({ rules });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, ruleSchema);
  if (!body.ok) return body.res;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return jsonError(404, 'project not found');
  const rule = await prisma.ignoreRule.create({ data: { projectId: id, ...body.data } });
  return Response.json(rule, { status: 201 });
}
