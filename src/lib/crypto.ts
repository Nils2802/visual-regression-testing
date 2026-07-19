import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from '@/lib/api-error';

// Secrets-at-rest encryption (AES-256-GCM). Key comes from VRT_ENCRYPTION_KEY
// (64 hex chars = 32 bytes). Payload format: v1:<iv>:<authTag>:<ciphertext>,
// all base64 — versioned so a future scheme can coexist with stored payloads.

function key(): Buffer {
  const hex = process.env.VRT_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new ApiError(500, 'VRT_ENCRYPTION_KEY missing or invalid');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new ApiError(500, 'stored secret has unknown format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, 'stored secret failed to decrypt');
  }
}
