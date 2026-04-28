import { useState } from 'react';
import { useGet } from '../hooks/useApi';

interface Role {
  id: string;
  name: string;
  systemPrompt: string;
  docPath?: string;
  isBuiltin: boolean;
  createdAt: string;
}

interface ChunksResponse {
  total: number;
  sources: Record<string, { id: string; chunkText: string }[]>;
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
          <div className="flex flex-col gap-4">
            {custom.map((r) => <RoleCard key={r.id} role={r} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-zinc-500">
          内置 Agent
        </h2>
        <div className="flex flex-col gap-3">
          {builtin.map((r) => <RoleCard key={r.id} role={r} />)}
        </div>
      </section>
    </div>
  );
}

function RoleCard({ role }: { role: Role }) {
  const [tab, setTab] = useState<'prompt' | 'knowledge' | null>(null);
  const { data: chunks, loading: chunksLoading } = useGet<ChunksResponse>(
    tab === 'knowledge' ? `/api/roles/${role.id}/chunks` : null
  );

  const firstLine = role.systemPrompt.split('\n').find((l) => l.trim()) ?? '';

  return (
    <div className={`rounded-xl border transition ${
      role.isBuiltin
        ? 'border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/50'
        : 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-950/30'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 p-5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${
          role.isBuiltin ? 'bg-slate-100 dark:bg-zinc-800' : 'bg-indigo-100 dark:bg-indigo-900/50'
        }`}>
          {role.isBuiltin ? '🤖' : '🧠'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex shrink-0 gap-1">
          <TabBtn active={tab === 'prompt'} onClick={() => setTab(tab === 'prompt' ? null : 'prompt')}>
            System Prompt
          </TabBtn>
          {!role.isBuiltin && (
            <TabBtn active={tab === 'knowledge'} onClick={() => setTab(tab === 'knowledge' ? null : 'knowledge')}>
              知识库
            </TabBtn>
          )}
        </div>
      </div>

      {/* System Prompt panel */}
      {tab === 'prompt' && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4 dark:border-zinc-800">
          <pre className="max-h-72 overflow-y-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:bg-black/40 whitespace-pre-wrap break-words">
            {role.systemPrompt}
          </pre>
        </div>
      )}

      {/* Knowledge chunks panel */}
      {tab === 'knowledge' && (
        <div className="border-t border-indigo-100 px-5 pb-5 pt-4 dark:border-indigo-900/30">
          {chunksLoading ? (
            <p className="text-sm text-slate-400 dark:text-zinc-500">加载知识片段…</p>
          ) : chunks ? (
            <KnowledgePanel chunks={chunks} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

function KnowledgePanel({ chunks }: { chunks: ChunksResponse }) {
  const [openFile, setOpenFile] = useState<string | null>(null);

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500 dark:text-zinc-400">
        共 <strong>{chunks.total}</strong> 个知识片段，来自 <strong>{Object.keys(chunks.sources).length}</strong> 个文件
      </p>
      <div className="flex flex-col gap-2">
        {Object.entries(chunks.sources).map(([file, fileChunks]) => (
          <div key={file} className="rounded-lg border border-slate-200 dark:border-zinc-700">
            <button
              className="flex w-full items-center justify-between px-4 py-2.5 text-left"
              onClick={() => setOpenFile(openFile === file ? null : file)}
            >
              <span className="font-mono text-xs font-medium text-slate-700 dark:text-zinc-300">{file}</span>
              <span className="ml-2 shrink-0 text-xs text-slate-400 dark:text-zinc-500">
                {fileChunks.length} 片段 · {Math.round(fileChunks.reduce((s, c) => s + c.chunkText.length, 0) / 100) / 10}k 字符
                <span className="ml-2">{openFile === file ? '▲' : '▼'}</span>
              </span>
            </button>
            {openFile === file && (
              <div className="flex flex-col gap-2 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-zinc-700">
                {fileChunks.map((c, i) => (
                  <div key={c.id} className="rounded bg-slate-50 p-3 dark:bg-zinc-800/60">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                      片段 {i + 1}
                    </p>
                    <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 dark:text-zinc-300">
                      {c.chunkText}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
