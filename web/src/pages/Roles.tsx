import { useGet } from '../hooks/useApi';

interface Role {
  id: string;
  name: string;
  systemPrompt: string;
  docPath?: string;
  isBuiltin: boolean;
  createdAt: string;
}

export function Roles() {
  const { data: roles, loading } = useGet<Role[]>('/api/roles');

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-slate-400 dark:text-zinc-500">加载中…</p>
    </div>
  );

  const custom = (roles ?? []).filter((r) => !r.isBuiltin);
  const builtin = (roles ?? []).filter((r) => r.isBuiltin);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-800 dark:text-zinc-100">专家库</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
          通过 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">relay train</code> 训练的领域专家，可在 MCP 中被 Claude 调用。
        </p>
      </div>

      {custom.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">
            自定义专家
          </h2>
          <div className="flex flex-col gap-3">
            {custom.map((r) => (
              <RoleCard key={r.id} role={r} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-500">
          内置 Agent
        </h2>
        <div className="flex flex-col gap-3">
          {builtin.map((r) => (
            <RoleCard key={r.id} role={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RoleCard({ role }: { role: Role }) {
  const [expanded, setExpanded] = useState(false);

  // First line of system prompt as description
  const firstLine = role.systemPrompt.split('\n').find((l) => l.trim()) ?? '';

  return (
    <div className={`rounded-xl border p-5 transition ${
      role.isBuiltin
        ? 'border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/50'
        : 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-950/30'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
          role.isBuiltin
            ? 'bg-slate-100 dark:bg-zinc-800'
            : 'bg-indigo-100 dark:bg-indigo-900/50'
        }`}>
          {role.isBuiltin ? '🤖' : '🧠'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-zinc-100">{role.name}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
              {role.id}
            </span>
            {!role.isBuiltin && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300">
                自定义
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-zinc-400">{firstLine}</p>
          {role.docPath && (
            <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">
              文档：<code className="font-mono">{role.docPath}</code>
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {expanded ? '收起' : '查看 Prompt'}
        </button>
      </div>

      {expanded && (
        <pre className="mt-4 max-h-72 overflow-y-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:bg-black/40 whitespace-pre-wrap break-words">
          {role.systemPrompt}
        </pre>
      )}
    </div>
  );
}

// useState needs to be imported
import { useState } from 'react';
