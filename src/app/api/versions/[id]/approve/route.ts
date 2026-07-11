import { approveVersion } from '@/lib/approval';
import { jsonError } from '@/lib/api';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await approveVersion(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'version not found') return jsonError(404, message);
    return jsonError(409, message);
  }
}
