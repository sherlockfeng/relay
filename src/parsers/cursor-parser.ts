import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import type { ToolUsage, UnifiedMessage, UnifiedTranscript } from '../types/index.js';

const CURSOR_TAG_NAMES = [
  'user_query',
  'attached_files',
  'external_links',
  'manually_attached_skills',
  'open_and_recently_viewed_files',
  'code_selection',
  'system_reminder',
] as const;

function parseJsonLine(line: string, lineIndex: number): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    console.warn(`[cursor-parser] Skipping malformed JSON at line ${lineIndex + 1}`);
    return undefined;
  }
}

function extractTagBodies(text: string, tag: string): string[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(open, i);
    if (start === -1) break;
    const contentStart = start + open.length;
    const end = text.indexOf(close, contentStart);
    if (end === -1) break;
    out.push(text.slice(contentStart, end).trim());
    i = end + close.length;
  }
  return out;
}

/** Paths that look like absolute filesystem paths (Unix + Windows drive). */
const ABS_PATH_RE = /(?:\/[\w./+\-@%^()[\]{}]+|\b[A-Za-z]:\\(?:[^\\]|\\)+)/g;

function collectPathsFromText(text: string, into: Set<string>): void {
  ABS_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ABS_PATH_RE.exec(text)) !== null) {
    const p = m[0].replace(/\\+$/, '').trim();
    if (p.length > 2 && !p.endsWith('.')) into.add(p);
  }
}

function extractCursorContext(
  text: string,
  metadata: Record<string, unknown>,
  filesReferenced: Set<string>,
): void {
  const userQueries: string[] = [];
  for (const body of extractTagBodies(text, 'user_query')) {
    if (body) userQueries.push(body);
  }
  if (userQueries.length) metadata.userQueries = userQueries;

  const toolMentions = new Set<string>();
  const toolUseRe = /"name"\s*:\s*"([^"]+)"/g;
  let tm: RegExpExecArray | null;
  while ((tm = toolUseRe.exec(text)) !== null) {
    toolMentions.add(tm[1]);
  }
  if (toolMentions.size) metadata.toolMentions = [...toolMentions];

  for (const tag of CURSOR_TAG_NAMES) {
    if (tag === 'user_query') continue;
    for (const body of extractTagBodies(text, tag)) {
      collectPathsFromText(body, filesReferenced);
    }
  }
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

function filePathsFromToolInput(name: string, input: unknown): string[] {
  const paths: string[] = [];
  if (input === null || typeof input !== 'object') return paths;
  const o = input as Record<string, unknown>;
  const candidates = ['path', 'file_path', 'target_file', 'filePath'];
  for (const key of candidates) {
    const v = o[key];
    if (typeof v === 'string' && v.length) paths.push(v);
  }
  if (name === 'StrReplace' && typeof o.path === 'string') paths.push(o.path);
  return paths;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function contentBlocksFromMessage(msg: unknown): unknown[] {
  if (!isRecord(msg)) return [];
  const inner = msg.message;
  if (!isRecord(inner)) return [];
  const content = inner.content;
  return Array.isArray(content) ? content : [];
}

/**
 * Parse a Cursor agent JSONL transcript.
 * Path shape: .../.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
 */
export async function parseCursorTranscript(filePath: string): Promise<UnifiedTranscript> {
  const [raw, st] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
  const lines = raw.split('\n');

  const sessionId = basename(dirname(filePath));
  const projectsDir = dirname(dirname(dirname(filePath)));
  const slug = basename(projectsDir);

  const messages: UnifiedMessage[] = [];
  const toolsUsed: ToolUsage[] = [];
  const toolsKey = new Set<string>();
  const filesReferenced = new Set<string>();

  const metadata: Record<string, unknown> = {
    sourcePath: filePath,
    projectSlug: slug,
  };

  for (let i = 0; i < lines.length; i++) {
    const row = parseJsonLine(lines[i], i);
    if (!row || !isRecord(row)) continue;

    const role = row.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const blocks = contentBlocksFromMessage(row);
    const textParts: string[] = [];
    const toolCalls: ToolUsage[] = [];

    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const type = block.type;
      if (type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
        extractCursorContext(block.text, metadata, filesReferenced);
      } else if (type === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        const input = block.input;
        const tu: ToolUsage = { name, input: stringifyInput(input) };
        toolCalls.push(tu);
        const key = `${name}\0${tu.input}`;
        if (!toolsKey.has(key)) {
          toolsKey.add(key);
          toolsUsed.push({ ...tu });
        }
        for (const p of filePathsFromToolInput(name, input)) filesReferenced.add(p);
      }
    }

    const content = textParts.join('\n').trim();
    const um: UnifiedMessage = {
      role,
      content: content || (toolCalls.length ? `[${toolCalls.map((t) => t.name).join(', ')}]` : ''),
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
    messages.push(um);
  }

  const startTime = st.birthtime.toISOString();
  const endTime = st.mtime.toISOString();

  return {
    id: sessionId,
    platform: 'cursor',
    project: slug,
    gitBranch: undefined,
    startTime,
    endTime,
    messages,
    toolsUsed,
    filesReferenced: [...filesReferenced].sort(),
    metadata,
  };
}
