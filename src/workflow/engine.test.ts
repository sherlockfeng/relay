import { describe, it, expect, beforeEach } from 'vitest';
import { AgentForgeDB } from '../storage/database.js';
import { WorkflowEngine } from './engine.js';

function makeDB() {
  const db = new AgentForgeDB(':memory:');
  db.init();
  return db;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup() {
  const db = makeDB();
  const engine = new WorkflowEngine(db);
  return { db, engine };
}

function insertAuditToken(db: AgentForgeDB, token = 'tok1') {
  db.insertDocAudit({ token, filePath: 'docs/design.md', contentHash: 'abc', createdAt: new Date().toISOString() });
  return token;
}

// ── initWorkflow ──────────────────────────────────────────────────────────────

describe('initWorkflow', () => {
  it('creates a campaign with active status', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'My Campaign', 'Fix login');
    expect(db.getCampaign(c.id)?.status).toBe('active');
  });

  it('stores the brief on the campaign', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'Title', 'Brief text');
    expect(db.getCampaign(c.id)?.brief).toBe('Brief text');
  });

  it('creates the first cycle in product phase', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    expect(cycle.cycleNum).toBe(1);
    expect(cycle.status).toBe('product');
  });
});

// ── getCycleState ─────────────────────────────────────────────────────────────

describe('getCycleState', () => {
  it('returns null when no cycle matches', () => {
    const { engine } = setup();
    expect(engine.getCycleState('nope', undefined)).toBeNull();
  });

  it('returns cycle and tasks when found by campaignId', () => {
    const { engine } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const state = engine.getCycleState(undefined, c.id);
    expect(state?.cycle.status).toBe('product');
    expect(state?.tasks).toEqual([]);
  });

  it('returns cycle and tasks when found by cycleId', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const state = engine.getCycleState(cycle.id);
    expect(state?.cycle.id).toBe(cycle.id);
  });
});

// ── createTasks ───────────────────────────────────────────────────────────────

describe('createTasks', () => {
  it('creates dev and test tasks', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const tasks = engine.createTasks(cycle.id, [
      { role: 'dev', title: 'Dev task' },
      { role: 'test', title: 'Test task' },
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.role)).toContain('dev');
    expect(tasks.map((t) => t.role)).toContain('test');
  });

  it('advances cycle status from product to dev', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]);
    expect(db.getCycle(cycle.id)!.status).toBe('dev');
  });

  it('throws if cycle is not in product phase', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]); // now in dev
    expect(() => engine.createTasks(cycle.id, [{ role: 'dev', title: 'Y' }]))
      .toThrow('Cannot create tasks in cycle status "dev"');
  });

  it('throws if cycle does not exist', () => {
    const { engine } = setup();
    expect(() => engine.createTasks('missing', [{ role: 'dev', title: 'X' }]))
      .toThrow('Cycle not found: missing');
  });
});

// ── getTasksForRole ───────────────────────────────────────────────────────────

describe('getTasksForRole', () => {
  it('returns only tasks for the specified role', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'D' }, { role: 'test', title: 'T' }]);
    expect(engine.getTasksForRole(cycle.id, 'dev')).toHaveLength(1);
    expect(engine.getTasksForRole(cycle.id, 'test')).toHaveLength(1);
  });

  it('throws if cycle does not exist', () => {
    const { engine } = setup();
    expect(() => engine.getTasksForRole('nope', 'dev')).toThrow('Cycle not found: nope');
  });
});

// ── completeTask ──────────────────────────────────────────────────────────────

describe('completeTask', () => {
  function setupWithDevTask() {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const [devTask] = engine.createTasks(cycle.id, [{ role: 'dev', title: 'Implement X' }]);
    return { engine, db, cycle, devTask };
  }

  it('marks a dev task as completed', () => {
    const { engine, db, devTask } = setupWithDevTask();
    const token = insertAuditToken(db);
    const updated = engine.completeTask(devTask.id, { result: 'Done', docAuditToken: token });
    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('Done');
  });

  it('throws for dev task without docAuditToken', () => {
    const { engine, devTask } = setupWithDevTask();
    expect(() => engine.completeTask(devTask.id, { result: 'Done' }))
      .toThrow('Developer tasks require a docAuditToken');
  });

  it('throws for invalid (unknown) docAuditToken', () => {
    const { engine, devTask } = setupWithDevTask();
    expect(() => engine.completeTask(devTask.id, { result: 'Done', docAuditToken: 'invalid' }))
      .toThrow('Invalid docAuditToken: invalid');
  });

  it('throws if task does not exist', () => {
    const { engine } = setup();
    expect(() => engine.completeTask('nope', { result: 'x' })).toThrow('Task not found: nope');
  });

  it('advances cycle to test phase when all dev tasks are done', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const [t1, t2] = engine.createTasks(cycle.id, [
      { role: 'dev', title: 'A' },
      { role: 'dev', title: 'B' },
    ]);
    const tok1 = insertAuditToken(db, 'tok1');
    const tok2 = insertAuditToken(db, 'tok2');
    engine.completeTask(t1.id, { result: 'done', docAuditToken: tok1 });
    expect(db.getCycle(cycle.id)!.status).toBe('dev'); // still dev, t2 pending
    engine.completeTask(t2.id, { result: 'done', docAuditToken: tok2 });
    expect(db.getCycle(cycle.id)!.status).toBe('test'); // all done → test
  });

  it('does not advance to test phase if some dev tasks remain', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const [t1] = engine.createTasks(cycle.id, [{ role: 'dev', title: 'A' }, { role: 'dev', title: 'B' }]);
    const tok = insertAuditToken(db);
    engine.completeTask(t1.id, { result: 'done', docAuditToken: tok });
    expect(db.getCycle(cycle.id)!.status).toBe('dev');
  });

  it('completes a test task without requiring docAuditToken', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    // Need to get through dev phase first
    const [devTask] = engine.createTasks(cycle.id, [{ role: 'dev', title: 'D' }, { role: 'test', title: 'T' }]);
    const tok = insertAuditToken(db);
    engine.completeTask(devTask.id, { result: 'done', docAuditToken: tok });
    const testTasks = engine.getTasksForRole(cycle.id, 'test');
    const completed = engine.completeTask(testTasks[0].id, { result: 'passed' });
    expect(completed.status).toBe('completed');
  });
});

