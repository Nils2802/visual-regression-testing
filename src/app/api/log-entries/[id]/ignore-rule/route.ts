import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonError, readJson } from '@/lib/api';

const bodySchema = z.object({ reason: z.string().min(1) });

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await readJson(req, bodySchema);
  if (!body.ok) return body.res;

  const entry = await prisma.logEntry.findUnique({
    where: { id },
    include: { result: { include: { run: { select: { projectId: true } } } } },
  });
  if (!entry || !entry.result) return jsonError(404, 'log entry not found');

  const rule = await prisma.ignoreRule.create({
    data: {
      projectId: entry.result.run.projectId,
      reason: body.data.reason,
      entryType: entry.type,
      messagePattern: escapeRegex(entry.message),
    },
  });
  const updated = await prisma.logEntry.update({
    where: { id },
    data: { ignored: true, ignoreRuleId: rule.id },
  });
  return Response.json({ rule, entry: updated }, { status: 201 });
}
