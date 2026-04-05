import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { ToolUsage, UnifiedMessage, UnifiedTranscript } from '../types/index.js';

function parseJsonLine(line: string, lineIndex: number): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    console.warn(`[codex-parser] Skipping malformed JSON at line ${lineIndex + 1}`);
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function extractSessionIdFromFilename(filePath: string): string | undefined {
  const name = basename(filePath, '.jsonl');
  const m = name.match(
    /rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return m?.[1];
}

function codexContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const t =
      (typeof block.text === 'string' && block.text) ||
      (typeof block.input_text === 'string' && block.input_text) ||
      (typeof block.output_text === 'string' && block.output_text) ||
      '';
    if (t) parts.push(t);
  }
  return parts.join('\n');
}

function parseJsonArgs(args: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(args) as unknown;
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const FILE_TOOL_NAMES = new Set([
  'read_file',
  'write',
  'apply_patch',
  'edit',
  'str_replace',
  'multiedit',
]);

const ABS_IN_CMD_RE = /(?:\/[\w./+\-@%^()[\]{}]+|\b[A-Za-z]:\\(?:[^\\]|\\)+)/g;

function pathsFromShellCmd(cmd: string): string[] {
  const found: string[] = [];
  ABS_IN_CMD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABS_IN_CMD_RE.exec(cmd)) !== null) {
    const p = m[0].replace(/['"`]+$/, '').trim();
    if (p.length > 2 && /\.[a-z]{1,6}$/i.test(p)) found.push(p);
  }
  return found;
}

function filePathsFromCodexTool(name: string, argsRaw: string): string[] {
  const paths: string[] = [];
  const o = parseJsonArgs(argsRaw);
  if (!o) return paths;

  const push = (v: unknown) => {
    if (typeof v === 'string' && v.length) paths.push(v);
  };

  push(o.path);
  push(o.file_path);
  push(o.filePath);
  push(o.target_file);

  if (name === 'exec_command' || name === 'shell') {
    push(o.workdir);
    if (typeof o.cmd === 'string') paths.push(...pathsFromShellCmd(o.cmd));
  }

  if (name === 'apply_patch' && typeof o.patch === 'string') {
    const header = o.patch.split('\n').slice(0, 8).join('\n');
    const fm = header.match(/\*\*\* (?:Add|Update) File:\s*(.+)/);
    if (fm?.[1]) paths.push(fm[1].trim());
  }

  return paths;
}

function mapRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'user') return 'user';
  if (role === 'developer' || role === 'system') return 'system';
  return 'assistant';
}

/**
 * Parse a Codex rollout JSONL event log.
 * Path shape: ~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl
 */
export async function parseCodexTranscript(filePath: string): Promise<UnifiedTranscript> {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n');

  let sessionId = extractSessionIdFromFilename(filePath) ?? basename(filePath, '.jsonl');
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let gitCommit: string | undefined;
  let modelProvider: string | undefined;
  let cliVersion: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;

  const messages: UnifiedMessage[] = [];
  const toolsUsed: ToolUsage[] = [];
  const filesReferenced = new Set<string>();
  const callIdToTool = new Map<string, ToolUsage>();

  let lastAssistant: UnifiedMessage | undefined;

  const ensureAssistant = (timestamp?: string): UnifiedMessage => {
    if (lastAssistant?.role === 'assistant') return lastAssistant;
    const m: UnifiedMessage = { role: 'assistant', content: '', timestamp };
    messages.push(m);
    lastAssistant = m;
    return m;
  };

  const resetAssistantTurn = (): void => {
    lastAssistant = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const row = parseJsonLine(lines[i], i);
    if (!row || !isRecord(row)) continue;

    const ts = typeof row.timestamp === 'string' ? row.timestamp : undefined;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    const type = row.type;
    const payload = row.payload;

    if (type === 'session_meta' && isRecord(payload)) {
      if (typeof payload.id === 'string') sessionId = payload.id;
      if (typeof payload.cwd === 'string') cwd = payload.cwd;
      if (isRecord(payload.git)) {
        const g = payload.git as Record<string, unknown>;
        if (typeof g.branch === 'string') gitBranch = g.branch;
        if (typeof g.commit_hash === 'string') gitCommit = g.commit_hash;
      }
      if (typeof payload.model_provider === 'string') modelProvider = payload.model_provider;
      if (typeof payload.cli_version === 'string') cliVersion = payload.cli_version;
      continue;
    }

    if (type === 'turn_context' && isRecord(payload)) {
      if (typeof payload.cwd === 'string' && !cwd) cwd = payload.cwd;
      continue;
    }

    if (type === 'event_msg' && isRecord(payload)) {
      const pType = payload.type;
      if (pType === 'user_message' && typeof payload.message === 'string') {
        const last = messages[messages.length - 1];
        if (last?.role === 'user' && last.content === payload.message) continue;
        resetAssistantTurn();
        messages.push({
          role: 'user',
          content: payload.message,
          timestamp: ts,
        });
      }
      continue;
    }

    if (type === 'response_item' && isRecord(payload)) {
      const pType = payload.type;

      if (pType === 'message') {
        const roleRaw = typeof payload.role === 'string' ? payload.role : 'assistant';
        const role = mapRole(roleRaw);
        const text = codexContentToString(payload.content);

        if (role === 'assistant') {
          const um: UnifiedMessage = {
            role: 'assistant',
            content: text,
            timestamp: ts,
          };
          messages.push(um);
          lastAssistant = um;
        } else if (role === 'user') {
          resetAssistantTurn();
          messages.push({ role: 'user', content: text, timestamp: ts });
        } else {
          resetAssistantTurn();
          messages.push({ role: 'system', content: text, timestamp: ts });
        }
        continue;
      }

      if (pType === 'function_call') {
        const name = typeof payload.name === 'string' ? payload.name : 'unknown';
        const args = typeof payload.arguments === 'string' ? payload.arguments : stringifyArgs(payload.arguments);
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';

        const tu: ToolUsage = { name, input: args };
        if (callId) callIdToTool.set(callId, tu);
        toolsUsed.push(tu);

        const asst = ensureAssistant(ts);
        if (!asst.toolCalls) asst.toolCalls = [];
        asst.toolCalls.push(tu);

        for (const p of filePathsFromCodexTool(name, args)) filesReferenced.add(p);
        continue;
      }

      if (pType === 'function_call_output') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const output = typeof payload.output === 'string' ? payload.output : stringifyArgs(payload.output);
        const tu = callId ? callIdToTool.get(callId) : undefined;
        if (tu) tu.output = output;
        continue;
      }
    }
  }

  const startTime = firstTs ?? new Date().toISOString();
  const endTime = lastTs;

  return {
    id: sessionId,
    platform: 'codex',
    project: cwd,
    gitBranch,
    startTime,
    endTime,
    messages,
    toolsUsed,
    filesReferenced: [...filesReferenced].sort(),
    metadata: {
      sourcePath: filePath,
      gitCommit,
      modelProvider,
      cliVersion,
    },
  };
}

function stringifyArgs(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
