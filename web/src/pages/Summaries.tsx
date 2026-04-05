import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FilterBar } from '../components/FilterBar';
import { SearchBox } from '../components/SearchBox';
import { SummaryCard } from '../components/SummaryCard';
import { useGet, useSearch } from '../hooks/useApi';
import type { Platform, StoredSummary, TagRow } from '../types';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function Summaries() {
  const navigate = useNavigate();
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [dateFrom, setDateFrom] = useState(() => toYmd(new Date(Date.now() - 30 * 864e5)));
  const [dateTo, setDateTo] = useState(() => toYmd(new Date()));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: tagRows } = useGet<TagRow[]>('/api/tags');
  const tagOptions = useMemo(() => (tagRows ?? []).map((t) => t.name).sort(), [tagRows]);

  const listUrl = useMemo(() => {
    if (searchActive && searchQuery.trim()) return null;
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform);
    if (dateFrom) params.set('dateFrom', `${dateFrom}T00:00:00.000`);
    if (dateTo) params.set('dateTo', `${dateTo}T23:59:59.999`);
    if (selectedTags.length) params.set('tags', selectedTags.join(','));
    const q = params.toString();
    return `/api/summaries${q ? `?${q}` : ''}`;
  }, [platform, dateFrom, dateTo, selectedTags, searchActive, searchQuery]);

  const { data: listData, loading: listLoading, error: listError } = useGet<StoredSummary[]>(listUrl);

  const { results: searchResults, loading: searchLoading, error: searchError, search } = useSearch<StoredSummary[]>({
    tags: selectedTags.length ? selectedTags : undefined,
    limit: 80,
  });

  const displayList: StoredSummary[] | null = searchActive && searchQuery.trim() ? searchResults : listData;
  const loading = searchActive && searchQuery.trim() ? searchLoading : listLoading;
  const error = searchActive && searchQuery.trim() ? searchError : listError;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">Summaries</h1>
        <p className="mt-1 text-slate-600 dark:text-zinc-400">Browse and search generated chat digests</p>
      </header>

      <SearchBox
        onSearch={(q) => {
          setSearchQuery(q);
          setSearchActive(true);
          search(q);
        }}
      />
      {searchActive && (
        <button
          type="button"
          onClick={() => {
            setSearchActive(false);
            setSearchQuery('');
          }}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          Clear search, show filtered list
        </button>
      )}

      <FilterBar
        platform={platform}
        onPlatformChange={setPlatform}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        tagOptions={tagOptions}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
      />

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && <p className="text-slate-500 dark:text-zinc-500">Loading…</p>}

      {!loading && displayList && displayList.length === 0 && (
        <p className="text-slate-500 dark:text-zinc-500">No summaries match your filters.</p>
      )}

      {displayList && displayList.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {displayList.map((s) => (
            <li key={s.id}>
              <SummaryCard summary={s} onClick={() => navigate(`/summaries/${s.id}`)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
