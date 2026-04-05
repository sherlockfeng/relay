import type { Platform, TrackedSession } from '../types';
import { formatDuration, projectLabel } from '../lib/format';

const PLATFORM_META: Record<
  Platform,
  { emoji: string; label: string; ring: string; text: string }
> = {
  cursor: {
    emoji: '🖥️',
    label: 'Cursor',
    ring: 'ring-violet-500/40',
    text: 'text-violet-600 dark:text-violet-400',
  },
  'claude-code': {
    emoji: '🤖',
    label: 'Claude',
    ring: 'ring-orange-500/40',
    text: 'text-orange-600 dark:text-orange-400',
  },
  codex: {
    emoji: '📦',
    label: 'Codex',
    ring: 'ring-emerald-500/40',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
};

function statusDotClass(status: TrackedSession['status']): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-500 shadow-emerald-500/50';
    case 'idle':
      return 'bg-amber-500 shadow-amber-500/50';
    case 'completed':
    default:
      return 'bg-zinc-400 dark:bg-zinc-500';
  }
}

export interface ActiveSessionProps {
  session: TrackedSession;
}

export function ActiveSession({ session }: ActiveSessionProps) {
  const meta = PLATFORM_META[session.platform];
  const preview = session.firstMessage?.trim() || 'No preview yet';

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 dark:border-zinc-800 dark:bg-zinc-900/80 ${meta.ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            {meta.emoji}
          </span>
          <div>
            <p className={`text-xs font-medium uppercase tracking-wide ${meta.text}`}>{meta.label}</p>
            <h3 className="font-semibold text-slate-900 dark:text-zinc-100">{projectLabel(session.projectPath)}</h3>
          </div>
        </div>
        <span
          className={`mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px] ${statusDotClass(session.status)}`}
          title={session.status}
          aria-label={`Status: ${session.status}`}
        />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-600 dark:text-zinc-400">
        <div>
          <dt className="text-xs text-slate-500 dark:text-zinc-500">Messages</dt>
          <dd className="font-medium text-slate-800 dark:text-zinc-200">{session.messageCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-zinc-500">Running</dt>
          <dd className="font-medium text-slate-800 dark:text-zinc-200">{formatDuration(session.startedAt)}</dd>
        </div>
      </dl>
      <p className="line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">{preview}</p>
    </article>
  );
}
