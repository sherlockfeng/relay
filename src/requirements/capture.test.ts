import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startCapture, submitAnswers, confirmCapture } from './capture.js';
import type { AgentForgeDB, CaptureSession, Requirement } from '../storage/database.js';

// ── Mock DB factory ───────────────────────────────────────────────────────────

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: 'sess1',
    phase: 'questioning',
    answers: { _name: '登录重设计', _context: 'chat ctx' },
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function makeExistingReq(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: 'req-existing',
    name: '登录重设计',
    purpose: '提升转化率',
    context: '原始 chat',
    tags: ['体验优化'],
    changes: ['改了 A'],
    relatedDocs: ['doc.md'],
    status: 'confirmed',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function makeDB(overrides: Partial<AgentForgeDB> = {}): AgentForgeDB {
  return {
    insertCaptureSession: vi.fn(),
    updateCaptureSession: vi.fn(),
    getCaptureSession: vi.fn(),
    getRequirement: vi.fn(),
    insertRequirement: vi.fn(),
    updateRequirement: vi.fn(),
    ...overrides,
  } as unknown as AgentForgeDB;
}

// ── startCapture ──────────────────────────────────────────────────────────────

describe('startCapture — new requirement', () => {
  it('returns 5 clarifying questions', () => {
    const db = makeDB();
    const result = startCapture(db, 'chat ctx', '新需求');
    expect(result.questions).toHaveLength(5);
  });

  it('creates a capture session in the DB', () => {
    const db = makeDB();
    startCapture(db, 'chat ctx', '新需求');
    expect(db.insertCaptureSession).toHaveBeenCalledOnce();
  });

  it('marks isUpdate as false', () => {
    const db = makeDB();
    expect(startCapture(db, 'chat ctx', '新需求').isUpdate).toBe(false);
  });

  it('stores chatContext and name in session answers', () => {
    const db = makeDB();
    startCapture(db, 'my context', 'my name');
    const session = (db.insertCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as CaptureSession;
    expect(session.answers._context).toBe('my context');
    expect(session.answers._name).toBe('my name');
  });

  it('sets session phase to questioning', () => {
    const db = makeDB();
    startCapture(db, 'ctx', 'name');
    const session = (db.insertCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as CaptureSession;
    expect(session.phase).toBe('questioning');
  });
});

describe('startCapture — update mode', () => {
  let db: AgentForgeDB;
  beforeEach(() => {
    db = makeDB({ getRequirement: vi.fn().mockReturnValue(makeExistingReq()) });
  });

  it('returns only 4 delta questions', () => {
    const result = startCapture(db, 'new ctx', '', 'req-existing');
    expect(result.questions).toHaveLength(4);
  });

  it('marks isUpdate as true', () => {
    const result = startCapture(db, 'new ctx', '', 'req-existing');
    expect(result.isUpdate).toBe(true);
  });

  it('returns existing requirement info', () => {
    const result = startCapture(db, 'new ctx', '', 'req-existing');
    expect(result.existing?.name).toBe('登录重设计');
  });

  it('pre-fills purpose from existing requirement', () => {
    startCapture(db, 'new ctx', '', 'req-existing');
    const session = (db.insertCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as CaptureSession;
    expect(session.answers.purpose).toBe('提升转化率');
  });

  it('pre-fills tags from existing requirement', () => {
    startCapture(db, 'new ctx', '', 'req-existing');
    const session = (db.insertCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as CaptureSession;
    expect(session.answers.tags).toBe('体验优化');
  });

  it('links session to existing requirementId', () => {
    startCapture(db, 'new ctx', '', 'req-existing');
    const session = (db.insertCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as CaptureSession;
    expect(session.requirementId).toBe('req-existing');
  });
});

// ── submitAnswers ─────────────────────────────────────────────────────────────

describe('submitAnswers', () => {
  it('transitions session to confirming phase', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const result = submitAnswers(db, 'sess1', { purpose: '提升体验' });
    expect(result.phase).toBe('confirming');
    expect(db.updateCaptureSession).toHaveBeenCalledWith('sess1', expect.objectContaining({ phase: 'confirming' }));
  });

  it('throws if session not found', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(undefined) });
    expect(() => submitAnswers(db, 'missing', {})).toThrow('Session not found: missing');
  });

  it('builds draft with purpose', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { purpose: '核心目的' });
    expect(draft.purpose).toBe('核心目的');
  });

  it('splits tags by comma and Chinese comma', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { tags: '性能优化,体验改进，新功能' });
    expect(draft.tags).toEqual(['性能优化', '体验改进', '新功能']);
  });

  it('splits tags by 、 (Japanese comma)', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { tags: '性能、体验' });
    expect(draft.tags).toEqual(['性能', '体验']);
  });

  it('splits changes by newline', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { changes: '改了A\n改了B\n改了C' });
    expect(draft.changes).toEqual(['改了A', '改了B', '改了C']);
  });

  it('splits changes by semicolon', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { changes: '改了A;改了B' });
    expect(draft.changes).toEqual(['改了A', '改了B']);
  });

  it('splits relatedDocs from background field by newline', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', { background: 'doc1.md\ndoc2.md' });
    expect(draft.relatedDocs).toEqual(['doc1.md', 'doc2.md']);
  });

  it('builds markdown summary from purpose + changes + outcome', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession()) });
    const { draft } = submitAnswers(db, 'sess1', {
      purpose: '提升体验',
      changes: '改了登录组件',
      outcome: '转化率提升12%',
    });
    expect(draft.summary).toContain('**目的**：提升体验');
    expect(draft.summary).toContain('**改动**：改了登录组件');
    expect(draft.summary).toContain('**结果**：转化率提升12%');
  });

  it('merges new answers with existing session answers', () => {
    const session = makeSession({ answers: { _name: 'X', _context: 'ctx', purpose: '旧目的' } });
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(session) });
    submitAnswers(db, 'sess1', { purpose: '新目的', changes: '改了Y' });
    const call = (db.updateCaptureSession as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].answers.purpose).toBe('新目的');
    expect(call[1].answers._name).toBe('X');
  });
});

