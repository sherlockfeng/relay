export interface Requirement {
  id: string;
  name: string;
  purpose?: string;
  context: string;
  summary?: string;
  relatedDocs?: string[];
  changes?: string[];
  tags?: string[];
  projectPath?: string;
  status: 'draft' | 'confirmed';
  createdAt: string;
  updatedAt: string;
}

/** Mirrors backend `TrackedSession`. */
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

export interface WsInitMessage {
  type: 'init';
  payload: { sessions: TrackedSession[] };
}

export interface ChatSummary {
  title: string;
  topics: string[];
  tags: string[];
  contextProvided: {
    internalTools: string[];
    internalDefinitions: string[];
    externalResources: string[];
  };
  discussionProcess: string[];
  problemsDiscovered: string[];
  decidedSolutions: string[];
  domainKnowledge: {
    projectOverview?: string;
    targetUsers?: string;
    userFlows?: string[];
    techStack?: string[];
    keyTerms?: Record<string, string>;
  };
  actionItems?: string[];
}

export interface StoredSummary extends ChatSummary {
  id: string;
  sessionId: string;
  rawSummary: string;
  createdAt: string;
  modelUsed: string;
}

export interface TagRow {
  id: number;
  name: string;
  color?: string;
  count?: number;
}
