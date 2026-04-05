import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SummaryCard } from '../components/SummaryCard';
import { TagCloud } from '../components/TagCloud';
import { useGet } from '../hooks/useApi';
import type { StoredSummary, TagRow } from '../types';

export function TagView() {
  const { tagName } = useParams<{ tagName: string }>();
  const navigate = useNavigate();
  const decoded = tagName ? decodeURIComponent(tagName) : null;

  const { data: tags, loading: tagsLoading } = useGet<TagRow[]>('/api/tags');

  const summariesUrl = decoded
    ? `/api/tags/${encodeURIComponent(decoded)}/summaries`
    : null;
  const { data: summaries, loading: sumLoading, error } = useGet<StoredSummary[]>(summariesUrl);

  const sortedTags = useMemo(() => {
    if (!tags) return [];
    return [...tags].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
  }, [tags]);

  const selectTag = (name: string) => {
    navigate(`/tags/${encodeURIComponent(name)}`);
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">Tags</h1>
        <p className="mt-1 text-slate-600 dark:text-zinc-400">
          Explore tags across summaries{decoded ? ` · “${decoded}”` : ''}
        </p>
      </header>

      {tagsLoading && <p className="text-slate-500 dark:text-zinc-500">Loading tags…</p>}
      {!tagsLoading && sortedTags.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-500">
            All tags
          </h2>
          <TagCloud tags={sortedTags} onSelect={selectTag} selected={decoded} />
        </section>
      )}

      {decoded && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Summaries</h2>
            <button
              type="button"
              onClick={() => navigate('/tags')}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              Clear selection
            </button>
          </div>
          {error && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          {sumLoading && <p className="text-slate-500 dark:text-zinc-500">Loading summaries…</p>}
          {!sumLoading && summaries && summaries.length === 0 && (
            <p className="text-slate-500 dark:text-zinc-500">No summaries for this tag.</p>
          )}
          {summaries && summaries.length > 0 && (
            <ul className="grid gap-4 md:grid-cols-2">
              {summaries.map((s) => (
                <li key={s.id}>
                  <SummaryCard summary={s} onClick={() => navigate(`/summaries/${s.id}`)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!decoded && !tagsLoading && sortedTags.length === 0 && (
        <p className="text-slate-500 dark:text-zinc-500">No tags in the database yet.</p>
      )}
    </div>
  );
}
