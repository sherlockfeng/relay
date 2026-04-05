import { Router, type Request, type Response } from 'express';

import type { ChatDigestDB } from '../../storage/database.js';
import type { Platform, StoredSummary } from '../../types/index.js';

const PLATFORMS: Platform[] = ['cursor', 'claude-code', 'codex'];

function parsePlatform(raw: unknown): Platform | undefined {
  if (typeof raw !== 'string' || !PLATFORMS.includes(raw as Platform)) {
    return undefined;
  }
  return raw as Platform;
}

function parseCommaList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getSummaryById(db: ChatDigestDB, id: string): StoredSummary | undefined {
  const row = db.sqlite
    .prepare(`SELECT * FROM summaries WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return undefined;
  }
  return db.hydrateSummaryRows([row])[0];
}

export function createSummaryRoutes(db: ChatDigestDB): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const tags = parseCommaList(req.query.tags);
    const platform = parsePlatform(req.query.platform);
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
    const filters =
      tags !== undefined || platform !== undefined || dateFrom !== undefined || dateTo !== undefined
        ? {
            ...(tags !== undefined ? { tags } : {}),
            ...(platform !== undefined ? { platform } : {}),
            ...(dateFrom !== undefined ? { dateFrom } : {}),
            ...(dateTo !== undefined ? { dateTo } : {}),
          }
        : undefined;
    res.json(db.listSummaries(filters));
  });

  router.patch('/:id/tags', (req: Request, res: Response) => {
    const summary = getSummaryById(db, String(req.params.id));
    if (!summary) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    const body = req.body as { tags?: unknown };
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
      res.status(400).json({ error: 'Body must be { tags: string[] }' });
      return;
    }
    const tagNames = body.tags.map((t) => t.trim()).filter(Boolean);
    db.sqlite.prepare(`DELETE FROM session_tags WHERE session_id = ?`).run(summary.sessionId);
    if (tagNames.length > 0) {
      db.addSessionTags(summary.sessionId, tagNames);
    }
    const updated = getSummaryById(db, String(req.params.id));
    res.json(updated);
  });

  router.post('/:id/regenerate', (req: Request, res: Response) => {
    const summary = getSummaryById(db, String(req.params.id));
    if (!summary) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    res.status(202).json({
      accepted: true,
      message: 'Re-summarization is not implemented yet',
      summaryId: summary.id,
      sessionId: summary.sessionId,
    });
  });

  router.get('/:id', (req: Request, res: Response) => {
    const summary = getSummaryById(db, String(req.params.id));
    if (!summary) {
      res.status(404).json({ error: 'Summary not found' });
      return;
    }
    res.json(summary);
  });

  return router;
}
