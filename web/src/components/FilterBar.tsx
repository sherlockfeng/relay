import type { Platform } from '../types';

const PLATFORMS: { value: Platform | ''; label: string }[] = [
  { value: '', label: 'All platforms' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'claude-code', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

export interface FilterBarProps {
  platform: Platform | '';
  onPlatformChange: (p: Platform | '') => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  tagOptions: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function FilterBar({
  platform,
  onPlatformChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  tagOptions,
  selectedTags,
  onTagsChange,
}: FilterBarProps) {
  const toggleTag = (name: string) => {
    if (selectedTags.includes(name)) {
      onTagsChange(selectedTags.filter((t) => t !== name));
    } else {
      onTagsChange([...selectedTags, name]);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-zinc-300">Platform</span>
          <select
            value={platform}
            onChange={(e) => onPlatformChange(e.target.value as Platform | '')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {PLATFORMS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-zinc-300">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700 dark:text-zinc-300">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
      </div>
      {tagOptions.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">Tags</p>
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {tagOptions.map((name) => {
              const on = selectedTags.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleTag(name)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    on
                      ? 'border-indigo-500 bg-indigo-500 text-white dark:border-indigo-400 dark:bg-indigo-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