// ── addTaskComment ────────────────────────────────────────────────────────────

describe('addTaskComment', () => {
  it('appends a comment to the task', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    const [task] = engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]);
    engine.addTaskComment(task.id, 'first comment');
    engine.addTaskComment(task.id, 'second comment');
    const updated = db.getTask(task.id)!;
    expect(updated.comments).toEqual(['first comment', 'second comment']);
  });

  it('throws if task does not exist', () => {
    const { engine } = setup();
    expect(() => engine.addTaskComment('nope', 'comment')).toThrow('Task not found: nope');
  });
});

// ── createBugTasks ────────────────────────────────────────────────────────────

describe('createBugTasks', () => {
  it('creates bug tasks with [BUG] prefix', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]);
    // Manually advance to test phase
    db.updateCycle(cycle.id, { status: 'test' });
    const bugs = engine.createBugTasks(cycle.id, [{ title: 'Login broken', description: 'crash on submit' }]);
    expect(bugs[0].title).toBe('[BUG] Login broken');
  });

  it('reverts cycle from test to dev', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]);
    db.updateCycle(cycle.id, { status: 'test' });
    engine.createBugTasks(cycle.id, [{ title: 'Bug' }]);
    expect(db.getCycle(cycle.id)!.status).toBe('dev');
  });

  it('includes expected/actual in task description', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'X' }]);
    db.updateCycle(cycle.id, { status: 'test' });
    const [bug] = engine.createBugTasks(cycle.id, [{
      title: 'Crash', expected: 'success toast', actual: 'white screen',
    }]);
    expect(bug.description).toContain('Expected: success toast');
    expect(bug.description).toContain('Actual: white screen');
  });
});

// ── completeCycle ─────────────────────────────────────────────────────────────

describe('completeCycle', () => {
  function setupAtTestPhase() {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.createTasks(cycle.id, [{ role: 'dev', title: 'D' }]);
    const tok = insertAuditToken(db);
    const [devTask] = db.listTasks(cycle.id, 'dev');
    engine.completeTask(devTask.id, { result: 'done', docAuditToken: tok });
    // Now in test phase
    return { engine, db, campaign: c, cycle };
  }

  it('marks cycle as completed', () => {
    const { engine, db, cycle } = setupAtTestPhase();
    engine.completeCycle(cycle.id, {});
    expect(db.getCycle(cycle.id)!.status).toBe('completed');
  });

  it('auto-creates next cycle in product phase', () => {
    const { engine, db, campaign, cycle } = setupAtTestPhase();
    engine.completeCycle(cycle.id, {});
    const nextCycle = db.getActiveCycle(campaign.id)!;
    expect(nextCycle.cycleNum).toBe(2);
    expect(nextCycle.status).toBe('product');
  });

  it('persists screenshots on the completed cycle', () => {
    const { engine, db, cycle } = setupAtTestPhase();
    const shots = [{ filePath: '/s.png', description: '[PASS] login', capturedAt: '2025-01-01' }];
    engine.completeCycle(cycle.id, { screenshots: shots });
    expect(db.getCycle(cycle.id)!.screenshots).toHaveLength(1);
  });

  it('throws if cycle is not in test phase', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    expect(() => engine.completeCycle(cycle.id, {}))
      .toThrow('Cannot complete cycle in status "product"');
  });
});

// ── captureScreenshot ─────────────────────────────────────────────────────────

describe('captureScreenshot', () => {
  it('appends screenshot to the cycle', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.captureScreenshot(cycle.id, '/screens/s1.png', '[PASS] homepage loads');
    const updated = db.getCycle(cycle.id)!;
    expect(updated.screenshots).toHaveLength(1);
    expect(updated.screenshots![0].filePath).toBe('/screens/s1.png');
    expect(updated.screenshots![0].description).toBe('[PASS] homepage loads');
  });

  it('accumulates multiple screenshots', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.captureScreenshot(cycle.id, '/s1.png', 'A');
    engine.captureScreenshot(cycle.id, '/s2.png', 'B');
    expect(db.getCycle(cycle.id)!.screenshots).toHaveLength(2);
  });

  it('throws if cycle does not exist', () => {
    const { engine } = setup();
    expect(() => engine.captureScreenshot('nope', '/s.png', 'desc')).toThrow('Cycle not found: nope');
  });
});

// ── addProductFeedback ────────────────────────────────────────────────────────

describe('addProductFeedback', () => {
  it('appends feedback to cycle productBrief', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    engine.addProductFeedback(cycle.id, 'Button too small');
    const updated = db.getCycle(cycle.id)!;
    expect(updated.productBrief).toContain('Button too small');
  });

  it('appends to existing brief without overwriting', () => {
    const { engine, db } = setup();
    const c = engine.initWorkflow('/proj', 'T');
    const cycle = db.getActiveCycle(c.id)!;
    db.updateCycle(cycle.id, { productBrief: 'Original brief' });
    engine.addProductFeedback(cycle.id, 'New feedback');
    const updated = db.getCycle(cycle.id)!;
    expect(updated.productBrief).toContain('Original brief');
    expect(updated.productBrief).toContain('New feedback');
  });
});
