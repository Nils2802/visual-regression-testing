import { loadImage } from '@/lib/storage';
import { jsonError } from '@/lib/api';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path: segments } = await ctx.params;
  const rel = segments.join('/');
  try {
    const png = await loadImage(rel);
    return new Response(new Uint8Array(png), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('escapes data directory')) {
      return jsonError(400, 'invalid image path');
    }
    return jsonError(404, 'image not found');
  }
}
