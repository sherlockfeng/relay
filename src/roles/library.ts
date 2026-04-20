import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { AgentForgeDB, Role, KnowledgeChunk } from '../storage/database.js';
import { PRODUCT_SYSTEM_PROMPT } from './builtin/product.js';
import { DEVELOPER_SYSTEM_PROMPT } from './builtin/developer.js';
import { TESTER_SYSTEM_PROMPT } from './builtin/tester.js';

const BUILTIN_ROLES: Omit<Role, 'createdAt'>[] = [
  {
    id: 'product',
    name: 'Product Agent',
    systemPrompt: PRODUCT_SYSTEM_PROMPT,
    docPath: 'docs/roles/product.md',
    isBuiltin: true,
  },
  {
    id: 'developer',
    name: 'Developer Agent',
    systemPrompt: DEVELOPER_SYSTEM_PROMPT,
    docPath: 'docs/roles/developer.md',
    isBuiltin: true,
  },
  {
    id: 'tester',
    name: 'Test Agent',
    systemPrompt: TESTER_SYSTEM_PROMPT,
    docPath: 'docs/roles/tester.md',
    isBuiltin: true,
  },
];

export function seedBuiltinRoles(db: AgentForgeDB): void {
  const now = new Date().toISOString();
  for (const r of BUILTIN_ROLES) {
    db.upsertRole({ ...r, createdAt: now });
  }
}

export function getRole(db: AgentForgeDB, roleId: string): Role {
  const role = db.getRole(roleId);
  if (!role) throw new Error(`Role not found: ${roleId}`);
  return role;
}

export function listRoles(db: AgentForgeDB): Role[] {
  return db.listRoles();
}

export interface TrainRoleInput {
  roleId: string;
  name: string;
  documents: Array<{ filename: string; content: string }>;
  baseSystemPrompt?: string;
  embedFn: (text: string) => Promise<Float32Array>;
}

export async function trainRole(db: AgentForgeDB, input: TrainRoleInput): Promise<Role> {
  const now = new Date().toISOString();
  const existing = db.getRole(input.roleId);

  const systemPrompt = input.baseSystemPrompt ??
    existing?.systemPrompt ??
    `You are a specialized expert agent with deep knowledge of ${input.name}. Use your knowledge base to answer questions and assist with tasks related to this domain.`;

  db.upsertRole({
    id: input.roleId,
    name: input.name,
    systemPrompt,
    isBuiltin: false,
    createdAt: now,
  });

  db.deleteChunksForRole(input.roleId);

  for (const doc of input.documents) {
    const chunks = chunkDocument(doc.content, doc.filename);
    for (const chunk of chunks) {
      const embedding = await input.embedFn(chunk.text);
      const c: KnowledgeChunk = {
        id: randomUUID(),
        roleId: input.roleId,
        sourceFile: doc.filename,
        chunkText: chunk.text,
        embedding,
        createdAt: now,
      };
      db.insertChunk(c);
    }
  }

  return db.getRole(input.roleId)!;
}

export interface KnowledgeSearchResult {
  chunkText: string;
  sourceFile?: string;
  score: number;
}

export async function searchKnowledge(
  db: AgentForgeDB,
  roleId: string,
  query: string,
  embedFn: (text: string) => Promise<Float32Array>,
  topK = 5,
): Promise<KnowledgeSearchResult[]> {
  const chunks = db.getChunksForRole(roleId);
  if (chunks.length === 0) return [];

  const queryVec = await embedFn(query);

  const scored = chunks
    .filter((c) => c.embedding != null)
    .map((c) => ({
      chunkText: c.chunkText,
      sourceFile: c.sourceFile,
      score: cosineSimilarity(queryVec, c.embedding!),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

function chunkDocument(content: string, filename: string): Array<{ text: string }> {
  const CHUNK_SIZE = 800;
  const OVERLAP = 100;
  const lines = content.split('\n');
  const chunks: Array<{ text: string }> = [];
  let buffer: string[] = [];
  let bufLen = 0;

  for (const line of lines) {
    buffer.push(line);
    bufLen += line.length + 1;
    if (bufLen >= CHUNK_SIZE) {
      chunks.push({ text: `[${filename}]\n${buffer.join('\n')}` });
      const overlapLines: string[] = [];
      let overlapLen = 0;
      for (let i = buffer.length - 1; i >= 0 && overlapLen < OVERLAP; i--) {
        overlapLines.unshift(buffer[i]);
        overlapLen += buffer[i].length + 1;
      }
      buffer = overlapLines;
      bufLen = overlapLen;
    }
  }
  if (buffer.length > 0) {
    chunks.push({ text: `[${filename}]\n${buffer.join('\n')}` });
  }
  return chunks;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
