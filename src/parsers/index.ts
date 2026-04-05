import type { UnifiedTranscript } from '../types/index.js';

import { parseClaudeTranscript } from './claude-parser.js';
import { parseCodexTranscript } from './codex-parser.js';
import { parseCursorTranscript } from './cursor-parser.js';

export type Platform = UnifiedTranscript['platform'];

export { parseClaudeTranscript } from './claude-parser.js';
export { parseCodexTranscript } from './codex-parser.js';
export { parseCursorTranscript } from './cursor-parser.js';

/**
 * Detect transcript platform from absolute or relative file path segments.
 */
export function detectPlatform(filePath: string): Platform {
  const normalized = filePath.replace(/\\/g, '/');

  if (normalized.includes('/.codex/sessions/') && normalized.endsWith('.jsonl')) {
    return 'codex';
  }
  if (normalized.includes('/.claude/projects/') && normalized.endsWith('.jsonl')) {
    return 'claude-code';
  }
  if (normalized.includes('agent-transcripts/') && normalized.endsWith('.jsonl')) {
    return 'cursor';
  }

  throw new Error(`Cannot detect transcript platform from path: ${filePath}`);
}

/**
 * Parse a transcript file, auto-detecting the platform when omitted.
 */
export async function parseTranscript(
  filePath: string,
  platform?: Platform,
): Promise<UnifiedTranscript> {
  const p = platform ?? detectPlatform(filePath);
  switch (p) {
    case 'cursor':
      return parseCursorTranscript(filePath);
    case 'claude-code':
      return parseClaudeTranscript(filePath);
    case 'codex':
      return parseCodexTranscript(filePath);
    default: {
      const _exhaustive: never = p;
      throw new Error(`Unsupported platform: ${_exhaustive}`);
    }
  }
}
