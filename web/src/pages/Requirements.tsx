import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../hooks/useApi';
import type { Requirement } from '../types';

export function Requirements() {
  const [query, setQuery] = useState('');
  const { data, loading } = useGet<Requirement[]>(`/api/requirements${query ? `?q=${encodeURIComponent(query)}` : ''}`);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-zinc-100">需求库 Requirements</h1>

      <input
        type="search"
        placeholder="搜索需求名称、摘要..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 w-full max-w-md rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />

      {loading && <p className="text-slate-500 dark:text-zinc-400">加载中…</p>}

      {!loading && (!data || data.length === 0) && (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center dark:border-zinc-700">
          <p className="text-slate-500 dark:text-zinc-400">暂无需求。在 Cursor / Claude Code 中调用</p>
          <code className="mt-2 block text-sm text-indigo-600 dark:text-indigo-400">capture_requirement(action: "start", name: "...", chatContext: "...")</code>
          <p className="mt-1 text-slate-500 dark:text-zinc-400">来沉淀你的第一个需求。</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(data ?? []).map((req) => (
          <Link
            key={req.id}
            to={`/requirements/${req.id}`}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-slate-800 dark:text-zinc-100">{req.name}</h2>
                {req.purpose && (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-zinc-400">{req.purpose}</p>
                )}
                {req.tags && req.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {req.tags.map((t) => (
                      <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  req.status === 'confirmed'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                }`}>
                  {req.status === 'confirmed' ? '已确认' : '草稿'}
                </span>
                <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">{req.updatedAt.slice(0, 10)}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
