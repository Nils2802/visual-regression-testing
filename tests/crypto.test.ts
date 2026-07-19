import { beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { ApiError } from '@/lib/api-error';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  beforeEach(() => {
    process.env.VRT_ENCRYPTION_KEY = KEY;
  });

  it('round-trips a secret and never stores plaintext', () => {
    const payload = encryptSecret('figd_secret-token');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('figd_secret-token');
    expect(decryptSecret(payload)).toBe('figd_secret-token');
  });

  it('produces distinct ciphertexts per call (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('throws ApiError(500) on missing or malformed key', () => {
    delete process.env.VRT_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrowError(ApiError);
    process.env.VRT_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSecret('x')).toThrowError(ApiError);
  });

  it('throws ApiError(500) on tampered payload', () => {
    const payload = encryptSecret('x');
    const parts = payload.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrowError(ApiError);
  });
});
