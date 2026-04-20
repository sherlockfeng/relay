import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useGet } from '../hooks/useApi';
import type { Requirement } from '../types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function RequirementDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: req, loading } = useGet<Requirement>(`/api/requirements/${id}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) return <p className="text-slate-500 dark:text-zinc-400">加载中…</p>;
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
      setMessages((m) => [...m, { role: 'assistant', content: data.reply ?? data.error ?? 'Error' }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `请求失败: ${String(err)}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-zinc-800">
        <Link to="/requirements" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← 需求库</Link>
        <span className="text-slate-300 dark:text-zinc-600">/</span>
        <h1 className="text-lg font-bold text-slate-800 dark:text-zinc-100">{req.name}</h1>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
          req.status === 'confirmed'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
        }`}>
          {req.status === 'confirmed' ? '已确认' : '草稿'}
        </span>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden pt-4">
        {/* Left: Requirement info */}
        <aside className="w-72 shrink-0 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {req.purpose && (
              <Section title="目的">
                <p className="text-sm text-slate-600 dark:text-zinc-300">{req.purpose}</p>
              </Section>
            )}
            {req.summary && (
              <Section title="摘要">
                <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-zinc-300">{req.summary}</p>
              </Section>
            )}
            {req.changes && req.changes.length > 0 && (
              <Section title="主要改动">
                <ul className="flex flex-col gap-1">
                  {req.changes.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-600 dark:text-zinc-300">
                      <span className="mt-0.5 text-indigo-400">•</span>{c}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {req.relatedDocs && req.relatedDocs.length > 0 && (
              <Section title="相关文档">
                <ul className="flex flex-col gap-1">
                  {req.relatedDocs.map((d, i) => (
                    <li key={i} className="text-sm text-indigo-600 dark:text-indigo-400">{d}</li>
                  ))}
                </ul>
              </Section>
            )}
            {req.tags && req.tags.length > 0 && (
              <Section title="标签">
                <div className="flex flex-wrap gap-1">
                  {req.tags.map((t) => (
                    <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {t}
                    </span>
                  ))}
                </div>
              </Section>
            )}
            <Section title="创建时间">
              <p className="text-xs text-slate-400 dark:text-zinc-500">{req.createdAt.slice(0, 16).replace('T', ' ')}</p>
            </Section>
          </div>
        </aside>

        {/* Right: Chat */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
            与此需求对话
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-sm text-slate-400 dark:text-zinc-500">
                  可以问这个需求的详细信息、背景原因、相关改动等
                </p>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
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

          <div className="border-t border-slate-100 p-3 dark:border-zinc-800">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="问一个关于这个需求的问题…"
                disabled={sending}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-zinc-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}
