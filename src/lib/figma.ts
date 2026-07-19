import { ApiError } from '@/lib/api-error';

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const defaultFetch = fetch as unknown as FetchLike;

export function parseFigmaFrameUrl(url: string): { fileKey: string; nodeId: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, 'not a valid Figma frame URL');
  }

  if (parsed.hostname !== 'figma.com' && parsed.hostname !== 'www.figma.com') {
    throw new ApiError(400, 'not a valid Figma frame URL');
  }

  const match = parsed.pathname.match(/^\/(design|file)\/([^/]+)/);
  if (!match) {
    throw new ApiError(400, 'not a valid Figma frame URL');
  }

  const nodeIdParam = parsed.searchParams.get('node-id');
  if (!nodeIdParam) {
    throw new ApiError(400, 'not a valid Figma frame URL');
  }

  return { fileKey: match[2], nodeId: nodeIdParam.replaceAll('-', ':') };
}

export function computeScale(frameWidth: number, viewportWidth: number): number {
  const raw = viewportWidth / frameWidth;
  if (raw > 1.02 || raw > 4 || raw < 0.01) {
    throw new ApiError(
      422,
      `frame width ${frameWidth}px incompatible with viewport width ${viewportWidth}px`
    );
  }
  return Math.round(Math.min(raw, 1) * 10000) / 10000;
}

export async function fetchNodeWidths(
  token: string,
  fileKey: string,
  nodeIds: string[],
  fetchImpl: FetchLike = defaultFetch
): Promise<Map<string, number>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds.join(','))}`;
  const res = await fetchImpl(url, { headers: { 'X-Figma-Token': token } });

  if (res.status === 403) {
    throw new ApiError(422, 'Figma token rejected');
  }
  if (!res.ok) {
    throw new ApiError(502, `Figma API error (${res.status})`);
  }

  const body = (await res.json()) as {
    nodes: Record<string, { document: { absoluteBoundingBox: { width: number; height: number } } } | undefined>;
  };

  const widths = new Map<string, number>();
  for (const id of nodeIds) {
    const node = body.nodes[id];
    if (!node) {
      throw new ApiError(422, `Figma node ${id} not found`);
    }
    widths.set(id, node.document.absoluteBoundingBox.width);
  }
  return widths;
}

export async function exportNodeImages(
  token: string,
  fileKey: string,
  nodeIds: string[],
  scale: number,
  fetchImpl: FetchLike = defaultFetch
): Promise<Map<string, Buffer>> {
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(','))}&format=png&scale=${scale}`;
  const res = await fetchImpl(url, { headers: { 'X-Figma-Token': token } });

  if (res.status === 403) {
    throw new ApiError(422, 'Figma token rejected');
  }
  if (!res.ok) {
    throw new ApiError(502, `Figma API error (${res.status})`);
  }

  const body = (await res.json()) as { err: string | null; images: Record<string, string | null> };

  const images = new Map<string, Buffer>();
  for (const id of nodeIds) {
    const imageUrl = body.images[id];
    if (!imageUrl) {
      throw new ApiError(422, `Figma export failed for node ${id}`);
    }
    const download = await fetchImpl(imageUrl);
    if (!download.ok) {
      throw new ApiError(502, `Figma API error (${download.status})`);
    }
    const buf = await download.arrayBuffer();
    images.set(id, Buffer.from(buf));
  }
  return images;
}
