import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { loadConfig } from '../config.js';
import { getDatabase } from '../storage/database.js';
import { seedBuiltinRoles, listRoles, getRole, trainRole, searchKnowledge } from '../roles/library.js';
import { WorkflowEngine } from '../workflow/engine.js';
import { AgentSpawner } from '../spawner/index.js';
import { summarizeCampaign } from '../summarizer/campaign.js';

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
