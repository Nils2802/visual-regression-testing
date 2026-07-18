// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLoad } from '@/lib/use-load';
import { ApiClientError } from '@/lib/client';

describe('useLoad', () => {
  it('loads data on mount and clears error on success', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.resolve('hello')));
    await waitFor(() => expect(result.current.data).toBe('hello'));
    expect(result.current.error).toBeNull();
  });

  it('surfaces ApiClientError message on load failure, generic copy otherwise', async () => {
    const { result } = renderHook(() =>
      useLoad(() => Promise.reject(new ApiClientError(500, 'boom')))
    );
    await waitFor(() => expect(result.current.error).toBe('boom'));

    const { result: generic } = renderHook(() =>
      useLoad(() => Promise.reject(new Error('raw')))
    );
    await waitFor(() => expect(generic.current.error).toBe('failed to load'));
  });

  it('discards stale responses: only the latest reload call wins', async () => {
    let resolveFirst!: (v: string) => void;
    const responses: Array<Promise<string>> = [
      new Promise<string>((res) => { resolveFirst = res; }),
      Promise.resolve('second'),
    ];
    let call = 0;
    const fetcher = () => responses[call++];
    const { result } = renderHook(() => useLoad(fetcher));
    act(() => result.current.reload()); // second call resolves immediately
    await waitFor(() => expect(result.current.data).toBe('second'));
    act(() => resolveFirst('first')); // first (stale) resolves late
    await waitFor(() => expect(result.current.data).toBe('second')); // still second
  });

  it('fail() sets mutation copy', async () => {
    const { result } = renderHook(() => useLoad(() => Promise.resolve('x')));
    await waitFor(() => expect(result.current.data).toBe('x'));
    act(() => result.current.fail(new Error('nope')));
    expect(result.current.error).toBe('something went wrong');
    act(() => result.current.fail(new ApiClientError(409, 'conflict')));
    expect(result.current.error).toBe('conflict');
  });
});
