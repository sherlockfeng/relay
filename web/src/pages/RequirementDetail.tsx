import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useGet } from '../hooks/useApi';
import type { Requirement } from '../types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
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
        <aside className="w-96 shrink-0 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {req.purpose && (
              <Section title="目的">
                <Prose>{req.purpose}</Prose>
              </Section>
            )}
            {req.summary && (
              <Section title="摘要">
                <Prose>{req.summary}</Prose>
              </Section>
            )}
            {req.changes && req.changes.length > 0 && (
              <Section title="主要改动">
                <ul className="flex flex-col gap-2">
                  {req.changes.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
                      <span className="mt-1 shrink-0 text-indigo-400">•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {req.relatedDocs && req.relatedDocs.length > 0 && (
              <Section title="相关文档">
                <ul className="flex flex-col gap-1.5">
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
                  {m.role === 'user' ? (
                    <div className="max-w-[80%] rounded-2xl bg-indigo-600 px-4 py-3 text-sm text-white">
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  ) : m.isError ? (
                    <div className="max-w-[80%] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                      <p className="font-medium">⚠ 出错了</p>
                      <p className="mt-1 text-xs opacity-80">{m.content}</p>
                    </div>
                  ) : (
                    <div className="max-w-[80%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-800 dark:bg-zinc-800 dark:text-zinc-100">
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
    <div className="rounded-lg border border-slate-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">{title}</h3>
      {children}
    </div>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p className="mb-2 text-sm leading-relaxed text-slate-700 last:mb-0 dark:text-zinc-300">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-800 dark:text-zinc-100">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 flex flex-col gap-1 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 flex flex-col gap-1 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="flex gap-2 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
            <span className="mt-1 shrink-0 text-indigo-400">•</span>
            <span>{children}</span>
          </li>
        ),
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
  );
}
