export type SessionStatus = 'active' | 'idle' | 'completed';
export type Platform = 'cursor' | 'claude-code' | 'codex';

export interface TrackedSession {
  id: string;
  platform: Platform;
  projectPath?: string;
  gitBranch?: string;
  transcriptPath: string;
  status: SessionStatus;
  messageCount: number;
  firstMessage?: string;
  startedAt: string;
  lastActiveAt?: string;
  completedAt?: string;
  summarized: boolean;
}

export interface SessionEvent {
  type: 'session:started' | 'session:updated' | 'session:idle' | 'session:completed' | 'summary:ready';
  payload: Record<string, unknown>;
}
