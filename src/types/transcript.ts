export interface ToolUsage {
  name: string;
  input: string;
  output?: string;
}

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  toolCalls?: ToolUsage[];
}

export interface UnifiedTranscript {
  id: string;
  platform: 'cursor' | 'claude-code' | 'codex';
  project?: string;
  gitBranch?: string;
  startTime: string;
  endTime?: string;
  messages: UnifiedMessage[];
  toolsUsed: ToolUsage[];
  filesReferenced: string[];
  metadata: Record<string, unknown>;
}
