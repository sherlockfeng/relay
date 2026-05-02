import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { AgentForgeDB } from '../storage/database.js';
import { getRole } from '../roles/library.js';
import { searchKnowledge } from '../roles/library.js';
import type { AppConfig } from '../config.js';
import type { SDKAgent } from '@cursor/sdk';

export interface SpawnAgentInput {
  roleId: string;
  prompt: string;
  context?: string;
  tools?: Anthropic.Messages.Tool[];
  provider?: 'anthropic' | 'cursor';
  sessionId?: string;
}

export interface SpawnAgentResult {
  text: string;
  toolCalls: Array<{ name: string; input: unknown; result?: unknown }>;
  stopReason: string;
}

export interface CursorAgentOptions {
  apiKey: string;
  model: string;
  workspacePath: string;
}

export interface CursorAgentLike {
  id: string;
  send(prompt: string): Promise<string>;
}

export interface CursorRuntime {
  create(options: CursorAgentOptions): Promise<CursorAgentLike>;
  resume(agentId: string, options: CursorAgentOptions): Promise<CursorAgentLike>;
}

export interface AgentSpawnerDeps {
  cursorRuntime?: CursorRuntime;
}

export class AgentSpawner {
  private client: Anthropic;
  private cursorRuntime: CursorRuntime;

  constructor(
    private readonly db: AgentForgeDB,
    private readonly config: AppConfig,
    deps: AgentSpawnerDeps = {},
  ) {
    this.client = new Anthropic({ apiKey: config.llm.apiKey });
    this.cursorRuntime = deps.cursorRuntime ?? new CursorSdkRuntime();
  }

  async spawnAgent(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    if (input.provider !== 'anthropic') {
      return this.spawnViaCursor(input);
    }
    if (this.config.spawner.mode === 'cli') {
      return this.spawnViaCli(input);
    }
    return this.spawnViaSdk(input);
  }

