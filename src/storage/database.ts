import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  Platform,
  SessionStatus,
  StoredSummary,
  Tag,
  TrackedSession,
} from '../types/index.js';

export const DEFAULT_DB_PATH = join(homedir(), '.ai-chat-digest', 'data.db');

let singleton: ChatDigestDB | undefined;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToStoredSummary(
  row: Record<string, unknown>,
  tagNames: string[],
): StoredSummary {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    title: String(row.title),
    topics: parseJson<string[]>(row.topics as string | null, []),
    tags: tagNames,
    contextProvided: {
      internalTools: parseJson<string[]>(row.context_tools as string | null, []),
      internalDefinitions: parseJson<string[]>(row.context_defs as string | null, []),
      externalResources: parseJson<string[]>(
        (row.context_external as string | null) ?? null,
        [],
      ),
    },
    discussionProcess: parseJson<string[]>(
      row.discussion_process as string | null,
      [],
    ),
    problemsDiscovered: parseJson<string[]>(row.problems as string | null, []),
    decidedSolutions: parseJson<string[]>(row.solutions as string | null, []),
    domainKnowledge: parseJson<StoredSummary['domainKnowledge']>(
      row.domain_knowledge as string | null,
      {},
    ),
    actionItems:
      row.action_items == null || row.action_items === ''
        ? undefined
        : parseJson<string[]>(row.action_items as string, []),
    rawSummary: String(row.raw_summary ?? ''),
    createdAt: String(row.created_at),
    modelUsed: String(row.model_used ?? ''),
  };
}

