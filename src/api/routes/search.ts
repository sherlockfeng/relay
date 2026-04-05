import { Router, type Request, type Response } from 'express';

import type { ChatDigestDB } from '../../storage/database.js';
import { findSimilar, searchSummaries } from '../../storage/search.js';

function parseCommaList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLimit(raw: unknown, fallback: number): number {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : fallback;
}

export function createSearchRoutes(db: ChatDigestDB): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q.trim()) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }
    const tags = parseCommaList(req.query.tags);
    const limit = parseLimit(req.query.limit, 50);
    const results = searchSummaries(db, q, { tags, limit });
    res.json(results);
  });

  return router;
}

export function createSimilarRoutes(db: ChatDigestDB): Router {
  const router = Router();

  router.get('/:sessionId', (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit, 10);
    const results = findSimilar(db, String(req.params.sessionId), limit);
    res.json(results);
  });

  return router;
}
