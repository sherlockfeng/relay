import { useEffect, useMemo } from 'react';

import { ActiveSession } from '../components/ActiveSession';
import { useGet } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { localDayIsoRange } from '../lib/format';
import type { StoredSummary, TrackedSession } from '../types';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/80">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}

export function Monitor() {
  const { sessions: wsSessions, connected, reconnecting, error, lastEvent } = useWebSocket();
  const { dateFrom, dateTo } = localDayIsoRange();
  const todayUrl = `/api/summaries?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
  const { data: todaySummaries, refetch: refetchToday } = useGet<StoredSummary[]>(todayUrl);

  useEffect(() => {
    if (lastEvent) refetchToday();
  }, [lastEvent, refetchToday]);

  const sessions = useMemo(() => {
    const byId = new Map<string, TrackedSession>();
    for (const s of wsSessions) byId.set(s.id, s);
    return [...byId.values()].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.messageCount - a.messageCount,
    );
  }, [wsSessions]);

  const activeCount = sessions.filter((s) => s.status === 'active').length;
  const idleCount = sessions.filter((s) => s.status === 'idle').length;
  const todayCount = todaySummaries?.length ?? 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">Monitor</h1>
        <p className="mt-1 text-slate-600 dark:text-zinc-400">Live sessions from the digest daemon</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
              connected
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : reconnecting
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
                  : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-current opacity-80" />
            {connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Offline'}
          </span>
          {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active" value={activeCount} />
        <Stat label="Idle" value={idleCount} />
        <Stat label="Summaries today" value={todayCount} />
      </section>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-zinc-700 dark:text-zinc-500">
          No tracked sessions. Start a chat in Cursor, Claude Code, or Codex to see live cards here.
        </p>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => (
            <ActiveSession key={s.id} session={s} />
          ))}
        </section>
      )}
    </div>
  );
}
