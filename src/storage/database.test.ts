import { describe, it, expect, beforeEach } from 'vitest';
import { AgentForgeDB } from './database.js';

function makeDB() {
  const db = new AgentForgeDB(':memory:');
  db.init();
  return db;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

describe('campaigns', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('inserts and retrieves a campaign', () => {
    const c = { id: 'c1', projectPath: '/p', title: 'T', status: 'active' as const, startedAt: '2025-01-01' };
    db.insertCampaign(c);
    expect(db.getCampaign('c1')).toMatchObject({ id: 'c1', title: 'T', status: 'active' });
  });

  it('returns undefined for missing campaign', () => {
    expect(db.getCampaign('nope')).toBeUndefined();
  });

  it('lists campaigns ordered by startedAt desc', () => {
    db.insertCampaign({ id: 'a', projectPath: '/', title: 'A', status: 'active', startedAt: '2025-01-01' });
    db.insertCampaign({ id: 'b', projectPath: '/', title: 'B', status: 'active', startedAt: '2025-02-01' });
    const list = db.listCampaigns();
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  it('updates campaign status and summary', () => {
    db.insertCampaign({ id: 'c1', projectPath: '/', title: 'T', status: 'active', startedAt: '2025-01-01' });
    db.updateCampaign('c1', { status: 'completed', summary: 'done' });
    const c = db.getCampaign('c1')!;
    expect(c.status).toBe('completed');
    expect(c.summary).toBe('done');
  });
});

// ── Cycles ────────────────────────────────────────────────────────────────────

describe('cycles', () => {
  let db: AgentForgeDB;
  beforeEach(() => {
    db = makeDB();
    db.insertCampaign({ id: 'c1', projectPath: '/', title: 'T', status: 'active', startedAt: '2025-01-01' });
  });

  it('inserts and retrieves a cycle', () => {
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'product' });
    expect(db.getCycle('cy1')).toMatchObject({ id: 'cy1', cycleNum: 1, status: 'product' });
  });

  it('getActiveCycle returns latest non-completed cycle', () => {
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'completed' });
    db.insertCycle({ id: 'cy2', campaignId: 'c1', cycleNum: 2, status: 'dev' });
    expect(db.getActiveCycle('c1')?.id).toBe('cy2');
  });

  it('getActiveCycle returns undefined when all completed', () => {
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'completed' });
    expect(db.getActiveCycle('c1')).toBeUndefined();
  });

  it('updates cycle status and screenshots', () => {
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'product' });
    const shots = [{ filePath: '/s.png', description: '[PASS] ok', capturedAt: '2025-01-01' }];
    db.updateCycle('cy1', { status: 'test', screenshots: shots });
    const cy = db.getCycle('cy1')!;
    expect(cy.status).toBe('test');
    expect(cy.screenshots).toHaveLength(1);
    expect(cy.screenshots![0].filePath).toBe('/s.png');
  });

  it('persists and restores JSON fields correctly', () => {
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'product', screenshots: [] });
    expect(db.getCycle('cy1')!.screenshots).toEqual([]);
  });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

describe('tasks', () => {
  let db: AgentForgeDB;
  beforeEach(() => {
    db = makeDB();
    db.insertCampaign({ id: 'c1', projectPath: '/', title: 'T', status: 'active', startedAt: '2025-01-01' });
    db.insertCycle({ id: 'cy1', campaignId: 'c1', cycleNum: 1, status: 'dev' });
  });

  it('inserts and retrieves a task', () => {
    db.insertTask({ id: 't1', cycleId: 'cy1', role: 'dev', title: 'Do X', status: 'pending', createdAt: '2025-01-01' });
    expect(db.getTask('t1')).toMatchObject({ id: 't1', role: 'dev', title: 'Do X' });
  });

  it('listTasks filters by role', () => {
    db.insertTask({ id: 't1', cycleId: 'cy1', role: 'dev', title: 'Dev', status: 'pending', createdAt: '2025-01-01' });
    db.insertTask({ id: 't2', cycleId: 'cy1', role: 'test', title: 'Test', status: 'pending', createdAt: '2025-01-01' });
    expect(db.listTasks('cy1', 'dev')).toHaveLength(1);
    expect(db.listTasks('cy1', 'test')).toHaveLength(1);
    expect(db.listTasks('cy1')).toHaveLength(2);
  });

  it('updates task status and result', () => {
    db.insertTask({ id: 't1', cycleId: 'cy1', role: 'dev', title: 'X', status: 'pending', createdAt: '2025-01-01' });
    db.updateTask('t1', { status: 'completed', result: 'done' });
    expect(db.getTask('t1')).toMatchObject({ status: 'completed', result: 'done' });
  });

  it('persists and restores acceptance and comments arrays', () => {
    db.insertTask({
      id: 't1', cycleId: 'cy1', role: 'dev', title: 'X', status: 'pending',
      acceptance: ['criterion 1', 'criterion 2'], comments: ['q1'], createdAt: '2025-01-01',
    });
    const t = db.getTask('t1')!;
    expect(t.acceptance).toEqual(['criterion 1', 'criterion 2']);
    expect(t.comments).toEqual(['q1']);
  });
});

