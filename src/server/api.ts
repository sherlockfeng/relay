import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getDatabase } from '../storage/database.js';
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
