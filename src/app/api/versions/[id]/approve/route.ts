import { approveVersion } from '@/lib/approval';
import { errorResponse } from '@/lib/api';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    return Response.json(await approveVersion(id));
  } catch (err) {
    return errorResponse(err);
  }
}
