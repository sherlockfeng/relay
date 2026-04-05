import { useState } from 'react';

export interface SearchBoxProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  initialValue?: string;
}

export function SearchBox({ placeholder = 'Search summaries…', onSearch, initialValue = '' }: SearchBoxProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value);
      }}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        autoComplete="off"
      />
      <button
        type="submit"
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        Search
      </button>
    </form>
  );
}
