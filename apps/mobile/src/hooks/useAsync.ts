import { useCallback, useEffect, useRef, useState } from 'react';

/** Minimal data loader: { data, error, loading, reload }. Optional polling for live screens. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const result = await fnRef.current();
      if (alive.current) {
        setData(result);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void reload();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!opts.pollMs) return;
    const id = setInterval(() => void reload(), opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, reload]);

  return { data, error, loading, reload, setData };
}
