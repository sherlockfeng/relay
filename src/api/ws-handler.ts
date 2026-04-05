import type { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';

import type { ChatDigestDB } from '../storage/database.js';
import type { SessionEvent } from '../types/index.js';

/** Initial message sent to new WebSocket clients (not a {@link SessionEvent}). */
export interface WsInitMessage {
  type: 'init';
  payload: { sessions: ReturnType<ChatDigestDB['listSessions']> };
}

export function attachWebSocketHandlers(wss: WebSocketServer, db: ChatDigestDB): void {
  wss.on('connection', (ws) => {
    const sessions = db.listSessions({ status: 'active' });
    const init: WsInitMessage = { type: 'init', payload: { sessions } };
    ws.send(JSON.stringify(init));
  });
}

/** Broadcast a JSON-serializable value to all open WebSocket clients. */
export function broadcastJson(wss: WebSocketServer, data: unknown): void {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/** Broadcast a {@link SessionEvent} to all connected clients. */
export function broadcastSessionEvent(wss: WebSocketServer, event: SessionEvent): void {
  broadcastJson(wss, event);
}