// ── Requirements ──────────────────────────────────────────────────────────────

describe('requirements', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  const base = {
    id: 'r1', name: '登录重设计', purpose: '提升转化率', context: 'chat ctx',
    status: 'confirmed' as const, createdAt: '2025-01-01', updatedAt: '2025-01-01',
  };

  it('inserts and retrieves a requirement', () => {
    db.insertRequirement(base);
    expect(db.getRequirement('r1')).toMatchObject({ id: 'r1', name: '登录重设计' });
  });

  it('listRequirements returns all sorted by updatedAt desc', () => {
    db.insertRequirement({ ...base, id: 'r1', updatedAt: '2025-01-01' });
    db.insertRequirement({ ...base, id: 'r2', name: 'B', updatedAt: '2025-02-01' });
    const list = db.listRequirements();
    expect(list[0].id).toBe('r2');
  });

  it('listRequirements fuzzy searches name', () => {
    db.insertRequirement(base);
    db.insertRequirement({ ...base, id: 'r2', name: '性能优化' });
    expect(db.listRequirements('登录')).toHaveLength(1);
    expect(db.listRequirements('登录')[0].id).toBe('r1');
  });

  it('listRequirements fuzzy searches purpose', () => {
    db.insertRequirement(base);
    expect(db.listRequirements('转化率')).toHaveLength(1);
  });

  it('updateRequirement patches fields and bumps updatedAt', () => {
    db.insertRequirement(base);
    db.updateRequirement('r1', { purpose: '新目的', status: 'draft' });
    const r = db.getRequirement('r1')!;
    expect(r.purpose).toBe('新目的');
    expect(r.status).toBe('draft');
  });

  it('persists and restores array fields', () => {
    db.insertRequirement({ ...base, tags: ['性能', '体验'], changes: ['改了A', '改了B'], relatedDocs: ['doc.md'] });
    const r = db.getRequirement('r1')!;
    expect(r.tags).toEqual(['性能', '体验']);
    expect(r.changes).toEqual(['改了A', '改了B']);
    expect(r.relatedDocs).toEqual(['doc.md']);
  });
});

// ── CaptureSession ────────────────────────────────────────────────────────────

describe('capture sessions', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('inserts and retrieves a session', () => {
    db.insertCaptureSession({
      id: 's1', phase: 'questioning', answers: { _name: 'test' }, createdAt: '2025-01-01', updatedAt: '2025-01-01',
    });
    const s = db.getCaptureSession('s1')!;
    expect(s.phase).toBe('questioning');
    expect(s.answers._name).toBe('test');
  });

  it('updates session phase and draft', () => {
    db.insertCaptureSession({
      id: 's1', phase: 'questioning', answers: {}, createdAt: '2025-01-01', updatedAt: '2025-01-01',
    });
    db.updateCaptureSession('s1', { phase: 'confirming', draft: { name: 'X', purpose: 'Y' } });
    const s = db.getCaptureSession('s1')!;
    expect(s.phase).toBe('confirming');
    expect(s.draft?.name).toBe('X');
  });
});

// ── Doc Audit ─────────────────────────────────────────────────────────────────

describe('doc audit', () => {
  let db: AgentForgeDB;
  beforeEach(() => { db = makeDB(); });

  it('inserts and retrieves an audit entry', () => {
    db.insertDocAudit({ token: 'tok1', filePath: 'docs/design.md', contentHash: 'abc123', createdAt: '2025-01-01' });
    const entry = db.getDocAudit('tok1')!;
    expect(entry.filePath).toBe('docs/design.md');
    expect(entry.contentHash).toBe('abc123');
  });

  it('returns undefined for missing token', () => {
    expect(db.getDocAudit('nope')).toBeUndefined();
  });
});

// ── Agent Sessions ────────────────────────────────────────────────────────────

describe('agent sessions', () => {
  let db: AgentForgeDB;
  beforeEach(() => {
    db = makeDB();
    db.upsertRole({
      id: 'goofy-expert',
      name: 'Goofy 专家',
      systemPrompt: 'You are Goofy.',
      isBuiltin: false,
      createdAt: '2025-01-01',
    });
  });

  it('stores and retrieves an external agent session by provider, role, and session id', () => {
    db.upsertAgentSession({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      externalId: 'cursor-agent-1',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });

    expect(db.getAgentSession('cursor', 'goofy-expert', 'chat-1')).toMatchObject({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      externalId: 'cursor-agent-1',
    });
  });

  it('updates an existing external agent session without changing its identity', () => {
    db.upsertAgentSession({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      externalId: 'cursor-agent-1',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    });

    db.upsertAgentSession({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      externalId: 'cursor-agent-2',
      createdAt: '2025-01-02',
      updatedAt: '2025-01-02',
    });

    expect(db.getAgentSession('cursor', 'goofy-expert', 'chat-1')).toMatchObject({
      externalId: 'cursor-agent-2',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-02',
    });
  });
});
