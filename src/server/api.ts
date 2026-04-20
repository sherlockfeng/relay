import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../storage/database.js';
import type { RequirementTodo } from '../storage/database.js';
import { loadConfig } from '../config.js';
import { recallRequirements, formatRequirementForInjection } from '../requirements/recall.js';
import Anthropic from '@anthropic-ai/sdk';

export function createApiServer(webDistPath?: string) {
  const app = express();
  app.use(express.json());

  if (webDistPath && existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
  }

  const db = getDatabase();

  // ── Requirements ────────────────────────────────────────────────────────────

  app.get('/api/requirements', (_req, res) => {
    const query = typeof _req.query.q === 'string' ? _req.query.q : undefined;
    res.json(recallRequirements(db, query));
  });

  app.get('/api/requirements/:id', (req, res) => {
    const req_ = db.getRequirement(req.params.id);
    if (!req_) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(req_);
  });

  app.post('/api/requirements/:id/chat', async (req, res) => {
    const requirement = db.getRequirement(req.params.id);
    if (!requirement) { res.status(404).json({ error: 'Not found' }); return; }

    const { message, history } = req.body as {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message) { res.status(400).json({ error: 'message is required' }); return; }

    const config = loadConfig();
    if (!config.llm.apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in ~/.relay/config.json' });
      return;
    }

    const client = new Anthropic({ apiKey: config.llm.apiKey });
    const context = formatRequirementForInjection(requirement);

    const messages: Anthropic.MessageParam[] = [
      ...(history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    try {
      const response = await client.messages.create({
        model: config.llm.model,
        max_tokens: 1024,
        system: `你是一个需求分析助手。以下是当前需求的详细信息，请基于此内容回答用户的问题。\n\n${context}`,
        messages,
      });
      const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('');
      res.json({ reply: text });
    } catch (err: unknown) {
      // Return a clean human-readable message; avoid leaking raw HTML or stack traces
      let message = 'AI 服务暂时不可用，请稍后重试';
      if (err instanceof Error) {
        const status = (err as { status?: number }).status;
        if (status === 401) message = 'API Key 无效，请检查 ~/.relay/config.json 中的 llm.apiKey';
        else if (status === 429) message = '请求过于频繁，请稍后重试';
        else if (status && status >= 500) message = `AI 服务异常（${status}），请稍后重试`;
        else if (err.message && !err.message.includes('<html')) message = err.message;
      }
      console.error('[chat error]', err);
      res.status(500).json({ error: message });
    }
  });

  // ── Todos ────────────────────────────────────────────────────────────────────

  app.post('/api/requirements/:id/todos', (req, res) => {
    const requirement = db.getRequirement(req.params.id);
    if (!requirement) { res.status(404).json({ error: 'Not found' }); return; }
    const { text } = req.body as { text?: string };
    if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }
    const todo: RequirementTodo = {
      id: randomUUID(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString(),
    };
    const todos = [...(requirement.todos ?? []), todo];
    db.updateRequirement(requirement.id, { todos });
    res.json(todo);
  });

  app.patch('/api/requirements/:id/todos/:todoId', (req, res) => {
    const requirement = db.getRequirement(req.params.id);
    if (!requirement) { res.status(404).json({ error: 'Not found' }); return; }
    const { done, text } = req.body as { done?: boolean; text?: string };
    const todos = (requirement.todos ?? []).map((t) => {
      if (t.id !== req.params.todoId) return t;
      return { ...t, ...(done !== undefined ? { done } : {}), ...(text ? { text } : {}) };
    });
    db.updateRequirement(requirement.id, { todos });
    res.json(todos.find((t) => t.id === req.params.todoId));
  });

  app.delete('/api/requirements/:id/todos/:todoId', (req, res) => {
    const requirement = db.getRequirement(req.params.id);
    if (!requirement) { res.status(404).json({ error: 'Not found' }); return; }
    const todos = (requirement.todos ?? []).filter((t) => t.id !== req.params.todoId);
    db.updateRequirement(requirement.id, { todos });
    res.json({ ok: true });
  });

  app.post('/api/requirements/:id/apply-chat', async (req, res) => {
    const requirement = db.getRequirement(req.params.id);
    if (!requirement) { res.status(404).json({ error: 'Not found' }); return; }

    const { history } = req.body as {
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    if (!history?.length) { res.status(400).json({ error: 'history is required' }); return; }

    const config = loadConfig();
    if (!config.llm.apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
      return;
    }

    const client = new Anthropic({ apiKey: config.llm.apiKey });

    const conversationText = history
      .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = `你是一个需求文档维护助手。根据用户与 AI 的对话，提取其中对需求文档有价值的新信息，并以 JSON 格式返回需要更新的字段。

当前需求文档：
名称：${requirement.name}
目的：${requirement.purpose ?? ''}
摘要：${requirement.summary ?? ''}
主要改动：${(requirement.changes ?? []).join('\n')}
上下文：${(requirement.context ?? '').slice(0, 1000)}

规则：
- 只返回纯 JSON 对象，不要 markdown 代码块，不要任何解释文字，不要换行符之外的转义
- 只包含有实质新增信息的字段，没有新信息的字段不要包含
- context 字段：把对话中补充的背景信息追加到现有 context 末尾（用两个换行分隔），不要替换原内容
- summary 字段：如果对话澄清了摘要，可以更新
- changes 字段：如果对话新增了改动点，只返回新增的条目（数组），不要包含已有内容
- 如果对话没有任何有价值的新信息可以更新，返回 {}

返回格式示例：
{
  "context": "原有内容\\n\\n新增：TLB 接入判断逻辑是...",
  "summary": "更新后的摘要",
  "changes": ["新改动1", "新改动2"]
}`;

    try {
      const response = await client.messages.create({
        model: config.llm.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: `以下是对话内容：\n\n${conversationText}\n\n请提取其中有价值的信息，返回需要更新的字段（JSON 格式）。` }],
      });

      const raw = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');

      // Extract the outermost JSON object robustly
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) { res.json({ updated: false, message: '对话中没有发现需要更新的新信息' }); return; }

      let updates: Record<string, unknown>;
      try {
        updates = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        console.error('[apply-chat] JSON parse failed, raw:', raw.slice(0, 500));
        res.json({ updated: false, message: '对话中没有发现需要更新的新信息' });
        return;
      }
      if (Object.keys(updates).length === 0) {
        res.json({ updated: false, message: '对话中没有发现需要更新的新信息' });
        return;
      }

      // Merge arrays instead of replacing
      const finalUpdates: Record<string, unknown> = { ...updates };
      if (Array.isArray(updates.changes) && requirement.changes?.length) {
        const existing = new Set(requirement.changes.map((c) => c.slice(0, 20)));
        finalUpdates.changes = [
          ...requirement.changes,
          ...(updates.changes as string[]).filter((c: string) => !existing.has(c.slice(0, 20))),
        ];
      }

      db.updateRequirement(requirement.id, finalUpdates as Parameters<typeof db.updateRequirement>[1]);
      res.json({ updated: true, fields: Object.keys(updates), requirement: db.getRequirement(requirement.id) });
    } catch (err: unknown) {
      let message = 'AI 服务暂时不可用';
      if (err instanceof Error) {
        const status = (err as { status?: number }).status;
        if (status === 401) message = 'API Key 无效';
        else if (status && status >= 500) message = `AI 服务异常（${status}）`;
      }
      console.error('[apply-chat error]', err);
      res.status(500).json({ error: message });
    }
  });

  // ── Campaigns ────────────────────────────────────────────────────────────────

  app.get('/api/campaigns', (_req, res) => {
    res.json(db.listCampaigns());
  });

  app.get('/api/campaigns/:id', (req, res) => {
    const campaign = db.getCampaign(req.params.id);
    if (!campaign) { res.status(404).json({ error: 'Not found' }); return; }
    const cycles = db.listCycles(req.params.id);
    res.json({ ...campaign, cycles });
  });

  // ── Roles ─────────────────────────────────────────────────────────────────

  app.get('/api/roles', (_req, res) => {
    res.json(db.listRoles());
  });

  // SPA fallback (Express 5 requires named wildcard)
  if (webDistPath && existsSync(webDistPath)) {
    app.get('/{*path}', (_req, res) => {
      res.sendFile(join(webDistPath, 'index.html'));
    });
  }

  return createServer(app);
}

export async function startApiServer(port: number, webDistPath?: string): Promise<void> {
  const server = createApiServer(webDistPath);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Relay dashboard: http://localhost:${port}`);
}
