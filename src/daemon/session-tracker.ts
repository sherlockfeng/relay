import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type { Platform, SessionStatus } from '../types/index.js';

const IDLE_MS = 30_000;
const COMPLETED_MS = 120_000;

/** Internal row; timers are not exposed from `getActiveSessions`. */
export interface TrackedFileSession {
  sessionId: string;
  platform: Platform;
  status: SessionStatus;
  /** Idle transition (30s since last write). */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Completed transition (2m since last write). */
  completedTimer: ReturnType<typeof setTimeout> | null;
  lastActive: number;
  messageCount: number;
}

export type ActiveSessionView = Pick<
  TrackedFileSession,
  'sessionId' | 'platform' | 'status' | 'lastActive' | 'messageCount'
> & { filePath: string };

export interface SessionStartedPayload {
  filePath: string;
  platform: Platform;
  sessionId: string;
}

export interface SessionLifecyclePayload {
  filePath: string;
  platform: Platform;
  sessionId: string;
}

export class SessionTracker extends EventEmitter {
  private readonly sessions = new Map<string, TrackedFileSession>();

  private clearTimers(entry: TrackedFileSession): void {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.completedTimer !== null) {
      clearTimeout(entry.completedTimer);
      entry.completedTimer = null;
    }
  }

  private scheduleTimers(filePath: string, entry: TrackedFileSession): void {
    this.clearTimers(entry);

    entry.idleTimer = setTimeout(() => {
      const current = this.sessions.get(filePath);
      if (!current || current.sessionId !== entry.sessionId) {
        return;
      }
      if (current.status === 'completed') {
        return;
      }
      current.status = 'idle';
      const idlePayload: SessionLifecyclePayload = {
        filePath,
        platform: current.platform,
        sessionId: current.sessionId,
      };
      this.emit('session:idle', idlePayload);
    }, IDLE_MS);

    entry.completedTimer = setTimeout(() => {
      const current = this.sessions.get(filePath);
      if (!current || current.sessionId !== entry.sessionId) {
        return;
      }
      current.status = 'completed';
      this.clearTimers(current);
      const completedPayload: SessionLifecyclePayload = {
        filePath,
        platform: current.platform,
        sessionId: current.sessionId,
      };
      this.emit('session:completed', completedPayload);
      this.sessions.delete(filePath);
    }, COMPLETED_MS);
  }

  trackFile(filePath: string, platform: Platform): void {
    const existing = this.sessions.get(filePath);
    if (existing) {
      this.handleFileChange(filePath);
      return;
    }

    const sessionId = randomUUID();
    const entry: TrackedFileSession = {
      sessionId,
      platform,
      status: 'active',
      idleTimer: null,
      completedTimer: null,
      lastActive: Date.now(),
      messageCount: 0,
    };
    this.sessions.set(filePath, entry);

    const started: SessionStartedPayload = { filePath, platform, sessionId };
    this.emit('session:started', started);
    this.handleFileChange(filePath);
  }

  handleFileChange(filePath: string): void {
    let entry = this.sessions.get(filePath);
    if (!entry) {
      return;
    }

    entry.status = 'active';
    entry.lastActive = Date.now();
    entry.messageCount += 1;
    this.scheduleTimers(filePath, entry);
  }

  getActiveSessions(): ActiveSessionView[] {
    return [...this.sessions.entries()].map(([filePath, s]) => ({
      filePath,
      sessionId: s.sessionId,
      platform: s.platform,
      status: s.status,
      lastActive: s.lastActive,
      messageCount: s.messageCount,
    }));
  }

  dispose(): void {
    for (const [, entry] of this.sessions) {
      this.clearTimers(entry);
    }
    this.sessions.clear();
  }
}
