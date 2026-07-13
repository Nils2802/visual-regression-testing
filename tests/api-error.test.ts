import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api-error';

describe('ApiError', () => {
  it('carries status and message and is an Error', () => {
    const e = new ApiError(409, 'only pending versions can be approved');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(409);
    expect(e.message).toBe('only pending versions can be approved');
  });
});
