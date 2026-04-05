import { excerpt } from '../lib/format';
import type { StoredSummary } from '../types';
import { TagPill } from './TagPill';

export interface SummaryCardProps {
  summary: StoredSummary;
  onClick?: () => void;
}

export function SummaryCard({ summary, onClick }: SummaryCardProps) {
  const date = new Date(summary.createdAt);
  const dateStr = Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : summary.createdAt;

  const body = excerpt(summary.rawSummary || summary.title, 200);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/80 dark:hover:border-indigo-600"
    >
      <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">{summary.title}</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">{dateStr}</p>
      {summary.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summary.tags.map((t) => (
            <TagPill key={t} name={t} />
          ))}
        </div>
      )}
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">{body}</p>
    </button>
  );
}
