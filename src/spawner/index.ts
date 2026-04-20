import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { AgentForgeDB } from '../storage/database.js';
import { getRole } from '../roles/library.js';
import { searchKnowledge } from '../roles/library.js';
import type { AppConfig } from '../config.js';

export interface SpawnAgentInput {
  roleId: string;
  prompt: string;
  context?: string;
  tools?: Anthropic.Messages.Tool[];
}

export interface SpawnAgentResult {
  text: string;
  toolCalls: Array<{ name: string; input: unknown; result?: unknown }>;
  stopReason: string;
}

export class AgentSpawner {
  private client: Anthropic;

  constructor(
    private readonly db: AgentForgeDB,
    private readonly config: AppConfig,
  ) {
    this.client = new Anthropic({ apiKey: config.llm.apiKey });
  }

  async spawnAgent(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    if (this.config.spawner.mode === 'cli') {
      return this.spawnViaCli(input);
    }
    return this.spawnViaSdk(input);
  }

  private async spawnViaSdk(input: SpawnAgentInput): Promise<SpawnAgentResult> {
    const role = getRole(this.db, input.roleId);

    // RAG: retrieve relevant knowledge chunks if the role has a knowledge base
    const knowledgeContext = await this.buildKnowledgeContext(input.roleId, input.prompt);

    const systemParts = [role.systemPrompt];
    if (knowledgeContext) {
      systemParts.push(`\n\n## Relevant Knowledge\n${knowledgeContext}`);
    }
    if (input.context) {
      systemParts.push(`\n\n## Additional Context\n${input.context}`);
    }

    const stream = await this.client.messages.stream({
      model: this.config.llm.model,
      system: systemParts.join(''),
      messages: [{ role: 'user', content: input.prompt }],
      tools: input.tools ?? [],
      max_tokens: 8096,
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

  private async callEmbeddingApi(text: string): Promise<Float32Array> {
    // Placeholder: real implementation would call an embedding endpoint
    return hashEmbed(text);
  }
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