function rowToSession(row: Record<string, unknown>): TrackedSession {
  return {
    id: String(row.id),
    platform: row.platform as Platform,
    projectPath: row.project_path ? String(row.project_path) : undefined,
    gitBranch: row.git_branch ? String(row.git_branch) : undefined,
    transcriptPath: String(row.transcript_path),
    status: row.status as SessionStatus,
    messageCount: Number(row.message_count ?? 0),
    firstMessage: row.first_message ? String(row.first_message) : undefined,
    startedAt: String(row.started_at),
    lastActiveAt: row.last_active_at ? String(row.last_active_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    summarized: Boolean(row.summarized),
  };
}

export interface SessionListFilters {
  status?: SessionStatus;
  platform?: Platform;
}

export interface SummaryListFilters {
  tags?: string[];
  platform?: Platform;
  dateFrom?: string;
  dateTo?: string;
}

export interface SessionStatusExtra {
  lastActiveAt?: string;
  completedAt?: string;
  messageCount?: number;
  firstMessage?: string;
  projectPath?: string;
  gitBranch?: string;
  transcriptPath?: string;
}

export class ChatDigestDB {
  readonly sqlite: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
  }

  init(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,
        platform        TEXT NOT NULL,
        project_path    TEXT,
        git_branch      TEXT,
        transcript_path TEXT NOT NULL,
        status          TEXT DEFAULT 'active',
        message_count   INTEGER DEFAULT 0,
        first_message   TEXT,
        started_at      TEXT NOT NULL,
        last_active_at  TEXT,
        completed_at    TEXT,
        summarized      INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id                  TEXT PRIMARY KEY,
        session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        title               TEXT NOT NULL,
        topics              TEXT,
        context_tools       TEXT,
        context_defs        TEXT,
        context_external    TEXT,
        discussion_process  TEXT,
        problems            TEXT,
        solutions           TEXT,
        domain_knowledge    TEXT,
        action_items        TEXT,
        raw_summary         TEXT,
        created_at          TEXT NOT NULL,
        model_used          TEXT
      );

      CREATE TABLE IF NOT EXISTS tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT UNIQUE NOT NULL,
        color TEXT
      );

      CREATE TABLE IF NOT EXISTS session_tags (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (session_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_session_id ON summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_tags_tag_id ON session_tags(tag_id);
    `);

    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
        title,
        topics,
        problems,
        solutions,
        raw_summary,
        content='summaries',
        content_rowid='rowid'
      );
    `);

    this.sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
        INSERT INTO summaries_fts(rowid, title, topics, problems, solutions, raw_summary)
        VALUES (
          new.rowid,
          new.title,
          new.topics,
          new.problems,
          new.solutions,
          new.raw_summary
        );
      END;

      CREATE TRIGGER IF NOT EXISTS summaries_ad AFTER DELETE ON summaries BEGIN
        INSERT INTO summaries_fts(summaries_fts, rowid, title, topics, problems, solutions, raw_summary)
        VALUES('delete', old.rowid, old.title, old.topics, old.problems, old.solutions, old.raw_summary);
      END;

      CREATE TRIGGER IF NOT EXISTS summaries_au AFTER UPDATE ON summaries BEGIN
        INSERT INTO summaries_fts(summaries_fts, rowid, title, topics, problems, solutions, raw_summary)
        VALUES('delete', old.rowid, old.title, old.topics, old.problems, old.solutions, old.raw_summary);
        INSERT INTO summaries_fts(rowid, title, topics, problems, solutions, raw_summary)
        VALUES (
          new.rowid,
          new.title,
          new.topics,
          new.problems,
          new.solutions,
          new.raw_summary
        );
      END;
    `);
  }

  upsertSession(session: TrackedSession): void {
    const stmt = this.sqlite.prepare(`
      INSERT INTO sessions (
        id, platform, project_path, git_branch, transcript_path, status,
        message_count, first_message, started_at, last_active_at, completed_at, summarized
      ) VALUES (
        @id, @platform, @project_path, @git_branch, @transcript_path, @status,
        @message_count, @first_message, @started_at, @last_active_at, @completed_at, @summarized
      )
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        project_path = excluded.project_path,
        git_branch = excluded.git_branch,
        transcript_path = excluded.transcript_path,
        status = excluded.status,
        message_count = excluded.message_count,
        first_message = COALESCE(excluded.first_message, first_message),
        started_at = excluded.started_at,
        last_active_at = excluded.last_active_at,
        completed_at = excluded.completed_at,
        summarized = excluded.summarized
    `);
    stmt.run({
      id: session.id,
      platform: session.platform,
      project_path: session.projectPath ?? null,
      git_branch: session.gitBranch ?? null,
      transcript_path: session.transcriptPath,
      status: session.status,
      message_count: session.messageCount,
      first_message: session.firstMessage ?? null,
      started_at: session.startedAt,
      last_active_at: session.lastActiveAt ?? null,
      completed_at: session.completedAt ?? null,
      summarized: session.summarized ? 1 : 0,
    });
  }

  getSession(id: string): TrackedSession | undefined {
    const row = this.sqlite
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : undefined;
  }

  listSessions(filters?: SessionListFilters): TrackedSession[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.status) {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.platform) {
      clauses.push('platform = ?');
      params.push(filters.platform);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.sqlite
      .prepare(`SELECT * FROM sessions ${where} ORDER BY started_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  updateSessionStatus(
    id: string,
    status: SessionStatus,
    extra?: SessionStatusExtra,
  ): void {
    const sets = ['status = ?'];
    const params: unknown[] = [status];
    if (extra?.lastActiveAt !== undefined) {
      sets.push('last_active_at = ?');
      params.push(extra.lastActiveAt);
    }
    if (extra?.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(extra.completedAt);
    }
    if (extra?.messageCount !== undefined) {
      sets.push('message_count = ?');
      params.push(extra.messageCount);
    }
    if (extra?.firstMessage !== undefined) {
      sets.push('first_message = ?');
      params.push(extra.firstMessage);
    }
    if (extra?.projectPath !== undefined) {
      sets.push('project_path = ?');
      params.push(extra.projectPath);
    }
    if (extra?.gitBranch !== undefined) {
      sets.push('git_branch = ?');
      params.push(extra.gitBranch);
    }
    if (extra?.transcriptPath !== undefined) {
      sets.push('transcript_path = ?');
      params.push(extra.transcriptPath);
    }
    params.push(id);
    this.sqlite
      .prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  markSummarized(sessionId: string): void {
    this.sqlite
      .prepare(`UPDATE sessions SET summarized = 1 WHERE id = ?`)
      .run(sessionId);
  }

  private getSessionTagNames(sessionId: string): string[] {
    const rows = this.sqlite
      .prepare(
        `SELECT t.name FROM session_tags st
         JOIN tags t ON t.id = st.tag_id
         WHERE st.session_id = ?
         ORDER BY t.name`,
      )
      .all(sessionId) as { name: string }[];
    return rows.map((r) => r.name);
  }

  insertSummary(summary: StoredSummary): void {
    const insert = this.sqlite.prepare(`
      INSERT INTO summaries (
        id, session_id, title, topics, context_tools, context_defs, context_external,
        discussion_process, problems, solutions, domain_knowledge, action_items,
        raw_summary, created_at, model_used
      ) VALUES (
        @id, @session_id, @title, @topics, @context_tools, @context_defs, @context_external,
        @discussion_process, @problems, @solutions, @domain_knowledge, @action_items,
        @raw_summary, @created_at, @model_used
      )
    `);
    insert.run({
      id: summary.id,
      session_id: summary.sessionId,
      title: summary.title,
      topics: JSON.stringify(summary.topics),
      context_tools: JSON.stringify(summary.contextProvided.internalTools),
      context_defs: JSON.stringify(summary.contextProvided.internalDefinitions),
      context_external: JSON.stringify(summary.contextProvided.externalResources),
      discussion_process: JSON.stringify(summary.discussionProcess),
      problems: JSON.stringify(summary.problemsDiscovered),
      solutions: JSON.stringify(summary.decidedSolutions),
      domain_knowledge: JSON.stringify(summary.domainKnowledge),
      action_items:
        summary.actionItems !== undefined ? JSON.stringify(summary.actionItems) : null,
      raw_summary: summary.rawSummary,
      created_at: summary.createdAt,
      model_used: summary.modelUsed,
    });
    if (summary.tags.length > 0) {
      this.addSessionTags(summary.sessionId, summary.tags);
    }
  }

  getSummary(sessionId: string): StoredSummary | undefined {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM summaries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const tags = this.getSessionTagNames(String(row.session_id));
    return rowToStoredSummary(row, tags);
  }

  listSummaries(filters?: SummaryListFilters): StoredSummary[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.platform) {
      clauses.push(`s.session_id IN (SELECT id FROM sessions WHERE platform = ?)`);
      params.push(filters.platform);
    }
    if (filters?.dateFrom) {
      clauses.push('s.created_at >= ?');
      params.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      clauses.push('s.created_at <= ?');
      params.push(filters.dateTo);
    }

    const tagNames = filters?.tags?.filter(Boolean) ?? [];
    for (const _ of tagNames) {
      clauses.push(
        `s.session_id IN (
          SELECT st.session_id FROM session_tags st
          JOIN tags t ON t.id = st.tag_id AND t.name = ?
        )`,
      );
    }
    params.push(...tagNames);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.sqlite
      .prepare(
        `SELECT s.* FROM summaries s ${where} ORDER BY s.created_at DESC`,
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map((row) =>
      rowToStoredSummary(row, this.getSessionTagNames(String(row.session_id))),
    );
  }

  getOrCreateTag(name: string, color?: string): Tag {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Tag name cannot be empty');
    }
    const existing = this.sqlite
      .prepare(`SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE`)
      .get(trimmed) as { id: number; name: string; color: string | null } | undefined;
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        color: existing.color ?? undefined,
      };
    }
    const info = this.sqlite
      .prepare(`INSERT INTO tags (name, color) VALUES (?, ?)`)
      .run(trimmed, color ?? null);
    return {
      id: Number(info.lastInsertRowid),
      name: trimmed,
      color,
    };
  }

  addSessionTags(sessionId: string, tagNames: string[]): void {
    const link = this.sqlite.prepare(
      `INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)`,
    );
    const run = this.sqlite.transaction(() => {
      for (const raw of tagNames) {
        const tag = this.getOrCreateTag(raw);
        link.run(sessionId, tag.id);
      }
    });
    run();
  }

  listTags(): Tag[] {
    const rows = this.sqlite
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(st.session_id) AS cnt
         FROM tags t
         LEFT JOIN session_tags st ON st.tag_id = t.id
         GROUP BY t.id
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as { id: number; name: string; color: string | null; cnt: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ?? undefined,
      count: r.cnt,
    }));
  }

  getTagSummaries(tagName: string): StoredSummary[] {
    const rows = this.sqlite
      .prepare(
        `SELECT s.* FROM summaries s
         JOIN session_tags st ON st.session_id = s.session_id
         JOIN tags t ON t.id = st.tag_id AND t.name = ? COLLATE NOCASE
         ORDER BY s.created_at DESC`,
      )
      .all(tagName) as Record<string, unknown>[];
    return rows.map((row) =>
      rowToStoredSummary(row, this.getSessionTagNames(String(row.session_id))),
    );
  }

  close(): void {
    this.sqlite.close();
    if (singleton === this) {
      singleton = undefined;
    }
  }

  /** Hydrate raw summary rows (e.g. from FTS queries) into {@link StoredSummary}. */
  hydrateSummaryRows(rows: Record<string, unknown>[]): StoredSummary[] {
    return rows.map((row) =>
      rowToStoredSummary(row, this.getSessionTagNames(String(row.session_id))),
    );
  }
}

export function getDatabase(dbPath?: string): ChatDigestDB {
  if (!singleton) {
    singleton = new ChatDigestDB(dbPath ?? DEFAULT_DB_PATH);
    singleton.init();
  }
  return singleton;
}
