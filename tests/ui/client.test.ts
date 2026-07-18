import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, imageUrl, runEventsUrl, ApiClientError } from '@/lib/client';

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), { status })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('GETs and returns parsed JSON', async () => {
    const fn = stubFetch(200, { projects: [] });
    const out = await api.projects.list();
    expect(fn).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'GET' }));
    expect(out.projects).toEqual([]);
  });

  it('POSTs JSON bodies', async () => {
    const fn = stubFetch(201, { id: 'p1', name: 'demo' });
    await api.projects.create({ name: 'demo' });
    const [, init] = fn.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'demo' });
  });

  it('throws ApiClientError with server message on non-2xx', async () => {
    stubFetch(409, { error: 'only pending versions can be approved' });
    await expect(api.versions.approve('v1')).rejects.toMatchObject({
      status: 409,
      message: 'only pending versions can be approved',
    });
    stubFetch(409, { error: 'x' });
    await expect(api.versions.approve('v1')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const fn = vi.fn().mockResolvedValue(new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fn);
    await expect(api.versions.approve('v1')).rejects.toMatchObject({
      status: 500,
      message: 'request failed (500)',
    });
  });

  it('sends raw bytes for uploads with an image content-type', async () => {
    const fn = stubFetch(201, { id: 'v1', status: 'pending' });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await api.baselines.uploadVersion('b1', 'vp1', bytes);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/baselines/b1/targets/vp1/versions');
    expect(init.body).toBe(bytes);
    expect(init.headers).toEqual({ 'content-type': 'image/png' });
  });

  it('returns undefined for 204 deletes and uses the DELETE method', async () => {
    const fn = stubFetch(204, null);
    await expect(api.projects.delete('p1')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledWith('/api/projects/p1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('builds image and SSE urls', () => {
    expect(imageUrl('captures/x.png')).toBe('/api/images/captures/x.png');
    expect(runEventsUrl('r1')).toBe('/api/runs/r1/events');
  });
});
