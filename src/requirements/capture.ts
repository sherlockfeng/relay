import { randomUUID } from 'node:crypto';
import type { AgentForgeDB, CaptureSession, Requirement } from '../storage/database.js';

const CLARIFYING_QUESTIONS = [
  { key: 'purpose', question: '这个需求的核心目的是什么？它解决了什么用户问题或业务问题？' },
  { key: 'background', question: '有没有相关的背景文档、PRD、设计稿或参考链接？如有请列出。' },
  { key: 'changes', question: '这次做了哪些主要改动？（可以列举关键 commit、模块、或功能点）' },
  { key: 'outcome', question: '最终达成了什么结果？和最初目标相比，有没有偏差或调整？' },
  { key: 'tags', question: '这个需求属于哪个方向？（如：性能优化、新功能、体验改进、架构重构 等）' },
];

export function startCapture(db: AgentForgeDB, chatContext: string, name: string): {
  sessionId: string;
  questions: Array<{ key: string; question: string }>;
} {
  const now = new Date().toISOString();
  const session: CaptureSession = {
    id: randomUUID(),
    phase: 'questioning',
    answers: { _context: chatContext, _name: name },
    createdAt: now,
    updatedAt: now,
  };
  db.insertCaptureSession(session);
  return { sessionId: session.id, questions: CLARIFYING_QUESTIONS };
}

export function submitAnswers(db: AgentForgeDB, sessionId: string, answers: Record<string, string>): {
  phase: 'confirming';
  draft: Partial<Requirement>;
} {
  const session = db.getCaptureSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const merged = { ...session.answers, ...answers };
  const draft = buildDraft(merged);

  db.updateCaptureSession(sessionId, {
    phase: 'confirming',
    answers: merged,
    draft,
  });

  return { phase: 'confirming', draft };
}

export function confirmCapture(
  db: AgentForgeDB,
  sessionId: string,
  edits?: Partial<Pick<Requirement, 'name' | 'purpose' | 'summary' | 'relatedDocs' | 'changes' | 'tags'>>,
): Requirement {
  const session = db.getCaptureSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (!session.draft) throw new Error('No draft to confirm. Call submit_answers first.');

  const now = new Date().toISOString();
  const base = session.draft;
  const req: Requirement = {
    id: randomUUID(),
    name: edits?.name ?? base.name ?? session.answers._name ?? 'Untitled',
    purpose: edits?.purpose ?? base.purpose,
    context: session.answers._context ?? '',
    summary: edits?.summary ?? base.summary,
    relatedDocs: edits?.relatedDocs ?? base.relatedDocs ?? [],
    changes: edits?.changes ?? base.changes ?? [],
    tags: edits?.tags ?? base.tags ?? [],
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  };

  db.insertRequirement(req);
  db.updateCaptureSession(sessionId, { phase: 'done', requirementId: req.id });

  return req;
}

function buildDraft(answers: Record<string, string>): Partial<Requirement> {
  const tags = answers.tags
    ? answers.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
    : [];

  const changes = answers.changes
    ? answers.changes.split(/\n|；|;/).map((c) => c.trim()).filter(Boolean)
    : [];

  const relatedDocs = answers.background
    ? answers.background.split(/\n|，|,/).map((d) => d.trim()).filter(Boolean)
    : [];

  const summary = [
    answers.purpose ? `**目的**：${answers.purpose}` : '',
    answers.changes ? `**改动**：${answers.changes}` : '',
    answers.outcome ? `**结果**：${answers.outcome}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    name: answers._name,
    purpose: answers.purpose,
    summary,
    relatedDocs,
    changes,
    tags,
  };
}