// ── confirmCapture — create ───────────────────────────────────────────────────

describe('confirmCapture — create new', () => {
  function makeConfirmDB(draft: Partial<Requirement> = {}) {
    const session = makeSession({
      phase: 'confirming',
      draft: { name: '登录重设计', purpose: '提升转化率', summary: '摘要', changes: ['改了A'], tags: ['UX'], relatedDocs: [], ...draft },
    });
    return makeDB({ getCaptureSession: vi.fn().mockReturnValue(session) });
  }

  it('inserts a new requirement', () => {
    const db = makeConfirmDB();
    confirmCapture(db, 'sess1');
    expect(db.insertRequirement).toHaveBeenCalledOnce();
  });

  it('returns confirmed status', () => {
    const db = makeConfirmDB();
    const req = confirmCapture(db, 'sess1');
    expect(req.status).toBe('confirmed');
  });

  it('applies edits over draft', () => {
    const db = makeConfirmDB();
    const req = confirmCapture(db, 'sess1', { purpose: '覆盖目的', tags: ['新标签'] });
    expect(req.purpose).toBe('覆盖目的');
    expect(req.tags).toEqual(['新标签']);
  });

  it('throws if session not found', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(undefined) });
    expect(() => confirmCapture(db, 'missing')).toThrow('Session not found');
  });

  it('throws if no draft in session', () => {
    const db = makeDB({ getCaptureSession: vi.fn().mockReturnValue(makeSession({ phase: 'questioning', draft: undefined })) });
    expect(() => confirmCapture(db, 'sess1')).toThrow('No draft to confirm');
  });
});

// ── confirmCapture — update ───────────────────────────────────────────────────

describe('confirmCapture — update existing', () => {
  function makeUpdateDB() {
    const existing = makeExistingReq({ changes: ['改了 A'], tags: ['体验优化'], relatedDocs: ['doc1.md'] });
    const session = makeSession({
      requirementId: 'req-existing',
      phase: 'confirming',
      draft: { changes: ['改了 B'], tags: ['新标签'], relatedDocs: ['doc2.md'], summary: '新摘要' },
    });
    return makeDB({
      getCaptureSession: vi.fn().mockReturnValue(session),
      getRequirement: vi.fn().mockReturnValue(existing),
      updateRequirement: vi.fn(),
    });
  }

  it('calls updateRequirement instead of insertRequirement', () => {
    const db = makeUpdateDB();
    confirmCapture(db, 'sess1');
    expect(db.updateRequirement).toHaveBeenCalledOnce();
    expect(db.insertRequirement).not.toHaveBeenCalled();
  });

  it('merges changes (union, no duplicates)', () => {
    const db = makeUpdateDB();
    confirmCapture(db, 'sess1');
    const patch = (db.updateRequirement as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.changes).toContain('改了 A');
    expect(patch.changes).toContain('改了 B');
  });

  it('merges tags (union)', () => {
    const db = makeUpdateDB();
    confirmCapture(db, 'sess1');
    const patch = (db.updateRequirement as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.tags).toContain('体验优化');
    expect(patch.tags).toContain('新标签');
  });

  it('appends new context to existing context', () => {
    const db = makeUpdateDB();
    confirmCapture(db, 'sess1');
    const patch = (db.updateRequirement as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.context).toContain('原始 chat');
    expect(patch.context).toContain('chat ctx');
  });

  it('deduplicates changes with similar prefix', () => {
    const existing = makeExistingReq({ changes: ['重写 LoginForm 组件，优化样式'] });
    const session = makeSession({
      requirementId: 'req-existing',
      phase: 'confirming',
      draft: { changes: ['重写 LoginForm 组件'] }, // same prefix as existing
    });
    const db = makeDB({
      getCaptureSession: vi.fn().mockReturnValue(session),
      getRequirement: vi.fn().mockReturnValue(existing),
      updateRequirement: vi.fn(),
    });
    confirmCapture(db, 'sess1');
    const patch = (db.updateRequirement as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // Should not double-add the similar change
    expect(patch.changes).toHaveLength(1);
  });

  it('throws if existing requirement not found', () => {
    const session = makeSession({ requirementId: 'gone', phase: 'confirming', draft: { name: 'X' } });
    const db = makeDB({
      getCaptureSession: vi.fn().mockReturnValue(session),
      getRequirement: vi.fn().mockReturnValue(undefined),
    });
    expect(() => confirmCapture(db, 'sess1')).toThrow('Requirement not found: gone');
  });
});
