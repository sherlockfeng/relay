import { Router, type Request, type Response } from 'express';

import type { ChatDigestDB } from '../../storage/database.js';
import type { Platform, SessionStatus } from '../../types/index.js';

const STATUSES: SessionStatus[] = ['active', 'idle', 'completed'];
const PLATFORMS: Platform[] = ['cursor', 'claude-code', 'codex'];

function parseStatus(raw: unknown): SessionStatus | undefined {
  if (typeof raw !== 'string' || !STATUSES.includes(raw as SessionStatus)) {
    return undefined;
  }
  return raw as SessionStatus;
}

function parsePlatform(raw: unknown): Platform | undefined {
  if (typeof raw !== 'string' || !PLATFORMS.includes(raw as Platform)) {
    return undefined;
  }
  return raw as Platform;
}

export function createSessionRoutes(db: ChatDigestDB): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const status = parseStatus(req.query.status);
    const platform = parsePlatform(req.query.platform);
    const filters =
      status !== undefined || platform !== undefined
        ? { ...(status !== undefined ? { status } : {}), ...(platform !== undefined ? { platform } : {}) }
        : undefined;
    res.json(db.listSessions(filters));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const session = db.getSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  return router;
}
