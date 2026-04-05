import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionEvent, TrackedSession, WsInitMessage } from '../types';

const WS_PATH = '/ws';
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1000;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${WS_PATH}`;
}

function isInitMessage(data: unknown): data is WsInitMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as WsInitMessage).type === 'init' &&
    typeof (data as WsInitMessage).payload === 'object' &&
    (data as WsInitMessage).payload !== null &&
    Array.isArray((data as WsInitMessage).payload.sessions)
  );
}

const SESSION_EVENT_TYPES: SessionEvent['type'][] = [
  'session:started',
  'session:updated',
  'session:idle',
  'session:completed',
  'summary:ready',
];

function isSessionEvent(data: unknown): data is SessionEvent {
  if (typeof data !== 'object' || data === null) return false;
  const t = (data as { type?: string }).type;
  const p = (data as { payload?: unknown }).payload;
  return (
    typeof t === 'string' &&
    SESSION_EVENT_TYPES.includes(t as SessionEvent['type']) &&
    typeof p === 'object' &&
    p !== null
  );
}

async function fetchSessions(): Promise<TrackedSession[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error(`sessions ${res.status}`);
  return (await res.json()) as TrackedSession[];
}

export interface UseWebSocketResult {
  sessions: TrackedSession[];
  lastEvent: SessionEvent | null;
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
}

/**
 * Connects through the Vite dev proxy to the API WebSocket, receives {@link SessionEvent}
 * payloads, applies `init` snapshots, and keeps the socket open with exponential backoff.
 */
export function useWebSocket(): UseWebSocketResult {
  const [sessions, setSessions] = useState<TrackedSession[]>([]);
  const [lastEvent, setLastEvent] = useState<SessionEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

  const refreshSessions = useCallback(() => {
    void fetchSessions()
      .then(setSessions)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to refresh sessions');
      });
  }, []);

  useEffect(() => {
    intentionalCloseRef.current = false;

    const connect = () => {
      if (intentionalCloseRef.current) return;

      try {
        const ws = new WebSocket(wsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setReconnecting(false);
          setError(null);
          backoffRef.current = INITIAL_BACKOFF_MS;
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (intentionalCloseRef.current) return;
          setReconnecting(true);
          const delay = backoffRef.current;
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
          reconnectTimerRef.current = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          setError('WebSocket error');
        };

        ws.onmessage = (ev) => {
          try {
            const data: unknown = JSON.parse(ev.data as string);
            if (isInitMessage(data)) {
              setSessions(data.payload.sessions);
              return;
            }
            if (isSessionEvent(data)) {
              setLastEvent(data);
              refreshSessions();
              return;
            }
          } catch {
            setError('Invalid WebSocket message');
          }
        };
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'WebSocket connect failed');
        setReconnecting(true);
        reconnectTimerRef.current = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      }
    };

    connect();

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [refreshSessions]);

  return { sessions, lastEvent, connected, error, reconnecting };
}
