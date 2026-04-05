import type { TagRow } from '../types';

export interface TagCloudProps {
  tags: TagRow[];
  onSelect: (name: string) => void;
  selected?: string | null;
}

/**
 * Clickable tag list with visual weight from optional counts (tag cloud style).
 */
export function TagCloud({ tags, onSelect, selected }: TagCloudProps) {
  if (tags.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-zinc-700 dark:text-zinc-500">
        No tags yet.
      </p>
    );
  }

  const max = Math.max(1, ...tags.map((t) => t.count ?? 1));

  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const c = tag.count ?? 0;
        const weight = c <= 0 ? 1 : Math.min(1.25, 0.85 + (c / max) * 0.4);
        const isSel = selected === tag.name;
        return (
          <li key={tag.id}>
            <button
              type="button"
              onClick={() => onSelect(tag.name)}
              className={`rounded-full border px-3 py-1.5 font-medium transition ${
                isSel
                  ? 'border-indigo-500 bg-indigo-500 text-white shadow-md dark:border-indigo-400 dark:bg-indigo-600'
                  : 'border-slate-200 bg-slate-100 text-slate-800 hover:border-indigo-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-indigo-500'
              }`}
              style={{ fontSize: `${weight}rem` }}
            >
              {tag.name}
              {c > 0 && <span className="ml-1.5 text-xs opacity-80">({c})</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
