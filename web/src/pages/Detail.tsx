import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { SummaryCard } from '../components/SummaryCard';
import { TagPill } from '../components/TagPill';
import { useGet } from '../hooks/useApi';
import type { StoredSummary } from '../types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/80">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{title}</h2>
      <div className="mt-3 text-slate-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-slate-500 dark:text-zinc-500">—</p>;
  return (
    <ul className="list-inside list-disc space-y-1 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 48)}`}>{item}</li>
      ))}
    </ul>
  );
}

export function Detail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const url = id ? `/api/summaries/${encodeURIComponent(id)}` : null;
  const { data: summary, loading, error, refetch } = useGet<StoredSummary>(url);

  const similarUrl = summary ? `/api/similar/${encodeURIComponent(summary.sessionId)}?limit=8` : null;
  const { data: similar } = useGet<StoredSummary[]>(similarUrl);

  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (summary) setTags([...summary.tags]);
  }, [summary]);

  const saveTags = useCallback(async () => {
    if (!summary) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/summaries/${encodeURIComponent(summary.id)}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refetch();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [summary, tags, refetch]);

  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagDraft('');
  };

  if (!id) {
    return <p className="text-slate-500 dark:text-zinc-500">Missing summary id.</p>;
  }

  if (loading) {
    return <p className="text-slate-500 dark:text-zinc-500">Loading summary…</p>;
  }

  if (error || !summary) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {error ?? 'Summary not found.'}
      </p>
    );
  }

  const dk = summary.domainKnowledge;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <article className="min-w-0 flex-1 space-y-6">
        <header>
          <Link
            to="/summaries"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            ← Back to summaries
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">{summary.title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-zinc-500">
            {new Date(summary.createdAt).toLocaleString()} · {summary.modelUsed}
          </p>
        </header>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">Tags</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((t) => (
              <TagPill key={t} name={t} onRemove={() => setTags(tags.filter((x) => x !== t))} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add tag"
              className="min-w-[8rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
            <button
              type="button"
              onClick={addTag}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium dark:border-zinc-600 dark:bg-zinc-900"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => void saveTags()}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-indigo-500"
            >
              {saving ? 'Saving…' : 'Save tags'}
            </button>
          </div>
        </div>

        {summary.topics.length > 0 && (
          <Section title="Topics">
            <div className="flex flex-wrap gap-2">
              {summary.topics.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section title="Discussion">
          <BulletList items={summary.discussionProcess} />
        </Section>

        <Section title="Problems discovered">
          <BulletList items={summary.problemsDiscovered} />
        </Section>

        <Section title="Decided solutions">
          <BulletList items={summary.decidedSolutions} />
        </Section>

        <Section title="Context & tools">
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-slate-800 dark:text-zinc-200">Internal tools</p>
              <BulletList items={summary.contextProvided.internalTools} />
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-zinc-200">Definitions</p>
              <BulletList items={summary.contextProvided.internalDefinitions} />
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-zinc-200">External resources</p>
              <BulletList items={summary.contextProvided.externalResources} />
            </div>
          </div>
        </Section>

        {(dk.projectOverview ||
          dk.targetUsers ||
          (dk.userFlows && dk.userFlows.length) ||
          (dk.techStack && dk.techStack.length) ||
          (dk.keyTerms && Object.keys(dk.keyTerms).length > 0)) && (
          <Section title="Domain knowledge">
            <div className="space-y-3 text-sm">
              {dk.projectOverview && (
                <p>
                  <span className="font-medium text-slate-800 dark:text-zinc-200">Overview: </span>
                  {dk.projectOverview}
                </p>
              )}
              {dk.targetUsers && (
                <p>
                  <span className="font-medium text-slate-800 dark:text-zinc-200">Users: </span>
                  {dk.targetUsers}
                </p>
              )}
              {dk.userFlows && dk.userFlows.length > 0 && (
                <div>
                  <p className="font-medium text-slate-800 dark:text-zinc-200">User flows</p>
                  <BulletList items={dk.userFlows} />
                </div>
              )}
              {dk.techStack && dk.techStack.length > 0 && (
                <div>
                  <p className="font-medium text-slate-800 dark:text-zinc-200">Tech stack</p>
                  <BulletList items={dk.techStack} />
                </div>
              )}
              {dk.keyTerms && Object.keys(dk.keyTerms).length > 0 && (
                <dl className="space-y-2">
                  {Object.entries(dk.keyTerms).map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-medium text-slate-800 dark:text-zinc-200">{k}</dt>
                      <dd className="text-slate-600 dark:text-zinc-400">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </Section>
        )}

        {summary.actionItems && summary.actionItems.length > 0 && (
          <Section title="Action items">
            <BulletList items={summary.actionItems} />
          </Section>
        )}

        <Section title="Raw digest">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-xs text-slate-800 dark:bg-zinc-950 dark:text-zinc-300">
            {summary.rawSummary}
          </pre>
        </Section>
      </article>

      <aside className="w-full shrink-0 space-y-4 lg:w-80">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-500">
          Similar chats
        </h2>
        {!similar || similar.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-zinc-500">No similar sessions found.</p>
        ) : (
          <ul className="space-y-3">
            {similar
              .filter((s) => s.id !== summary.id)
              .map((s) => (
                <li key={s.id}>
                  <SummaryCard summary={s} onClick={() => navigate(`/summaries/${s.id}`)} />
                </li>
              ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
