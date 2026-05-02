import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_DB_PATH = join(homedir(), '.relay', 'data.db');

let singleton: AgentForgeDB | undefined;

export interface Campaign {
  id: string;
  projectPath: string;
  title: string;
  brief?: string;
  status: 'active' | 'completed';
  startedAt: string;
  completedAt?: string;
  summary?: string;
}

export interface Cycle {
  id: string;
  campaignId: string;
  cycleNum: number;
  status: 'pending' | 'product' | 'dev' | 'test' | 'completed';
  productBrief?: string;
  screenshots?: Screenshot[];
  startedAt?: string;
  completedAt?: string;
}

export interface Screenshot {
  filePath: string;
  description: string;
  capturedAt: string;
}

export interface Task {
  id: string;
  cycleId: string;
  role: 'dev' | 'test';
  title: string;
  description?: string;
  acceptance?: string[];
  e2eScenarios?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  docAuditToken?: string;
  comments?: string[];
  createdAt: string;
  completedAt?: string;
}

export interface Role {
  id: string;
  name: string;
  systemPrompt: string;
  docPath?: string;
  isBuiltin: boolean;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  roleId: string;
  sourceFile?: string;
  chunkText: string;
  embedding?: Float32Array;
  createdAt: string;
}

export interface RequirementTodo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export interface Requirement {
  id: string;
  name: string;
  purpose?: string;
  context: string;
  summary?: string;
  relatedDocs?: string[];
  changes?: string[];
  tags?: string[];
  todos?: RequirementTodo[];
  projectPath?: string;
  status: 'draft' | 'confirmed';
  createdAt: string;
  updatedAt: string;
}

export interface CaptureSession {
  id: string;
  requirementId?: string;
  phase: 'questioning' | 'confirming' | 'done';
  answers: Record<string, string>;
  draft?: Partial<Requirement>;
  createdAt: string;
  updatedAt: string;
}

export interface DocAuditEntry {
  token: string;
  taskId?: string;
  filePath: string;
  contentHash: string;
  createdAt: string;
}

export interface AgentSession {
  provider: string;
  roleId: string;
  sessionId: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: String(row.id),
    projectPath: String(row.project_path),
    title: String(row.title),
    brief: row.brief ? String(row.brief) : undefined,
    status: row.status as Campaign['status'],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    summary: row.summary ? String(row.summary) : undefined,
  };
}

