import { describe, expect, it, vi } from 'vitest';
import { AgentSpawner } from './index.js';
import { AgentForgeDB } from '../storage/database.js';
import type { AppConfig } from '../config.js';

function makeDB() {
  const db = new AgentForgeDB(':memory:');
  db.init();
  db.upsertRole({
    id: 'goofy-expert',
    name: 'Goofy 专家',
    systemPrompt: 'You are the Goofy expert.',
    isBuiltin: false,
    createdAt: '2025-01-01',
  });
  db.insertChunk({
    id: 'chunk-1',
    roleId: 'goofy-expert',
    sourceFile: 'goofy.md',
    chunkText: 'Goofy routing knowledge',
    createdAt: '2025-01-01',
  });
  return db;
}

function makeConfig(): AppConfig {
  return {
    llm: { provider: 'anthropic', model: 'claude-test', apiKey: 'anthropic-key' },
    cursor: { apiKey: 'cursor-key', model: 'composer-2', workspacePath: '/repo' },
    spawner: { mode: 'sdk', fallbackToCli: true },
    server: { port: 3000 },
    playwright: { browser: 'chromium', screenshotDir: '/tmp/screens' },
  };
}

function makeCursorAgent(id: string, replies: string[]) {
  const sent: string[] = [];
  return {
    id,
    sent,
    send: vi.fn(async (prompt: string) => {
      sent.push(prompt);
      return replies.shift() ?? 'ok';
    }),
  };
}

describe('AgentSpawner cursor provider', () => {
  it('defaults to the cursor provider when a session id is supplied', async () => {
    const db = makeDB();
    const createdAgent = makeCursorAgent('cursor-agent-default', ['initialized', 'default answer']);
    const cursorRuntime = {
      create: vi.fn(async () => createdAgent),
      resume: vi.fn(),
    };
    const spawner = new AgentSpawner(db, makeConfig(), { cursorRuntime });

    const result = await spawner.spawnAgent({
      roleId: 'goofy-expert',
      sessionId: 'chat-default',
      prompt: 'default provider question',
    });

    expect(result.text).toBe('default answer');
    expect(cursorRuntime.create).toHaveBeenCalledTimes(1);
    expect(createdAgent.sent[0]).toContain('Goofy routing knowledge');
    expect(createdAgent.sent[1]).toBe('default provider question');
  });

  it('sends role chunks once for a new session, then resumes without resending chunks', async () => {
    const db = makeDB();
    const createdAgent = makeCursorAgent('cursor-agent-1', ['initialized', 'first answer']);
    const resumedAgent = makeCursorAgent('cursor-agent-1', ['second answer']);
    const cursorRuntime = {
      create: vi.fn(async () => createdAgent),
      resume: vi.fn(async () => resumedAgent),
    };
    const spawner = new AgentSpawner(db, makeConfig(), { cursorRuntime });

    const first = await spawner.spawnAgent({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      prompt: 'first question',
    });
    const second = await spawner.spawnAgent({
      provider: 'cursor',
      roleId: 'goofy-expert',
      sessionId: 'chat-1',
      prompt: 'second question',
    });

    expect(first.text).toBe('first answer');
    expect(second.text).toBe('second answer');
    expect(cursorRuntime.create).toHaveBeenCalledTimes(1);
    expect(cursorRuntime.resume).toHaveBeenCalledWith('cursor-agent-1', expect.any(Object));
    expect(createdAgent.sent).toHaveLength(2);
    expect(createdAgent.sent[0]).toContain('You are the Goofy expert.');
    expect(createdAgent.sent[0]).toContain('Goofy routing knowledge');
    expect(createdAgent.sent[1]).toBe('first question');
    expect(resumedAgent.sent).toEqual(['second question']);
    expect(db.getAgentSession('cursor', 'goofy-expert', 'chat-1')?.externalId).toBe('cursor-agent-1');
  });

  it('requires sessionId when using the cursor provider', async () => {
    const db = makeDB();
    const spawner = new AgentSpawner(db, makeConfig(), {
      cursorRuntime: {
        create: vi.fn(),
        resume: vi.fn(),
      },
    });

    await expect(spawner.spawnAgent({
      provider: 'cursor',
      roleId: 'goofy-expert',
      prompt: 'hello',
    })).rejects.toThrow('sessionId is required');
  });
});
