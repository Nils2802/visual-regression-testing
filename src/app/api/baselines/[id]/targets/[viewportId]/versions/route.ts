import { PNG } from 'pngjs';
import { prisma } from '@/lib/db';
import { saveImage } from '@/lib/storage';
import { jsonError } from '@/lib/api';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; viewportId: string }> }
): Promise<Response> {
  const { id, viewportId } = await ctx.params;
  const target = await prisma.baselineTarget.findUnique({
    where: { baselineId_viewportId: { baselineId: id, viewportId } },
  });
  if (!target) return jsonError(404, 'baseline target not found');

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return jsonError(400, 'empty upload body');
  try {
    PNG.sync.read(buf);
  } catch {
    return jsonError(400, 'body is not a valid PNG');
  }

  const imagePath = await saveImage('baselines', `${target.id}-${Date.now()}`, buf);
  const version = await prisma.baselineVersion.create({
    data: { targetId: target.id, imagePath, status: 'pending' },
  });
  return Response.json(version, { status: 201 });
}
