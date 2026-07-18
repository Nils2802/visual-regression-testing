import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/client';

// Shared page-container load scaffold: data/error state, reload with a
// monotonic sequence guard (a stale in-flight response never overwrites a
// newer one), and a mutation-failure reporter for child callbacks.
export function useLoad<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    fetcher()
      .then((d) => {
        if (seq.current !== id) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (seq.current !== id) return;
        setError(e instanceof ApiClientError ? e.message : 'failed to load');
      });
  }, [fetcher]);

  useEffect(reload, [reload]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof ApiClientError ? e.message : 'something went wrong');
  }, []);

  return { data, error, reload, fail };
}