function rowToCycle(row: Record<string, unknown>): Cycle {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    cycleNum: Number(row.cycle_num),
    status: row.status as Cycle['status'],
    productBrief: row.product_brief ? String(row.product_brief) : undefined,
    screenshots: parseJson<Screenshot[]>(row.screenshots as string, []),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    role: row.role as Task['role'],
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    acceptance: parseJson<string[]>(row.acceptance as string, []),
    e2eScenarios: parseJson<string[]>(row.e2e_scenarios as string, []),
    status: row.status as Task['status'],
    result: row.result ? String(row.result) : undefined,
    docAuditToken: row.doc_audit_token ? String(row.doc_audit_token) : undefined,
    comments: parseJson<string[]>(row.comments as string, []),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

function rowToRole(row: Record<string, unknown>): Role {
  return {
    id: String(row.id),
    name: String(row.name),
    systemPrompt: String(row.system_prompt),
    docPath: row.doc_path ? String(row.doc_path) : undefined,
    isBuiltin: Boolean(row.is_builtin),
    createdAt: String(row.created_at),
  };
}

function rowToAgentSession(row: Record<string, unknown>): AgentSession {
  return {
    provider: String(row.provider),
    roleId: String(row.role_id),
    sessionId: String(row.session_id),
    externalId: String(row.external_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class AgentForgeDB {
  readonly sqlite: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
  }

  init(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id           TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        title        TEXT NOT NULL,
        brief        TEXT,
        status       TEXT DEFAULT 'active',
        started_at   TEXT NOT NULL,
        completed_at TEXT,
        summary      TEXT
      );

      CREATE TABLE IF NOT EXISTS cycles (
        id             TEXT PRIMARY KEY,
        campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        cycle_num      INTEGER NOT NULL,
        status         TEXT DEFAULT 'pending',
        product_brief  TEXT,
        screenshots    TEXT,
        started_at     TEXT,
        completed_at   TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id               TEXT PRIMARY KEY,
        cycle_id         TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        role             TEXT NOT NULL,
        title            TEXT NOT NULL,
        description      TEXT,
        acceptance       TEXT,
        e2e_scenarios    TEXT,
        status           TEXT DEFAULT 'pending',
        result           TEXT,
        doc_audit_token  TEXT,
        comments         TEXT,
        created_at       TEXT NOT NULL,
        completed_at     TEXT
      );

      CREATE TABLE IF NOT EXISTS roles (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        doc_path      TEXT,
        is_builtin    INTEGER DEFAULT 0,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id          TEXT PRIMARY KEY,
        role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        source_file TEXT,
        chunk_text  TEXT NOT NULL,
        embedding   BLOB,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        provider    TEXT NOT NULL,
        role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        session_id  TEXT NOT NULL,
        external_id TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (provider, role_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS doc_audit_log (
        token        TEXT PRIMARY KEY,
        task_id      TEXT,
        file_path    TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requirements (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        purpose      TEXT,
        context      TEXT NOT NULL,
        summary      TEXT,
        related_docs TEXT,
        changes      TEXT,
        tags         TEXT,
        project_path TEXT,
        status       TEXT DEFAULT 'draft',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capture_sessions (
        id             TEXT PRIMARY KEY,
        requirement_id TEXT,
        phase          TEXT NOT NULL,
        answers        TEXT DEFAULT '{}',
        draft          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cycles_campaign ON cycles(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_cycle ON tasks(cycle_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_role ON tasks(role, status);
      CREATE INDEX IF NOT EXISTS idx_chunks_role ON knowledge_chunks(role_id);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_role ON agent_sessions(role_id);
      CREATE INDEX IF NOT EXISTS idx_requirements_name ON requirements(name);
    `);

    // Migrations — safe to run repeatedly
    try {
      this.sqlite.exec(`ALTER TABLE requirements ADD COLUMN todos TEXT`);
    } catch { /* column already exists */ }
  }

  // ── Campaigns ──────────────────────────────────────────────────────────────

  insertCampaign(c: Campaign): void {
    this.sqlite.prepare(`
      INSERT INTO campaigns (id, project_path, title, brief, status, started_at, completed_at, summary)
      VALUES (@id, @project_path, @title, @brief, @status, @started_at, @completed_at, @summary)
    `).run({
      id: c.id,
      project_path: c.projectPath,
      title: c.title,
      brief: c.brief ?? null,
      status: c.status,
      started_at: c.startedAt,
      completed_at: c.completedAt ?? null,
      summary: c.summary ?? null,
    });
  }

  getCampaign(id: string): Campaign | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToCampaign(row) : undefined;
  }

  listCampaigns(): Campaign[] {
    const rows = this.sqlite.prepare(`SELECT * FROM campaigns ORDER BY started_at DESC`).all() as Record<string, unknown>[];
    return rows.map(rowToCampaign);
  }

  updateCampaign(id: string, patch: Partial<Pick<Campaign, 'status' | 'completedAt' | 'summary'>>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(patch.completedAt); }
    if (patch.summary !== undefined) { sets.push('summary = ?'); params.push(patch.summary); }
    if (sets.length === 0) return;
    params.push(id);
    this.sqlite.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // ── Cycles ─────────────────────────────────────────────────────────────────

  insertCycle(c: Cycle): void {
    this.sqlite.prepare(`
      INSERT INTO cycles (id, campaign_id, cycle_num, status, product_brief, screenshots, started_at, completed_at)
      VALUES (@id, @campaign_id, @cycle_num, @status, @product_brief, @screenshots, @started_at, @completed_at)
    `).run({
      id: c.id,
      campaign_id: c.campaignId,
      cycle_num: c.cycleNum,
      status: c.status,
      product_brief: c.productBrief ?? null,
      screenshots: c.screenshots ? JSON.stringify(c.screenshots) : null,
      started_at: c.startedAt ?? null,
      completed_at: c.completedAt ?? null,
    });
  }

  getCycle(id: string): Cycle | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM cycles WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToCycle(row) : undefined;
  }

  getActiveCycle(campaignId: string): Cycle | undefined {
    const row = this.sqlite.prepare(
      `SELECT * FROM cycles WHERE campaign_id = ? AND status != 'completed' ORDER BY cycle_num DESC LIMIT 1`
    ).get(campaignId) as Record<string, unknown> | undefined;
    return row ? rowToCycle(row) : undefined;
  }

  listCycles(campaignId: string): Cycle[] {
    const rows = this.sqlite.prepare(`SELECT * FROM cycles WHERE campaign_id = ? ORDER BY cycle_num ASC`).all(campaignId) as Record<string, unknown>[];
    return rows.map(rowToCycle);
  }

  updateCycle(id: string, patch: Partial<Pick<Cycle, 'status' | 'productBrief' | 'screenshots' | 'startedAt' | 'completedAt'>>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.productBrief !== undefined) { sets.push('product_brief = ?'); params.push(patch.productBrief); }
    if (patch.screenshots !== undefined) { sets.push('screenshots = ?'); params.push(JSON.stringify(patch.screenshots)); }
    if (patch.startedAt !== undefined) { sets.push('started_at = ?'); params.push(patch.startedAt); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(patch.completedAt); }
    if (sets.length === 0) return;
    params.push(id);
    this.sqlite.prepare(`UPDATE cycles SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  insertTask(t: Task): void {
    this.sqlite.prepare(`
      INSERT INTO tasks (id, cycle_id, role, title, description, acceptance, e2e_scenarios,
        status, result, doc_audit_token, comments, created_at, completed_at)
      VALUES (@id, @cycle_id, @role, @title, @description, @acceptance, @e2e_scenarios,
        @status, @result, @doc_audit_token, @comments, @created_at, @completed_at)
    `).run({
      id: t.id,
      cycle_id: t.cycleId,
      role: t.role,
      title: t.title,
      description: t.description ?? null,
      acceptance: t.acceptance ? JSON.stringify(t.acceptance) : null,
      e2e_scenarios: t.e2eScenarios ? JSON.stringify(t.e2eScenarios) : null,
      status: t.status,
      result: t.result ?? null,
      doc_audit_token: t.docAuditToken ?? null,
      comments: t.comments ? JSON.stringify(t.comments) : null,
      created_at: t.createdAt,
      completed_at: t.completedAt ?? null,
    });
  }

  getTask(id: string): Task | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToTask(row) : undefined;
  }

  listTasks(cycleId: string, role?: Task['role']): Task[] {
    if (role) {
      const rows = this.sqlite.prepare(`SELECT * FROM tasks WHERE cycle_id = ? AND role = ? ORDER BY created_at ASC`).all(cycleId, role) as Record<string, unknown>[];
      return rows.map(rowToTask);
    }
    const rows = this.sqlite.prepare(`SELECT * FROM tasks WHERE cycle_id = ? ORDER BY created_at ASC`).all(cycleId) as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  updateTask(id: string, patch: Partial<Pick<Task, 'status' | 'result' | 'docAuditToken' | 'comments' | 'completedAt'>>): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.result !== undefined) { sets.push('result = ?'); params.push(patch.result); }
    if (patch.docAuditToken !== undefined) { sets.push('doc_audit_token = ?'); params.push(patch.docAuditToken); }
    if (patch.comments !== undefined) { sets.push('comments = ?'); params.push(JSON.stringify(patch.comments)); }
    if (patch.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(patch.completedAt); }
    if (sets.length === 0) return;
    params.push(id);
    this.sqlite.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  upsertRole(r: Role): void {
    this.sqlite.prepare(`
      INSERT INTO roles (id, name, system_prompt, doc_path, is_builtin, created_at)
      VALUES (@id, @name, @system_prompt, @doc_path, @is_builtin, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        system_prompt = excluded.system_prompt,
        doc_path = excluded.doc_path
    `).run({
      id: r.id,
      name: r.name,
      system_prompt: r.systemPrompt,
      doc_path: r.docPath ?? null,
      is_builtin: r.isBuiltin ? 1 : 0,
      created_at: r.createdAt,
    });
  }

  getRole(id: string): Role | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM roles WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? rowToRole(row) : undefined;
  }

  listRoles(): Role[] {
    const rows = this.sqlite.prepare(`SELECT * FROM roles ORDER BY is_builtin DESC, name ASC`).all() as Record<string, unknown>[];
    return rows.map(rowToRole);
  }

  // ── Knowledge Chunks ────────────────────────────────────────────────────────

  insertChunk(chunk: KnowledgeChunk): void {
    this.sqlite.prepare(`
      INSERT INTO knowledge_chunks (id, role_id, source_file, chunk_text, embedding, created_at)
      VALUES (@id, @role_id, @source_file, @chunk_text, @embedding, @created_at)
    `).run({
      id: chunk.id,
      role_id: chunk.roleId,
      source_file: chunk.sourceFile ?? null,
      chunk_text: chunk.chunkText,
      embedding: chunk.embedding ? Buffer.from(chunk.embedding.buffer) : null,
      created_at: chunk.createdAt,
    });
  }

  getChunksForRole(roleId: string): KnowledgeChunk[] {
    const rows = this.sqlite.prepare(`SELECT * FROM knowledge_chunks WHERE role_id = ?`).all(roleId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      roleId: String(row.role_id),
      sourceFile: row.source_file ? String(row.source_file) : undefined,
      chunkText: String(row.chunk_text),
      embedding: row.embedding ? new Float32Array((row.embedding as Buffer).buffer) : undefined,
      createdAt: String(row.created_at),
    }));
  }

  deleteChunksForRole(roleId: string): void {
    this.sqlite.prepare(`DELETE FROM knowledge_chunks WHERE role_id = ?`).run(roleId);
  }

  // ── Agent Sessions ─────────────────────────────────────────────────────────

  upsertAgentSession(session: AgentSession): void {
    this.sqlite.prepare(`
      INSERT INTO agent_sessions (provider, role_id, session_id, external_id, created_at, updated_at)
      VALUES (@provider, @role_id, @session_id, @external_id, @created_at, @updated_at)
      ON CONFLICT(provider, role_id, session_id) DO UPDATE SET
        external_id = excluded.external_id,
        updated_at = excluded.updated_at
    `).run({
      provider: session.provider,
      role_id: session.roleId,
      session_id: session.sessionId,
      external_id: session.externalId,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  }

  getAgentSession(provider: string, roleId: string, sessionId: string): AgentSession | undefined {
    const row = this.sqlite.prepare(
      `SELECT * FROM agent_sessions WHERE provider = ? AND role_id = ? AND session_id = ?`
    ).get(provider, roleId, sessionId) as Record<string, unknown> | undefined;
    return row ? rowToAgentSession(row) : undefined;
  }

  // ── Requirements ───────────────────────────────────────────────────────────

  insertRequirement(r: Requirement): void {
    this.sqlite.prepare(`
      INSERT INTO requirements (id, name, purpose, context, summary, related_docs, changes, tags, todos, project_path, status, created_at, updated_at)
      VALUES (@id, @name, @purpose, @context, @summary, @related_docs, @changes, @tags, @todos, @project_path, @status, @created_at, @updated_at)
    `).run({
      id: r.id, name: r.name, purpose: r.purpose ?? null, context: r.context,
      summary: r.summary ?? null,
      related_docs: r.relatedDocs ? JSON.stringify(r.relatedDocs) : null,
      changes: r.changes ? JSON.stringify(r.changes) : null,
      tags: r.tags ? JSON.stringify(r.tags) : null,
      todos: r.todos ? JSON.stringify(r.todos) : null,
      project_path: r.projectPath ?? null,
      status: r.status, created_at: r.createdAt, updated_at: r.updatedAt,
    });
  }

  updateRequirement(id: string, patch: Partial<Omit<Requirement, 'id' | 'createdAt'>>): void {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.purpose !== undefined) { sets.push('purpose = ?'); params.push(patch.purpose); }
    if (patch.context !== undefined) { sets.push('context = ?'); params.push(patch.context); }
    if (patch.summary !== undefined) { sets.push('summary = ?'); params.push(patch.summary); }
    if (patch.relatedDocs !== undefined) { sets.push('related_docs = ?'); params.push(JSON.stringify(patch.relatedDocs)); }
    if (patch.changes !== undefined) { sets.push('changes = ?'); params.push(JSON.stringify(patch.changes)); }
    if (patch.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(patch.tags)); }
    if (patch.todos !== undefined) { sets.push('todos = ?'); params.push(JSON.stringify(patch.todos)); }
    if (patch.projectPath !== undefined) { sets.push('project_path = ?'); params.push(patch.projectPath); }
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    params.push(id);
    this.sqlite.prepare(`UPDATE requirements SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getRequirement(id: string): Requirement | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM requirements WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRequirement(row) : undefined;
  }

  listRequirements(query?: string): Requirement[] {
    let rows: Record<string, unknown>[];
    if (query) {
      rows = this.sqlite.prepare(
        `SELECT * FROM requirements WHERE name LIKE ? OR summary LIKE ? OR purpose LIKE ? ORDER BY updated_at DESC`
      ).all(`%${query}%`, `%${query}%`, `%${query}%`) as Record<string, unknown>[];
    } else {
      rows = this.sqlite.prepare(`SELECT * FROM requirements ORDER BY updated_at DESC`).all() as Record<string, unknown>[];
    }
    return rows.map((r) => this.rowToRequirement(r));
  }

  private rowToRequirement(row: Record<string, unknown>): Requirement {
    return {
      id: String(row.id), name: String(row.name),
      purpose: row.purpose ? String(row.purpose) : undefined,
      context: String(row.context),
      summary: row.summary ? String(row.summary) : undefined,
      relatedDocs: parseJson<string[]>(row.related_docs as string, []),
      changes: parseJson<string[]>(row.changes as string, []),
      tags: parseJson<string[]>(row.tags as string, []),
      todos: parseJson<RequirementTodo[]>(row.todos as string, []),
      projectPath: row.project_path ? String(row.project_path) : undefined,
      status: row.status as Requirement['status'],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  // ── Capture Sessions ────────────────────────────────────────────────────────

  insertCaptureSession(s: CaptureSession): void {
    this.sqlite.prepare(`
      INSERT INTO capture_sessions (id, requirement_id, phase, answers, draft, created_at, updated_at)
      VALUES (@id, @requirement_id, @phase, @answers, @draft, @created_at, @updated_at)
    `).run({
      id: s.id, requirement_id: s.requirementId ?? null, phase: s.phase,
      answers: JSON.stringify(s.answers), draft: s.draft ? JSON.stringify(s.draft) : null,
      created_at: s.createdAt, updated_at: s.updatedAt,
    });
  }

  updateCaptureSession(id: string, patch: Partial<Pick<CaptureSession, 'phase' | 'answers' | 'draft' | 'requirementId'>>): void {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];
    if (patch.phase !== undefined) { sets.push('phase = ?'); params.push(patch.phase); }
    if (patch.answers !== undefined) { sets.push('answers = ?'); params.push(JSON.stringify(patch.answers)); }
    if (patch.draft !== undefined) { sets.push('draft = ?'); params.push(JSON.stringify(patch.draft)); }
    if (patch.requirementId !== undefined) { sets.push('requirement_id = ?'); params.push(patch.requirementId); }
    params.push(id);
    this.sqlite.prepare(`UPDATE capture_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getCaptureSession(id: string): CaptureSession | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM capture_sessions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      requirementId: row.requirement_id ? String(row.requirement_id) : undefined,
      phase: row.phase as CaptureSession['phase'],
      answers: parseJson<Record<string, string>>(row.answers as string, {}),
      draft: row.draft ? parseJson<Partial<Requirement>>(row.draft as string, {}) : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  // ── Doc Audit ──────────────────────────────────────────────────────────────

  insertDocAudit(entry: DocAuditEntry): void {
    this.sqlite.prepare(`
      INSERT INTO doc_audit_log (token, task_id, file_path, content_hash, created_at)
      VALUES (@token, @task_id, @file_path, @content_hash, @created_at)
    `).run({
      token: entry.token,
      task_id: entry.taskId ?? null,
      file_path: entry.filePath,
      content_hash: entry.contentHash,
      created_at: entry.createdAt,
    });
  }

  getDocAudit(token: string): DocAuditEntry | undefined {
    const row = this.sqlite.prepare(`SELECT * FROM doc_audit_log WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      token: String(row.token),
      taskId: row.task_id ? String(row.task_id) : undefined,
      filePath: String(row.file_path),
      contentHash: String(row.content_hash),
      createdAt: String(row.created_at),
    };
  }

  close(): void {
    this.sqlite.close();
    if (singleton === this) singleton = undefined;
  }
}

export function getDatabase(dbPath?: string): AgentForgeDB {
  if (!singleton) {
    singleton = new AgentForgeDB(dbPath ?? DEFAULT_DB_PATH);
    singleton.init();
  }
  return singleton;
}
