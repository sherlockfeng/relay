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

  app.patch('/api/requirements/:id', (req, res) => {
    const existing = db.getRequirement(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const allowed = ['name', 'purpose', 'context', 'summary', 'relatedDocs', 'changes', 'tags', 'status'] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'No valid fields to update' }); return; }
    db.updateRequirement(req.params.id, patch as Parameters<typeof db.updateRequirement>[1]);
    res.json(db.getRequirement(req.params.id));
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

    // Only these fields can be updated via chat — purpose/name are immutable from chat
    const ALLOWED_CHAT_FIELDS = ['context', 'summary', 'changes'] as const;

    const systemPrompt = `你是一个需求文档维护助手。根据用户与 AI 的对话，提取其中有价值的新信息，只更新以下三个字段：context、summary、changes。

当前需求摘要：${requirement.summary ?? '（暂无）'}
当前主要改动：${(requirement.changes ?? []).join('；') || '（暂无）'}
当前上下文（前500字）：${(requirement.context ?? '').slice(0, 500)}

规则（严格遵守）：
- 只返回纯 JSON，不要 markdown 代码块，不要解释文字
- 只允许出现 context、summary、changes 三个 key，其他字段一律不输出
- context：把对话中新增的背景信息追加到末尾（两个换行分隔原有内容），禁止替换原内容
- summary：直接写完整的新摘要正文（Markdown），禁止写"目的：不变"/"改动：xx"之类 diff 描述
- changes：仅返回本次新增的改动条目（字符串数组），禁止包含已有内容
- 没有新信息则返回 {}
- 任何字段的值都禁止出现"不变""无变化""unchanged""same"等占位词

返回格式示例：
{
  "context": "原有内容\\n\\n新增：TLB 接入判断逻辑是...",
  "summary": "更新后的摘要正文",
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
      // Whitelist: only allow context/summary/changes, drop everything else
      for (const key of Object.keys(updates)) {
        if (!(ALLOWED_CHAT_FIELDS as readonly string[]).includes(key)) {
          delete updates[key];
        }
      }

      // Strip placeholder values AI sometimes returns for "no change" fields
      const NO_CHANGE_MARKERS = /^(不变|无变化|同上|unchanged|no change|n\/a|same|保持不变|无|-)$/i;
      for (const key of Object.keys(updates)) {
        const val = updates[key];
        if (typeof val === 'string' && NO_CHANGE_MARKERS.test(val.trim())) {
          delete updates[key];
        }
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
