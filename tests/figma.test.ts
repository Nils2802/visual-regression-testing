import { describe, expect, it } from 'vitest';
import { parseFigmaFrameUrl, computeScale, fetchNodeWidths, exportNodeImages } from '@/lib/figma';
import { ApiError } from '@/lib/api-error';

describe('parseFigmaFrameUrl', () => {
  it('parses design URLs and converts node-id dashes to colons', () => {
    expect(parseFigmaFrameUrl('https://www.figma.com/design/AbC123/My-File?node-id=12-34&t=xyz'))
      .toEqual({ fileKey: 'AbC123', nodeId: '12:34' });
  });
  it('parses legacy file URLs', () => {
    expect(parseFigmaFrameUrl('https://www.figma.com/file/K9/Name?node-id=1-2'))
      .toEqual({ fileKey: 'K9', nodeId: '1:2' });
  });
  it('rejects non-figma URLs and missing node-id', () => {
    expect(() => parseFigmaFrameUrl('https://example.com/design/x?node-id=1-2')).toThrowError(ApiError);
    expect(() => parseFigmaFrameUrl('https://www.figma.com/design/AbC123/File')).toThrowError(ApiError);
  });
});

describe('computeScale', () => {
  it('computes downscale ratios to 4 decimals', () => {
    expect(computeScale(2880, 1440)).toBe(0.5);
    expect(computeScale(1512, 1440)).toBe(0.9524);
  });
  it('allows same-width within tolerance', () => {
    expect(computeScale(1440, 1440)).toBe(1);
  });
  it('rejects upscaling beyond tolerance with the spec message', () => {
    expect(() => computeScale(375, 1440)).toThrowError('frame width 375px incompatible with viewport width 1440px');
  });
});

describe('fetchNodeWidths', () => {
  const nodesResponse = (widths: Record<string, number>) => ({
    ok: true, status: 200,
    json: async () => ({
      nodes: Object.fromEntries(
        Object.entries(widths).map(([id, width]) => [id, { document: { absoluteBoundingBox: { width, height: 100 } } }])
      ),
    }),
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  it('returns widths per node id and sends the token header', async () => {
    let seenUrl = ''; let seenHeaders: Record<string, string> | undefined;
    const widths = await fetchNodeWidths('tok', 'KEY', ['1:2', '3:4'], async (url, init) => {
      seenUrl = url; seenHeaders = init?.headers;
      return nodesResponse({ '1:2': 1440, '3:4': 375 });
    });
    expect(widths.get('1:2')).toBe(1440);
    expect(widths.get('3:4')).toBe(375);
    expect(seenUrl).toContain('/v1/files/KEY/nodes?ids=');
    expect(seenHeaders?.['X-Figma-Token']).toBe('tok');
  });

  it('maps 403 to a token-rejected ApiError', async () => {
    await expect(
      fetchNodeWidths('bad', 'KEY', ['1:2'], async () => ({ ok: false, status: 403, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }))
    ).rejects.toThrowError('Figma token rejected');
  });

  it('flags a node missing from the response', async () => {
    await expect(
      fetchNodeWidths('tok', 'KEY', ['1:2', '9:9'], async () => nodesResponse({ '1:2': 100 }))
    ).rejects.toThrowError('Figma node 9:9 not found');
  });
});

describe('exportNodeImages', () => {
  it('exports then downloads each image', async () => {
    const png = Buffer.from('PNGDATA');
    const images = await exportNodeImages('tok', 'KEY', ['1:2'], 0.5, async (url) => {
      if (url.includes('/v1/images/')) {
        expect(url).toContain('scale=0.5');
        expect(url).toContain('format=png');
        return { ok: true, status: 200, json: async () => ({ err: null, images: { '1:2': 'https://cdn/img.png' } }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
    });
    expect(images.get('1:2')?.equals(png)).toBe(true);
  });

  it('flags a null export URL', async () => {
    await expect(
      exportNodeImages('tok', 'KEY', ['1:2'], 1, async () => ({ ok: true, status: 200, json: async () => ({ err: null, images: { '1:2': null } }), arrayBuffer: async () => new ArrayBuffer(0) }))
    ).rejects.toThrowError('Figma export failed for node 1:2');
  });
});
