import { NavLink, Route, Routes } from 'react-router-dom';

import { Detail } from './pages/Detail';
import { Monitor } from './pages/Monitor';
import { Summaries } from './pages/Summaries';
import { TagView } from './pages/TagView';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-600 text-white shadow-sm dark:bg-indigo-500'
      : 'text-slate-600 hover:bg-slate-200/80 dark:text-zinc-400 dark:hover:bg-zinc-800'
  }`;

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-100/90 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-slate-200 px-4 py-5 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            AI Chat Digest
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-zinc-500">Local dashboard</p>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          <NavLink to="/" end className={navClass}>
            Monitor
          </NavLink>
          <NavLink to="/summaries" className={navClass}>
            Summaries
          </NavLink>
          <NavLink to="/tags" className={navClass}>
            Tags
          </NavLink>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6 md:p-10">
        <Routes>
          <Route path="/" element={<Monitor />} />
          <Route path="/summaries" element={<Summaries />} />
          <Route path="/summaries/:id" element={<Detail />} />
          <Route path="/tags" element={<TagView />} />
          <Route path="/tags/:tagName" element={<TagView />} />
        </Routes>
      </main>
    </div>
  );
}
