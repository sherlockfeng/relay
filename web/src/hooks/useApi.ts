import { useCallback, useEffect, useMemo, useState } from 'react';

export interface UseGetState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * GET JSON from `/api` (proxied in dev). Pass `null` to skip the request.
 */
export function useGet<T>(url: string | null): UseGetState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<T>;
      })
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Request failed');
        setData(null);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [url, tick]);

  return { data, loading, error, refetch };
}

export interface UseSearchOptions {
  /** Extra query params, e.g. tags=a,b */
  tags?: string[];
  limit?: number;
}

export interface UseSearchState<T> {
  results: T | null;
  loading: boolean;
  error: string | null;
  search: (query: string) => void;
}

/**
 * Wrapper around `GET /api/search?q=…` with optional tag filters.
 */
export function useSearch<T = unknown>(options?: UseSearchOptions): UseSearchState<T> {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);

  const url = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const params = new URLSearchParams({ q });
    if (options?.tags?.length) params.set('tags', options.tags.join(','));
    if (options?.limit != null) params.set('limit', String(options.limit));
    params.set('_r', String(tick));
    return `/api/search?${params.toString()}`;
  }, [query, options?.tags, options?.limit, tick]);

  const { data, loading, error } = useGet<T>(url);

  const search = useCallback((next: string) => {
    setQuery(next);
    setTick((t) => t + 1);
  }, []);

  return {
    results: data,
    loading: Boolean(query.trim()) && loading,
    error,
    search,
  };
}