  private async spawnViaSdk(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    const role = getRole(this.db, input.roleId);

    // Inject all knowledge chunks directly — full context is more reliable than top-5 RAG
    // for small knowledge bases (< ~100 chunks). Falls back to RAG for larger bases.
    const chunks = this.db.getChunksForRole(input.roleId);
    let knowledgeContext = '';
    if (chunks.length > 0 && chunks.length <= 80) {
      knowledgeContext = chunks
        .map((c) => `Source: ${c.sourceFile ?? 'unknown'}\n${c.chunkText}`)
        .join('\n\n---\n\n');
    } else if (chunks.length > 80) {
      knowledgeContext = await this.buildKnowledgeContext(input.roleId, input.prompt);
    }

    const systemParts = [role.systemPrompt];
    if (knowledgeContext) {
      systemParts.push(`\n\n## Knowledge Base\n${knowledgeContext}`);
    }
    if (input.context) {
      systemParts.push(`\n\n## Additional Context\n${input.context}`);
    }

    // Retry up to 3 times on 5xx / network errors with exponential backoff
    const MAX_RETRIES = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        const stream = await this.client.messages.stream({
          model: this.config.llm.model,
          system: systemParts.join(''),
          messages: [{ role: 'user', content: input.prompt }],
          tools: input.tools ?? [],
          max_tokens: 4096,
        });

        const toolCalls: SpawnAgentResult['toolCalls'] = [];
        let fullText = '';

        for await (const event of stream) {
          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              fullText += event.delta.text;
            }
          }
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              toolCalls.push({
                name: event.content_block.name,
                input: event.content_block.input,
              });
            }
          }
        }

        const finalMessage = await stream.finalMessage();
        return {
          text: fullText,
          toolCalls,
          stopReason: finalMessage.stop_reason ?? 'end_turn',
        };
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        // Only retry on server-side / transient errors (5xx)
        if (status && status < 500) throw err;
        lastErr = err;
        console.warn(`[spawner] attempt ${attempt + 1} failed (status=${status}), retrying…`);
      }
    }
    throw lastErr;
  }

  private async spawnViaCursor(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    if (!input.sessionId) {
      throw new Error('sessionId is required when provider is "cursor"');
    }
    const cursorConfig = this.getCursorConfig();
    if (!cursorConfig.apiKey) {
      throw new Error('Cursor provider requires cursor.apiKey in ~/.relay/config.json or CURSOR_API_KEY');
    }

    const role = getRole(this.db, input.roleId);
    const options: CursorAgentOptions = {
      apiKey: cursorConfig.apiKey,
      model: cursorConfig.model,
      workspacePath: cursorConfig.workspacePath,
    };

    const existing = this.db.getAgentSession('cursor', input.roleId, input.sessionId);
    let agent: CursorAgentLike;
    if (existing) {
      agent = await this.cursorRuntime.resume(existing.externalId, options);
    } else {
      agent = await this.cursorRuntime.create(options);
      await agent.send(this.buildCursorInitializationPrompt(input.roleId, role.systemPrompt, input.context));
      const now = new Date().toISOString();
      this.db.upsertAgentSession({
        provider: 'cursor',
        roleId: input.roleId,
        sessionId: input.sessionId,
        externalId: agent.id,
        createdAt: now,
        updatedAt: now,
      });
    }

    const text = await agent.send(input.prompt);
    return { text, toolCalls: [], stopReason: 'end_turn' };
  }

  private spawnViaCli(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    const role = getRole(this.db, input.roleId);
    return new Promise((resolve, reject) => {
      const args = ['-p', input.prompt, '--system', role.systemPrompt];
      const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
          return;
        }
        resolve({ text: stdout, toolCalls: [], stopReason: 'end_turn' });
      });
      child.on('error', (err) => {
        if (this.config.spawner.fallbackToCli === false) {
          reject(err);
          return;
        }
        reject(new Error(`claude CLI not found. Install Claude Code or set spawner.mode to "sdk".`));
      });
    });
  }

  private async buildKnowledgeContext(roleId: string, query: string): Promise<string> {
    const chunks = this.db.getChunksForRole(roleId);
    if (chunks.length === 0) return '';

    const embedFn = async (text: string): Promise<Float32Array> => {
      // Use a simple hash-based pseudo-embedding when no dedicated embedding model is configured.
      // For production use, replace with a real embedding API call.
      if (this.config.llm.embeddingModel) {
        return this.callEmbeddingApi(text);
      }
      return hashEmbed(text);
    };

    const results = await searchKnowledge(this.db, roleId, query, embedFn, 5);
    if (results.length === 0) return '';

    return results
      .map((r) => `Source: ${r.sourceFile ?? 'unknown'}\n${r.chunkText}`)
      .join('\n\n---\n\n');
  }

  private buildFullKnowledgeContext(roleId: string): string {
    const chunks = this.db.getChunksForRole(roleId);
    return chunks
      .map((c) => `Source: ${c.sourceFile ?? 'unknown'}\n${c.chunkText}`)
      .join('\n\n---\n\n');
  }

  private buildCursorInitializationPrompt(roleId: string, systemPrompt: string, context?: string): string {
    const sections = [
      `You are being initialized as the Relay expert role "${roleId}".`,
      `## Role System Prompt\n${systemPrompt}`,
    ];
    const knowledgeContext = this.buildFullKnowledgeContext(roleId);
    if (knowledgeContext) {
      sections.push(`## Knowledge Base\n${knowledgeContext}`);
    }
    if (context) {
      sections.push(`## Additional Context\n${context}`);
    }
    sections.push('Keep this role and knowledge context for the rest of this agent session. Reply with a brief acknowledgement only.');
    return sections.join('\n\n');
  }

  private getCursorConfig(): CursorAgentOptions {
    return {
      apiKey: this.config.cursor?.apiKey ?? process.env.CURSOR_API_KEY ?? '',
      model: this.config.cursor?.model ?? 'composer-2',
      workspacePath: this.config.cursor?.workspacePath ?? process.cwd(),
    };
  }

  private async callEmbeddingApi(text: string): Promise<Float32Array> {
    // Placeholder: real implementation would call an embedding endpoint
    return hashEmbed(text);
  }
}

class CursorSdkRuntime implements CursorRuntime {
  async create(options: CursorAgentOptions): Promise<CursorAgentLike> {
    const { Agent } = await import('@cursor/sdk');
    const agent = await Agent.create({
      apiKey: options.apiKey,
      model: { id: options.model },
      local: { cwd: options.workspacePath },
    });
    return wrapCursorAgent(agent);
  }

  async resume(agentId: string, options: CursorAgentOptions): Promise<CursorAgentLike> {
    const { Agent } = await import('@cursor/sdk');
    const agent = await Agent.resume(agentId, {
      apiKey: options.apiKey,
      model: { id: options.model },
      local: { cwd: options.workspacePath },
    });
    return wrapCursorAgent(agent);
  }
}

function wrapCursorAgent(agent: SDKAgent): CursorAgentLike {
  return {
    id: agent.agentId,
    async send(prompt: string): Promise<string> {
      const run = await agent.send(prompt);
      const result = await run.wait();
      if (result.status === 'error') {
        throw new Error(`Cursor agent run failed: ${run.id}`);
      }
      return result.result ?? '';
    },
  };
}

/** Deterministic pseudo-embedding using character frequency (dev fallback only). */
function hashEmbed(text: string, dim = 128): Float32Array {
  const vec = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    vec[text.charCodeAt(i) % dim] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}
