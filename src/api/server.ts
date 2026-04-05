import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';

import type { ChatDigestDB } from '../storage/database.js';
import type { SessionEvent } from '../types/index.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSummaryRoutes } from './routes/summaries.js';
import { createTagRoutes } from './routes/tags.js';
import { createSearchRoutes, createSimilarRoutes } from './routes/search.js';
import { attachWebSocketHandlers, broadcastSessionEvent } from './ws-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function webDistPath(): string {
  return join(__dirname, '../../web/dist');
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

export interface ApiServer {
  app: Express;
  httpServer: HttpServer;
  wss: WebSocketServer;
}

export function createApiServer(db: ChatDigestDB, _port: number): ApiServer {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json());

  app.use('/api/sessions', createSessionRoutes(db));
  app.use('/api/summaries', createSummaryRoutes(db));
  app.use('/api/tags', createTagRoutes(db));
  app.use('/api/search', createSearchRoutes(db));
  app.use('/api/similar', createSimilarRoutes(db));

  const dist = webDistPath();
  if (existsSync(dist)) {
    app.use(express.static(dist));
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  attachWebSocketHandlers(wss, db);

  return { app, httpServer, wss };
}

export function broadcastEvent(wss: WebSocketServer, event: SessionEvent): void {
  broadcastSessionEvent(wss, event);
}
