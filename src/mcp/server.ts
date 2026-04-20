import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { loadConfig } from '../config.js';
import { getDatabase } from '../storage/database.js';
import { seedBuiltinRoles, listRoles, getRole, trainRole, searchKnowledge } from '../roles/library.js';
import { WorkflowEngine } from '../workflow/engine.js';
import { AgentSpawner } from '../spawner/index.js';
import { summarizeCampaign } from '../summarizer/campaign.js';
import { startCapture, submitAnswers, confirmCapture } from '../requirements/capture.js';
import { recallRequirements, formatRequirementForInjection } from '../requirements/recall.js';

export function createMcpServer(): McpServer {
  const config = loadConfig();
  const db = getDatabase();
  db.init();
  seedBuiltinRoles(db);

  const engine = new WorkflowEngine(db);
  const spawner = new AgentSpawner(db, config);

  const server = new McpServer({ name: 'relay', version: '0.1.0' });

  // ── Workflow ────────────────────────────────────────────────────────────────

  server.registerTool('init_workflow', {
    description: 'Start a new vibe coding campaign for a project. Creates the first cycle in product phase.',
    inputSchema: {
      projectPath: z.string().describe('Absolute path to the project directory'),
      title: z.string().describe('Short title for this campaign'),
      brief: z.string().optional().describe('Initial requirement — the "why" of this work'),
    },
  }, async ({ projectPath, title, brief }) => {
    const campaign = engine.initWorkflow(projectPath, title, brief);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        campaignId: campaign.id, title: campaign.title, status: campaign.status,
        message: 'Workflow initialized. Product agent: call get_cycle_state() then create_tasks().',
      }, null, 2) }],
    };
  });

  server.registerTool('get_cycle_state', {
    description: 'Get the current cycle state: status, tasks, and screenshots from the previous cycle.',
    inputSchema: {
      cycleId: z.string().optional(),
      campaignId: z.string().optional(),
    },
  }, async ({ cycleId, campaignId }) => {
    const state = engine.getCycleState(cycleId, campaignId);
    if (!state) return { content: [{ type: 'text', text: 'No active cycle found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
  });

  server.registerTool('complete_cycle', {
    description: 'Mark the test cycle complete. Automatically starts the next cycle in product phase.',
    inputSchema: {
      cycleId: z.string(),
      passRate: z.number().min(0).max(100).optional(),
      failedTests: z.array(z.string()).optional(),
      screenshots: z.array(z.object({ filePath: z.string(), description: z.string() })).optional(),
    },
  }, async ({ cycleId, passRate, failedTests, screenshots }) => {
    const cycle = engine.completeCycle(cycleId, {
      passRate, failedTests,
      screenshots: screenshots?.map((s) => ({ ...s, capturedAt: new Date().toISOString() })),
    });
    const nextCycle = db.getActiveCycle(cycle.campaignId);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        completedCycleId: cycle.id, cycleNum: cycle.cycleNum,
        nextCycleId: nextCycle?.id,
        message: nextCycle
          ? `Cycle ${cycle.cycleNum} done. Next cycle ${nextCycle.cycleNum} ready for Product Agent.`
          : `Cycle ${cycle.cycleNum} done. Campaign complete.`,
      }, null, 2) }],
    };
  });

  // ── Tasks ───────────────────────────────────────────────────────────────────

  server.registerTool('create_tasks', {
    description: 'Product agent: create dev and test tasks for the current cycle.',
    inputSchema: {
      cycleId: z.string(),
      tasks: z.array(z.object({
        role: z.enum(['dev', 'test']),
        title: z.string(),
        description: z.string().optional(),
        acceptance: z.array(z.string()).optional(),
        e2eScenarios: z.array(z.string()).optional(),
      })).min(1).max(6),
      productBrief: z.string().optional(),
    },
  }, async ({ cycleId, tasks, productBrief }) => {
    if (productBrief) db.updateCycle(cycleId, { productBrief });
    const created = engine.createTasks(cycleId, tasks);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        tasksCreated: created.length,
        tasks: created.map((t) => ({ id: t.id, role: t.role, title: t.title })),
        message: 'Tasks created. Dev agent: call get_my_tasks().',
      }, null, 2) }],
    };
  });

  server.registerTool('get_my_tasks', {
    description: 'Get pending tasks for your role in the current cycle.',
    inputSchema: { cycleId: z.string(), role: z.enum(['dev', 'test']) },
  }, async ({ cycleId, role }) => {
    const tasks = engine.getTasksForRole(cycleId, role);
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  });

  server.registerTool('complete_task', {
    description: 'Mark a task completed. Dev tasks require a docAuditToken from update_doc_first().',
    inputSchema: {
      taskId: z.string(),
      result: z.string().describe('1-2 sentence summary of what was done'),
      docAuditToken: z.string().optional().describe('Required for dev tasks'),
    },
  }, async ({ taskId, result, docAuditToken }) => {
    const task = engine.completeTask(taskId, { result, docAuditToken });
    return { content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, status: task.status }, null, 2) }] };
  });

  server.registerTool('add_task_comment', {
    description: 'Add a clarification comment to a task.',
    inputSchema: { taskId: z.string(), comment: z.string() },
  }, async ({ taskId, comment }) => {
    const task = engine.addTaskComment(taskId, comment);
    return { content: [{ type: 'text', text: JSON.stringify({ taskId: task.id, comments: task.comments }, null, 2) }] };
  });

  server.registerTool('create_bug_tasks', {
    description: 'Test agent: report bugs. Creates dev tasks and reverts cycle to dev phase.',
    inputSchema: {
      cycleId: z.string(),
      bugs: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        expected: z.string().optional(),
        actual: z.string().optional(),
        screenshotDescription: z.string().optional(),
      })).min(1),
    },
  }, async ({ cycleId, bugs }) => {
    const tasks = engine.createBugTasks(cycleId, bugs);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        bugTasksCreated: tasks.length,
        tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
        message: 'Bug tasks created. Cycle reverted to dev phase.',
      }, null, 2) }],
    };
  });

  server.registerTool('add_product_feedback', {
    description: 'Test agent: send design-level feedback to product for the next cycle.',
    inputSchema: { cycleId: z.string(), feedback: z.string() },
  }, async ({ cycleId, feedback }) => {
    engine.addProductFeedback(cycleId, feedback);
    return { content: [{ type: 'text', text: 'Feedback recorded for next product cycle.' }] };
  });

  // ── Doc-first ───────────────────────────────────────────────────────────────

  server.registerTool('update_doc_first', {
    description: 'MANDATORY before any code change: write the doc and get back an auditToken for complete_task().',
    inputSchema: {
      filePath: z.string().describe('Relative path to the doc file'),
      content: z.string().describe('Full new file content'),
      taskId: z.string().optional(),
    },
  }, async ({ filePath, content, taskId }) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      return { content: [{ type: 'text', text: `Failed to write doc: ${String(err)}` }], isError: true };
    }
    const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const token = randomUUID();
    db.insertDocAudit({ token, taskId, filePath, contentHash, createdAt: new Date().toISOString() });
    return {
      content: [{ type: 'text', text: JSON.stringify({
        auditToken: token, filePath,
        message: 'Doc written. Pass auditToken to complete_task().',
      }, null, 2) }],
    };
  });

  // ── Roles ───────────────────────────────────────────────────────────────────

  server.registerTool('list_roles', {
    description: 'List all available agent roles.',
    inputSchema: {},
  }, async () => {
    const roles = listRoles(db);
    return {
      content: [{ type: 'text', text: JSON.stringify(
        roles.map((r) => ({ id: r.id, name: r.name, isBuiltin: r.isBuiltin, docPath: r.docPath })),
        null, 2,
      ) }],
    };
  });

  server.registerTool('get_role', {
    description: 'Get the full details and system prompt of an agent role.',
    inputSchema: { roleId: z.string() },
  }, async ({ roleId }) => {
    const role = getRole(db, roleId);
    return { content: [{ type: 'text', text: JSON.stringify(role, null, 2) }] };
  });

  server.registerTool('train_role', {
    description: 'Create or retrain a custom agent role by uploading documents or source code as a knowledge base.',
    inputSchema: {
      roleId: z.string().describe('Unique ID, e.g. "goofy-expert"'),
      name: z.string().describe('Human-readable name'),
      documents: z.array(z.object({ filename: z.string(), content: z.string() })).min(1),
      baseSystemPrompt: z.string().optional(),
    },
  }, async ({ roleId, name, documents, baseSystemPrompt }) => {
    const embedFn = makePseudoEmbedFn();
    const role = await trainRole(db, { roleId, name, documents, baseSystemPrompt, embedFn });
    return {
      content: [{ type: 'text', text: JSON.stringify({
        roleId: role.id, name: role.name,
        chunksIndexed: db.getChunksForRole(role.id).length,
        message: `Role "${name}" trained. Use spawn_agent(roleId: "${roleId}") to activate.`,
      }, null, 2) }],
    };
  });

  server.registerTool('search_knowledge', {
    description: "RAG search against a role's knowledge base.",
    inputSchema: {
      roleId: z.string(),
      query: z.string(),
      topK: z.number().min(1).max(20).optional(),
    },
  }, async ({ roleId, query, topK }) => {
    const results = await searchKnowledge(db, roleId, query, makePseudoEmbedFn(), topK ?? 5);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  // ── Spawner ─────────────────────────────────────────────────────────────────

  server.registerTool('spawn_agent', {
    description: "Spawn a sub-agent with a specific role. System prompt + knowledge context are injected automatically.",
    inputSchema: {
      roleId: z.string(),
      prompt: z.string(),
      context: z.string().optional(),
    },
  }, async ({ roleId, prompt, context }) => {
    const result = await spawner.spawnAgent({ roleId, prompt, context });
    return {
      content: [{ type: 'text', text: JSON.stringify({
        stopReason: result.stopReason, toolCallCount: result.toolCalls.length,
        text: result.text, toolCalls: result.toolCalls,
      }, null, 2) }],
    };
  });

  // ── Screenshots & tests ─────────────────────────────────────────────────────

  server.registerTool('capture_screenshot', {
    description: 'Attach a screenshot to a cycle.',
    inputSchema: {
      cycleId: z.string(),
      filePath: z.string(),
      description: z.string().describe('[PASS/FAIL/BUG] scenario description'),
    },
  }, async ({ cycleId, filePath, description }) => {
    engine.captureScreenshot(cycleId, filePath, description);
    return { content: [{ type: 'text', text: `Screenshot recorded: ${description}` }] };
  });

  server.registerTool('run_e2e_tests', {
    description: 'Trigger Playwright e2e tests.',
    inputSchema: {
      cycleId: z.string(),
      testPattern: z.string().optional(),
    },
  }, async ({ testPattern }) => {
    const { execSync } = await import('node:child_process');
    const pattern = testPattern ?? 'tests/e2e/**';
    try {
      const output = execSync(`npx playwright test "${pattern}" --reporter=json --screenshot=on`, {
        encoding: 'utf8', timeout: 120_000,
      });
      return { content: [{ type: 'text', text: `Tests completed.\n${output.slice(0, 2000)}` }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Tests failed:\n${msg.slice(0, 2000)}` }], isError: true };
    }
  });

  // ── Campaign ────────────────────────────────────────────────────────────────

  server.registerTool('list_campaigns', {
    description: 'List all campaigns.',
    inputSchema: {},
  }, async () => {
    const campaigns = db.listCampaigns();
    return {
      content: [{ type: 'text', text: JSON.stringify(
        campaigns.map((c) => ({
          id: c.id, title: c.title, status: c.status,
          brief: c.brief?.slice(0, 200), startedAt: c.startedAt,
        })),
        null, 2,
      ) }],
    };
  });

  server.registerTool('summarize_campaign', {
    description: 'Generate a cross-cycle campaign summary: why it was done, what changed, key decisions, overall arc.',
    inputSchema: { campaignId: z.string() },
  }, async ({ campaignId }) => {
    const summary = await summarizeCampaign(db, campaignId, config);
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  });

  // ── Prompts ─────────────────────────────────────────────────────────────────

  server.registerPrompt('relay:doc-first', {
    description: 'Doc-First 开发纪律 — 任何代码变更前必须先更新文档',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# Doc-First 开发纪律

**核心规则：任何代码或设计变更，必须先修改对应文档，再写代码。**

## 执行方式

调用 MCP tool \`update_doc_first(filePath, content)\` 强制写文档，返回 \`auditToken\`，完成任务时附带此 token。

\`\`\`
❌ 改代码 → 改文档（或不改文档）
✅ 改文档（update_doc_first）→ 改代码 → complete_task(docAuditToken)
\`\`\`

## 文档归属

- 新功能 → 更新 \`docs/tech/DESIGN.md\` 对应模块
- Bug fix → 在 \`docs/tech/DESIGN.md\` 添加约束说明
- API 变更 → 更新接口文档
- 产品决策 → 更新 \`docs/product/PRD.md\`

跳过此规则的任务将被系统标记为违规，无法完成。`,
      },
    }],
  }));

  server.registerPrompt('relay:role-product', {
    description: '产品 Agent 工作规范 — 截图分析、竞品研究、任务拆解',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# 产品 Agent 工作规范

你是 vibe coding 循环的**起点和终点**，负责分析现状并输出结构化任务列表。

## 工作流程

1. 调用 \`get_cycle_state(campaignId)\` 读取上一轮截图与状态
2. 调用 \`update_doc_first("docs/product/PRD.md", content)\` 记录本轮决策（**必须在 create_tasks 之前**）
3. 调用 \`create_tasks(cycleId, tasks)\` 输出任务列表

## 任务格式

\`\`\`json
[
  { "role": "dev",  "title": "...", "description": "...", "acceptanceCriteria": ["..."] },
  { "role": "test", "title": "...", "description": "...", "e2eScenarios": ["..."] }
]
\`\`\`

## 原则

- 每轮不超过 3 个核心目标
- 只描述**做什么**，不描述怎么做
- 每个 dev 任务单次工作量不超过 4h
- 不写代码，不写测试

## 竞品分析格式

\`\`\`
竞品: [名称]
亮点: [用户感知到的优势]
差距: [我们目前缺少的]
参考点: [具体可借鉴的交互/功能]
\`\`\``,
      },
    }],
  }));

  server.registerPrompt('relay:role-developer', {
    description: '研发 Agent 工作规范 — Doc-First 实现、任务边界、安全约束',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# 研发 Agent 工作规范

你负责将产品任务转化为可运行的代码实现。**文档先于代码**是最核心的约束。

## 工作流程

1. 调用 \`get_my_tasks(cycleId, "dev")\` 拉取任务
2. 每个任务开始前调用 \`update_doc_first(filePath, content)\` 获取 \`auditToken\`
3. 按 \`acceptanceCriteria\` 实现，不超出范围
4. 调用 \`complete_task(taskId, { result, docAuditToken })\` 完成任务

## 禁止事项

- 不跳过 \`update_doc_first\`
- 不修改测试 agent 负责的 e2e 测试文件
- 不自行扩大功能范围（需通过任务系统反馈产品）
- 不未完成当前 cycle 所有任务就推进下一 cycle

## 技术约束

- 跟随项目现有技术栈
- 不引入 OWASP Top 10 漏洞（SQL 注入、XSS、命令注入等）
- 注释只写 WHY，不写 WHAT
- 有歧义时通过 \`add_task_comment(taskId, comment)\` 提问，不自行假设`,
      },
    }],
  }));

  server.registerPrompt('relay:role-qa', {
    description: '测试 Agent 工作规范 — 攻击性 e2e 测试、截图规范、Bug 反馈',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# 测试 Agent 工作规范

你是质量守门人，工作风格是**攻击性的** — 假设代码有问题，主动寻找边界条件和异常路径。

> "如果我没有发现问题，说明我测试不够深入，而不是代码没有问题。"

## 攻击维度

- **边界值**：空值、null、超长字符串、负数、特殊字符
- **并发**：同时触发多个操作，检查竞态
- **网络**：断网、超时、慢网（500ms+）、重复请求
- **权限**：未授权访问、越权操作、token 过期
- **状态**：非正常顺序操作、中途刷新、浏览器回退
- **数据**：XSS payload、SQL 注入串、Unicode 边界字符

## 工作流程

1. 调用 \`get_my_tasks(cycleId, "test")\` 拉取任务
2. 在 \`tests/e2e/cycle-{n}/\` 写 Playwright 测试（happy path ×1 + 边界/错误 path ×2+）
3. 调用 \`run_e2e_tests(cycleId)\` 执行，自动截图
4. 全通过 → \`complete_cycle(cycleId)\`；有失败 → \`create_bug_tasks(cycleId, bugs[])\`

## 截图规范

\`\`\`
[PASS] 登录成功后跳转首页
[FAIL] 密码为空时缺少错误提示
[BUG]  并发提交时重复创建记录
\`\`\`

## 禁止事项

- 不修改被测代码
- 不只测 happy path
- 不在测试失败时直接标记完成`,
      },
    }],
  }));

  // ── Requirements ────────────────────────────────────────────────────────────

  server.registerTool('capture_requirement', {
    description: `Capture and save a requirement from a chat session. Multi-turn flow:
1. action="start": provide chatContext + name → returns clarifying questions
2. action="answer": provide sessionId + answers → returns draft summary for review
3. action="confirm": provide sessionId + optional edits → saves to DB, returns requirementId`,
    inputSchema: {
      action: z.enum(['start', 'answer', 'confirm']),
      name: z.string().optional().describe('Requirement name (required for start)'),
      chatContext: z.string().optional().describe('Summary of the chat / what was discussed (required for start)'),
      requirementId: z.string().optional().describe('Existing requirement ID — pass to update instead of create'),
      sessionId: z.string().optional().describe('Session ID from start step (required for answer/confirm)'),
      answers: z.record(z.string()).optional().describe('Answers to clarifying questions (for action=answer)'),
      edits: z.object({
        name: z.string().optional(),
        purpose: z.string().optional(),
        summary: z.string().optional(),
        relatedDocs: z.array(z.string()).optional(),
        changes: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      }).optional().describe('Optional edits to the draft before confirming'),
    },
  }, async ({ action, name, chatContext, requirementId, sessionId, answers, edits }) => {
    if (action === 'start') {
      if (!chatContext) {
        return { content: [{ type: 'text', text: 'chatContext is required for action=start' }], isError: true };
      }
      if (!name && !requirementId) {
        return { content: [{ type: 'text', text: 'name or requirementId is required for action=start' }], isError: true };
      }
      const result = startCapture(db, chatContext, name ?? '', requirementId);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          sessionId: result.sessionId,
          isUpdate: result.isUpdate,
          ...(result.existing ? { existing: { name: result.existing.name, purpose: result.existing.purpose, tags: result.existing.tags } } : {}),
          nextStep: 'Call capture_requirement(action="answer", sessionId, answers={...}) with your answers.',
          questions: result.questions,
        }, null, 2) }],
      };
    }

    if (action === 'answer') {
      if (!sessionId || !answers) {
        return { content: [{ type: 'text', text: 'sessionId and answers are required for action=answer' }], isError: true };
      }
      const result = submitAnswers(db, sessionId, answers);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          phase: result.phase,
          draft: result.draft,
          nextStep: 'Review the draft above. Call capture_requirement(action="confirm", sessionId, edits={...}) to save. Pass edits only if corrections are needed.',
        }, null, 2) }],
      };
    }

    if (action === 'confirm') {
      if (!sessionId) {
        return { content: [{ type: 'text', text: 'sessionId is required for action=confirm' }], isError: true };
      }
      const req = confirmCapture(db, sessionId, edits);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          requirementId: req.id,
          name: req.name,
          status: req.status,
          message: `Requirement "${req.name}" saved. Use recall_requirement(id: "${req.id}") to inject it into any future chat.`,
        }, null, 2) }],
      };
    }

    return { content: [{ type: 'text', text: 'Unknown action' }], isError: true };
  });

  server.registerTool('recall_requirement', {
    description: 'Recall a saved requirement. Without args returns a list to choose from. Pass id or name to get the full context formatted for injection into the current chat.',
    inputSchema: {
      id: z.string().optional().describe('Requirement ID'),
      name: z.string().optional().describe('Fuzzy name search'),
    },
  }, async ({ id, name }) => {
    if (id) {
      const req = db.getRequirement(id);
      if (!req) return { content: [{ type: 'text', text: `Requirement not found: ${id}` }], isError: true };
      return { content: [{ type: 'text', text: formatRequirementForInjection(req) }] };
    }

    const list = recallRequirements(db, name);
    if (list.length === 0) {
      return { content: [{ type: 'text', text: name ? `No requirements matching "${name}".` : 'No requirements saved yet.' }] };
    }

    if (name && list.length === 1) {
      return { content: [{ type: 'text', text: formatRequirementForInjection(list[0]) }] };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({
        message: list.length === 1 ? undefined : 'Multiple matches — pass id to get full context.',
        requirements: list.map((r) => ({
          id: r.id, name: r.name, status: r.status,
          purpose: r.purpose?.slice(0, 80),
          tags: r.tags,
          updatedAt: r.updatedAt.slice(0, 10),
        })),
      }, null, 2) }],
    };
  });

  server.registerPrompt('relay:recall-requirement', {
    description: '唤起一个已沉淀的需求，将其上下文注入到当前 chat',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `请帮我唤起一个已保存的需求并注入到当前对话上下文。

步骤：
1. 调用 \`recall_requirement()\`（不传参数）获取所有已保存需求列表
2. 展示列表让我选择，或者如果我已经说了需求名字，直接调用 \`recall_requirement(name: "...")\`
3. 确认后调用 \`recall_requirement(id: "...")\` 获取完整内容
4. 将需求内容注入到上下文，后续对话基于此需求展开

你现在可以开始了。`,
      },
    }],
  }));

  // ── Setup Project Rules ──────────────────────────────────────────────────────

  server.registerTool('setup_project_rules', {
    description: 'Write relay rules to a project so they are auto-injected into every Cursor chat (.cursor/rules) and Claude Code session (CLAUDE.md).',
    inputSchema: {
      projectPath: z.string().describe('Absolute path to the project directory'),
      rules: z.array(z.enum(['doc-first', 'role-product', 'role-developer', 'role-qa', 'git-branch']))
        .min(1)
        .describe('Which rules to inject'),
    },
  }, async ({ projectPath, rules }) => {
    const absPath = resolve(projectPath);
    const written: string[] = [];

    const ruleContents: Record<string, { title: string; body: string }> = {
      'doc-first': {
        title: 'Doc-First 开发纪律',
        body: '任何代码或设计变更，必须先调用 update_doc_first(filePath, content) 更新文档并获取 auditToken，再写代码，再 complete_task(docAuditToken)。跳过此规则的任务将被系统标记为违规。',
      },
      'role-product': {
        title: '产品 Agent 规范',
        body: '只输出任务列表，不写代码，不写测试。每轮不超过 3 个核心目标。必须在 create_tasks 之前调用 update_doc_first("docs/product/PRD.md", content)。',
      },
      'role-developer': {
        title: '研发 Agent 规范',
        body: '不跳过 update_doc_first。不修改 e2e 测试文件。不自行扩大功能范围。complete_task 必须附 docAuditToken。',
      },
      'role-qa': {
        title: '测试 Agent 规范',
        body: '攻击性测试，每个场景 happy path ×1 + 边界/错误 path ×2+。不修改被测代码。有失败通过 create_bug_tasks 反馈，不直接标记完成。',
      },
      'git-branch': {
        title: 'Git 分支规范',
        body: '每个需求使用独立语义化分支（feat/xxx、fix/xxx、chore/xxx、docs/xxx）。不复用 Claude 自动生成的 worktree 分支名。PR 目标分支为 main。',
      },
    };

    const selectedRules = rules.map((r) => ruleContents[r]).filter(Boolean);
    const combinedBody = selectedRules
      .map((r) => `## ${r.title}\n\n${r.body}`)
      .join('\n\n');

    // Write .cursor/rules/relay.mdc for Cursor auto-injection
    const cursorRulesDir = join(absPath, '.cursor', 'rules');
    mkdirSync(cursorRulesDir, { recursive: true });
    const cursorRulesPath = join(cursorRulesDir, 'relay.mdc');
    writeFileSync(cursorRulesPath, `---
description: Relay project rules (auto-injected)
alwaysApply: true
---

# Relay Rules

${combinedBody}
`, 'utf8');
    written.push('.cursor/rules/relay.mdc');

    // Write / merge CLAUDE.md for Claude Code
    const claudeMdPath = join(absPath, 'CLAUDE.md');
    const marker = '<!-- relay-rules-start -->';
    const endMarker = '<!-- relay-rules-end -->';
    const newSection = `${marker}\n## Relay Rules\n\n${combinedBody}\n${endMarker}`;

    if (existsSync(claudeMdPath)) {
      let existing = readFileSync(claudeMdPath, 'utf8');
      if (existing.includes(marker)) {
        existing = existing.replace(new RegExp(`${marker}[\\s\\S]*?${endMarker}`), newSection);
      } else {
        existing = `${existing}\n\n${newSection}`;
      }
      writeFileSync(claudeMdPath, existing, 'utf8');
    } else {
      writeFileSync(claudeMdPath, `# Project Rules\n\n${newSection}\n`, 'utf8');
    }
    written.push('CLAUDE.md');

    return {
      content: [{ type: 'text', text: JSON.stringify({
        projectPath: absPath,
        rulesApplied: rules,
        filesWritten: written,
        message: 'Rules written. Restart Cursor / Claude Code to pick up changes.',
      }, null, 2) }],
    };
  });

  return server;
}

function makePseudoEmbedFn(): (text: string) => Promise<Float32Array> {
  return async (text: string): Promise<Float32Array> => {
    const dim = 128;
    const vec = new Float32Array(dim);
    for (let i = 0; i < text.length; i++) vec[text.charCodeAt(i) % dim] += 1;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return vec;
  };
}

export async function startMcpServer(): Promise<void> {
  const mcp = createMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
