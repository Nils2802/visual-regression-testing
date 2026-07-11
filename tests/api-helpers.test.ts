import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonError, readJson } from '@/lib/api';

describe('jsonError', () => {
  it('builds an error envelope with status', async () => {
    const res = jsonError(404, 'project not found');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'project not found' });
  });
});

describe('readJson', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns parsed data for a valid body', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'demo' }),
    });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.name).toBe('demo');
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new Request('http://test.local', { method: 'POST', body: 'not json' });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.res.status).toBe(400);
      expect((await out.res.json()).error).toContain('invalid JSON');
    }
  });

  it('returns 400 with field detail for schema violations', async () => {
    const req = new Request('http://test.local', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    });
    const out = await readJson(req, schema);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.res.status).toBe(400);
      expect((await out.res.json()).error).toContain('name');
    }
  });
});
