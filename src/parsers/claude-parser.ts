import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import type { ToolUsage, UnifiedMessage, UnifiedTranscript } from '../types/index.js';

function parseJsonLine(line: string, lineIndex: number): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    console.warn(`[claude-parser] Skipping malformed JSON at line ${lineIndex + 1}`);
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function stringifyInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function toolResultToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (isRecord(c) && typeof c.text === 'string') return c.text;
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .join('\n');
  }
  if (isRecord(content) && typeof content.text === 'string') return content.text;
  return stringifyInput(content);
}

function filePathsFromToolInput(name: string, input: unknown): string[] {
  const paths: string[] = [];
  if (input === null || typeof input !== 'object') return paths;
  const o = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'target_file', 'filePath']) {
    const v = o[key];
    if (typeof v === 'string' && v.length) paths.push(v);
  }
  return paths;
}

/** Best-effort decode of ~/.claude/projects/<dir> segment (slashes → hyphens). */
function decodeClaudeProjectDir(encoded: string): string {
  const s = encoded.startsWith('-') ? encoded.slice(1) : encoded;
  const projectsMarker = '-projects-';
  const projectsIdx = s.indexOf(projectsMarker);
  if (s.startsWith('Users-') && projectsIdx > 0) {
    const user = s.slice('Users-'.length, projectsIdx);
    const rest = s.slice(projectsIdx + projectsMarker.length);
    return `/Users/${user}/projects/${rest}`;
  }
  if (s.startsWith('Users-')) {
    const user = s.slice('Users-'.length);
    return `/Users/${user}`;
  }
  return `/${s.replace(/-/g, '/')}`;
}

/**
 * Parse a Claude Code JSONL transcript.
 * Path shape: ~/.claude/projects/<encoded-path>/<sessionId>.jsonl
 */
export async function parseClaudeTranscript(filePath: string): Promise<UnifiedTranscript> {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n');

  const sessionIdFromName = basename(filePath, '.jsonl');
  const encodedProjectDir = basename(dirname(filePath));
  const decodedProjectPath = decodeClaudeProjectDir(encodedProjectDir);

  const messages: UnifiedMessage[] = [];
  const toolByCallId = new Map<string, ToolUsage>();
  const orphanTools: ToolUsage[] = [];
  const filesReferenced = new Set<string>();

  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let version: string | undefined;
  let sessionId = sessionIdFromName;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  const recordTool = (tu: ToolUsage): void => {
    orphanTools.push(tu);
  };

  for (let i = 0; i < lines.length; i++) {
    const row = parseJsonLine(lines[i], i);
    if (!row || !isRecord(row)) continue;

    const type = row.type;
    if (type === 'queue-operation') continue;

    if (typeof row.sessionId === 'string') sessionId = row.sessionId;
    if (typeof row.gitBranch === 'string') gitBranch = row.gitBranch;
    if (typeof row.cwd === 'string') cwd = row.cwd;
    if (typeof row.version === 'string') version = row.version;

    const ts = typeof row.timestamp === 'string' ? row.timestamp : undefined;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
    }

    if (type === 'user') {
      const msg = row.message;
      if (!isRecord(msg)) continue;
      const content = msg.content;
      const parts: string[] = [];
      const toolCallsForMessage: ToolUsage[] = [];

      if (typeof content === 'string') {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === 'tool_result') {
            const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
            const out = toolResultToString(block.content);
            const existing = id ? toolByCallId.get(id) : undefined;
            if (existing) {
              existing.output = out;
            } else {
              toolCallsForMessage.push({
                name: 'tool_result',
                input: id,
                output: out,
              });
            }
          } else if (typeof block.text === 'string') {
            parts.push(block.text);
          }
        }
      }

      const unified: UnifiedMessage = {
        role: 'user',
        content: parts.join('\n').trim() || (toolCallsForMessage.length ? '[tool results]' : ''),
        timestamp: ts,
        toolCalls: toolCallsForMessage.length ? toolCallsForMessage : undefined,
      };
      messages.push(unified);
      continue;
    }

    if (type === 'assistant') {
      const msg = row.message;
      if (!isRecord(msg)) continue;
      const content = msg.content;
      const textParts: string[] = [];
      const toolCalls: ToolUsage[] = [];

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue;
          const btype = block.type;
          if (btype === 'text' && typeof block.text === 'string') {
            textParts.push(block.text);
          } else if (btype === 'tool_use') {
            const name = typeof block.name === 'string' ? block.name : 'unknown';
            const input = block.input;
            const id = typeof block.id === 'string' ? block.id : '';
            const tu: ToolUsage = { name, input: stringifyInput(input) };
            toolCalls.push(tu);
            if (id) {
              toolByCallId.set(id, { ...tu });
            } else {
              recordTool({ ...tu });
            }
            for (const p of filePathsFromToolInput(name, input)) {
              if (['Read', 'Edit', 'Write'].includes(name)) filesReferenced.add(p);
            }
          }
        }
      }

      const unified: UnifiedMessage = {
        role: 'assistant',
        content: textParts.join('\n').trim() || (toolCalls.length ? `[${toolCalls.map((t) => t.name).join(', ')}]` : ''),
        timestamp: ts,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
      messages.push(unified);
    }
  }

  const toolsUsed: ToolUsage[] = [...toolByCallId.values(), ...orphanTools];
  const dedupeKey = new Set<string>();
  const toolsUsedUnique = toolsUsed.filter((t) => {
    const k = `${t.name}\0${t.input}\0${t.output ?? ''}`;
    if (dedupeKey.has(k)) return false;
    dedupeKey.add(k);
    return true;
  });

  const startTime = firstTimestamp ?? new Date().toISOString();
  const endTime = lastTimestamp;

  return {
    id: sessionId,
    platform: 'claude-code',
    project: cwd ?? decodedProjectPath,
    gitBranch,
    startTime,
    endTime,
    messages,
    toolsUsed: toolsUsedUnique,
    filesReferenced: [...filesReferenced].sort(),
    metadata: {
      sourcePath: filePath,
      encodedProjectDir,
      decodedProjectPath,
      claudeVersion: version,
    },
  };
}
