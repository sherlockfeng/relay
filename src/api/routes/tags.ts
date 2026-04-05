import { Router, type Request, type Response } from 'express';

import type { ChatDigestDB } from '../../storage/database.js';

export function createTagRoutes(db: ChatDigestDB): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(db.listTags());
  });

  router.get('/:name/summaries', (req: Request, res: Response) => {
    const name = decodeURIComponent(String(req.params.name));
    const summaries = db.getTagSummaries(name);
    res.json(summaries);
  });

  return router;
}
