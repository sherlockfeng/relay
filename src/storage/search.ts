import type { ChatDigestDB } from './database.js';
import type { StoredSummary } from '../types/index.js';

/** Build a conservative FTS5 OR query from free text (phrase per token). */
function buildFtsMatchPhrase(query: string, maxTokens = 48): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxTokens)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (tokens.length === 0) return '';
  return tokens.join(' OR ');
}

/**
 * Full-text search over summaries via FTS5, optionally constrained by tag names (AND).
 */
export function searchSummaries(
  db: ChatDigestDB,
  query: string,
  options?: { tags?: string[]; limit?: number },
): StoredSummary[] {
  const match = buildFtsMatchPhrase(query);
  if (!match) return [];

  const limit = options?.limit ?? 50;
  const tagNames = options?.tags?.filter(Boolean) ?? [];

  const clauses: string[] = ['summaries_fts MATCH ?'];
  const params: unknown[] = [match];

  for (const _ of tagNames) {
    clauses.push(
      `s.session_id IN (
        SELECT st.session_id FROM session_tags st
        JOIN tags t ON t.id = st.tag_id AND t.name = ?
      )`,
    );
  }
  params.push(...tagNames);
  params.push(limit);

  const sql = `
    SELECT s.* FROM summaries s
    INNER JOIN summaries_fts ON summaries_fts.rowid = s.rowid
    WHERE ${clauses.join(' AND ')}
    ORDER BY bm25(summaries_fts)
    LIMIT ?
  `;

  const rows = db.sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
  return db.hydrateSummaryRows(rows);
}

/**
 * Find summaries similar to a session: combines shared-tag strength with FTS overlap
 * against the source summary's title and raw text.
 */
export function findSimilar(
  db: ChatDigestDB,
  sessionId: string,
  limit = 10,
): StoredSummary[] {
  const source = db.getSummary(sessionId);
  if (!source) return [];

  const overlapRows = db.sqlite
    .prepare(
      `SELECT st2.session_id AS sid, COUNT(*) AS cnt
       FROM session_tags st1
       JOIN session_tags st2
         ON st1.tag_id = st2.tag_id AND st2.session_id != st1.session_id
       WHERE st1.session_id = ?
       GROUP BY st2.session_id`,
    )
    .all(sessionId) as { sid: string; cnt: number }[];

  const overlapMap = new Map(overlapRows.map((r) => [r.sid, r.cnt]));

  const ftsSource = `${source.title}\n${source.rawSummary}`.slice(0, 4000);
  const ftsMatch = buildFtsMatchPhrase(ftsSource, 32);

  const ftsRank = new Map<string, number>();
  if (ftsMatch) {
    const ftsRows = db.sqlite
      .prepare(
        `SELECT s.session_id AS sid, bm25(summaries_fts) AS b
         FROM summaries s
         INNER JOIN summaries_fts ON summaries_fts.rowid = s.rowid
         WHERE summaries_fts MATCH ? AND s.session_id != ?
         ORDER BY b
         LIMIT 200`,
      )
      .all(ftsMatch, sessionId) as { sid: string; b: number }[];

    let rank = ftsRows.length;
    const seen = new Set<string>();
    for (const row of ftsRows) {
      if (seen.has(row.sid)) continue;
      seen.add(row.sid);
      ftsRank.set(row.sid, rank);
      rank -= 1;
    }
  }

  const candidateIds = new Set<string>([
    ...overlapMap.keys(),
    ...ftsRank.keys(),
  ]);
  candidateIds.delete(sessionId);

  if (candidateIds.size === 0) return [];

  const placeholders = [...candidateIds].map(() => '?').join(', ');
  const rows = db.sqlite
    .prepare(
      `SELECT s.* FROM summaries s
       INNER JOIN (
         SELECT session_id, MAX(created_at) AS max_c
         FROM summaries
         WHERE session_id IN (${placeholders})
         GROUP BY session_id
       ) latest ON latest.session_id = s.session_id AND latest.max_c = s.created_at
       ORDER BY s.created_at DESC`,
    )
    .all(...candidateIds) as Record<string, unknown>[];

  const scored = rows.map((row) => {
    const sid = String(row.session_id);
    const tagScore = (overlapMap.get(sid) ?? 0) * 10;
    const textScore = ftsRank.get(sid) ?? 0;
    return { row, score: tagScore + textScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit).map((s) => s.row);
  return db.hydrateSummaryRows(top);
}
