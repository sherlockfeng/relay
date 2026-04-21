import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useGet } from '../hooks/useApi';
import type { Requirement, RequirementTodo } from '../types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
}

export function RequirementDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: req, loading, refetch } = useGet<Requirement>(`/api/requirements/${id}`);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ updated: boolean; fields?: string[]; message?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-slate-400 dark:text-zinc-500">加载中…</p>
    </div>
  );
  if (!req) return <p className="text-red-500">需求不存在</p>;

  async function send() {
    if (!input.trim() || sending) return;
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(`/api/requirements/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content, history: messages }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      if (data.error) {
        setMessages((m) => [...m, { role: 'assistant', content: data.error!, isError: true }]);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: data.reply ?? '' }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: 'AI 服务暂时不可用，请稍后重试', isError: true }]);
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  async function applyToRequirement() {
    if (!messages.length || applying) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(`/api/requirements/${id}/apply-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: messages }),
      });
      const data = await res.json() as { updated: boolean; fields?: string[]; message?: string; error?: string };
      if (data.error) {
        setApplyResult({ updated: false, message: data.error });
      } else {
        setApplyResult({ updated: data.updated, fields: data.fields, message: data.message });
        if (data.updated) refetch();
      }
    } catch (err) {
      setApplyResult({ updated: false, message: 'AI 服务暂时不可用' });
      console.error(err);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-zinc-800">
        <Link to="/requirements" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← 需求库
        </Link>
        <span className="text-slate-300 dark:text-zinc-700">/</span>
        <h1 className="flex-1 truncate text-lg font-bold text-slate-800 dark:text-zinc-100">{req.name}</h1>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          req.status === 'confirmed'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
        }`}>
          {req.status === 'confirmed' ? '已确认' : '草稿'}
        </span>
        <button
          onClick={() => setChatOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          <span>💬</span> 对话
        </button>
      </div>

      {/* ── Body: main content + meta sidebar ──────────────────────── */}
      <div className="flex flex-1 gap-8 overflow-auto">

        {/* Main content — takes 65% */}
        <div className="min-w-0 flex-[2]">
          {req.purpose && (
            <ContentSection title="目的">
              <Prose>{req.purpose}</Prose>
            </ContentSection>
          )}

          {req.summary && (
            <ContentSection title="摘要">
              <Prose>{req.summary}</Prose>
            </ContentSection>
          )}

          {req.changes && req.changes.length > 0 && (
            <ContentSection title="主要改动">
              <div className="flex flex-col gap-3">
                {req.changes.map((c, i) => (
                  <div key={i} className="border-l-2 border-indigo-200 pl-4 dark:border-indigo-800">
                    <Prose>{c}</Prose>
                  </div>
                ))}
              </div>
            </ContentSection>
          )}
        </div>

        {/* Meta sidebar — takes 35%, sticky */}
        <aside className="w-72 shrink-0">
          <div className="sticky top-0 flex flex-col gap-4">
            {req.tags && req.tags.length > 0 && (
              <MetaSection title="标签">
                <div className="flex flex-wrap gap-1.5">
                  {req.tags.map((t) => (
                    <span key={t} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {t}
                    </span>
                  ))}
                </div>
              </MetaSection>
            )}

            <MetaSection title="待办">
              <TodoList requirementId={req.id} todos={req.todos ?? []} onUpdate={refetch} />
            </MetaSection>

            {req.relatedDocs && req.relatedDocs.length > 0 && (
              <MetaSection title="相关文档">
                <ul className="flex flex-col gap-2">
                  {req.relatedDocs.map((d, i) => {
                    const urlMatch = d.match(/https?:\/\/\S+/);
                    const url = urlMatch?.[0];
                    const label = url ? d.replace(url, '').trim() || url : d;
                    return (
                      <li key={i} className="text-sm">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="break-all text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400">
                            {label}
                          </a>
                        ) : (
                          <span className="text-slate-600 dark:text-zinc-300">{d}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </MetaSection>
            )}

            <MetaSection title="时间">
              <dl className="space-y-1 text-xs text-slate-500 dark:text-zinc-400">
                <div className="flex justify-between">
                  <dt>创建</dt>
                  <dd>{req.createdAt.slice(0, 10)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>更新</dt>
                  <dd>{req.updatedAt.slice(0, 10)}</dd>
                </div>
              </dl>
            </MetaSection>
          </div>
        </aside>
      </div>

      {/* ── Chat slide-over ─────────────────────────────────────────── */}
      {/* Backdrop */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 dark:bg-black/40"
          onClick={() => setChatOpen(false)}
        />
      )}

      {/* Drawer */}
      <div className={`fixed inset-y-0 right-0 z-40 flex w-[480px] max-w-[90vw] flex-col bg-white shadow-2xl transition-transform duration-300 dark:bg-zinc-900 ${
        chatOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-zinc-800">
          <div>
            <p className="font-medium text-slate-800 dark:text-zinc-100">与需求对话</p>
            <p className="text-xs text-slate-400 dark:text-zinc-500">{req.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={applyToRequirement}
                disabled={applying}
                className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
              >
                {applying ? <><span className="animate-spin inline-block">⟳</span> 分析中…</> : <>✦ 更新需求</>}
              </button>
            )}
            <button
              onClick={() => setChatOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Apply result */}
        {applyResult && (
          <div className={`mx-4 mt-3 rounded-lg px-4 py-3 text-sm ${
            applyResult.updated
              ? 'border border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300'
              : 'border border-slate-200 bg-slate-50 text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
          }`}>
            {applyResult.updated
              ? <span>✓ 已更新需求 — <strong>{applyResult.fields?.join('、')}</strong></span>
              : <span>{applyResult.message ?? '对话中没有发现需要更新的新信息'}</span>
            }
            <button onClick={() => setApplyResult(null)} className="ml-2 opacity-50 hover:opacity-100">×</button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="text-3xl">💬</div>
              <p className="max-w-[260px] text-center text-sm text-slate-400 dark:text-zinc-500">
                可以问这个需求的详细信息、背景原因、相关改动等
              </p>
              <div className="mt-2 flex flex-col gap-2 w-full max-w-xs">
                {['这个需求的核心目标是什么？', 'TLB 接入判断的逻辑是什么？', '这个需求还有哪些待解决的问题？'].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'user' ? (
                  <div className="max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-3 text-sm text-white">
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : m.isError ? (
                  <div className="max-w-[85%] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                    <p className="font-medium">⚠ 出错了</p>
                    <p className="mt-1 text-xs opacity-80">{m.content}</p>
                  </div>
                ) : (
                  <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-800 dark:bg-zinc-800 dark:text-zinc-100">
                    <Prose>{m.content}</Prose>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
                  思考中…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 p-4 dark:border-zinc-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="问一个关于这个需求的问题…"
              disabled={sending}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ContentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function TodoList({ requirementId, todos, onUpdate }: {
  requirementId: string;
  todos: RequirementTodo[];
  onUpdate: () => void;
}) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);

  async function addTodo() {
    if (!text.trim() || adding) return;
    setAdding(true);
    try {
      await fetch(`/api/requirements/${requirementId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      setText('');
      onUpdate();
    } finally {
      setAdding(false);
    }
  }

  async function toggle(todoId: string, done: boolean) {
    await fetch(`/api/requirements/${requirementId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    onUpdate();
  }

  async function remove(todoId: string) {
    await fetch(`/api/requirements/${requirementId}/todos/${todoId}`, { method: 'DELETE' });
    onUpdate();
  }

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex flex-col gap-2">
      {pending.map((t) => (
        <div key={t.id} className="group flex items-start gap-2">
          <input type="checkbox" checked={false} onChange={() => toggle(t.id, true)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-indigo-600" />
          <span className="flex-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">{t.text}</span>
          <button onClick={() => remove(t.id)}
            className="hidden text-slate-300 hover:text-red-400 group-hover:block dark:text-zinc-600">×</button>
        </div>
      ))}
      {done.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-400 dark:text-zinc-500">已完成 ({done.length})</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {done.map((t) => (
              <div key={t.id} className="group flex items-start gap-2">
                <input type="checkbox" checked={true} onChange={() => toggle(t.id, false)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-indigo-600" />
                <span className="flex-1 text-sm leading-relaxed text-slate-400 line-through dark:text-zinc-500">{t.text}</span>
                <button onClick={() => remove(t.id)}
                  className="hidden text-slate-300 hover:text-red-400 group-hover:block dark:text-zinc-600">×</button>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="flex gap-1.5 pt-1">
        <input type="text" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          placeholder="记录待办…" disabled={adding}
          className="flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
        <button onClick={addTodo} disabled={!text.trim() || adding}
          className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-40">+</button>
      </div>
    </div>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-slate-800 dark:text-zinc-100">{children}</strong>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
