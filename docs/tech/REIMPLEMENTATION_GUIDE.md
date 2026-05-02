# Relay 项目能力与重实现指南

本文面向另一个从零接手的 agent。目标是：读完本文后，可以重新实现当前 Relay 项目的主要能力、数据模型、MCP tools、CLI、Dashboard、专家训练与调用、需求沉淀，以及最近新增的 Cursor SDK 专家会话复用能力。

## 1. 项目定位

Relay 是一个 MCP-first 的多 agent 编排平台，用 Node.js + TypeScript 实现。它的核心不是传统后端服务，而是一个可被 Cursor / Claude Code 等客户端挂载的 MCP server。任意 AI agent 可以通过 Relay 的 MCP tools 进入一个固定的 product -> dev -> test 的 vibe coding 循环。

项目同时提供：

- MCP Server：主要入口，暴露 workflow、task、role、knowledge、spawner、requirement、campaign、test/screenshot 等工具。
- SQLite 存储：保存 campaign、cycle、task、role、knowledge chunks、doc-first audit、requirements、capture sessions、Cursor agent sessions。
- Agent Spawner：按 role 生成专家 agent 调用，支持 Anthropic SDK、Claude CLI、Cursor SDK local agent。
- Requirement Memory：从聊天中沉淀需求，支持后续 recall 到任意 chat。
- Web Dashboard：浏览需求库、需求详情、待办、需求对话、专家库和知识片段。
- CLI：初始化配置、启动 MCP、管理 workflow、列出 roles、总结 campaign、启动 dashboard。

当前技术栈：

- Runtime: Node.js >= 20, TypeScript ESM。
- MCP: `@modelcontextprotocol/sdk`。
- LLM: `@anthropic-ai/sdk`。
- Cursor Agent: `@cursor/sdk`。
- DB: `better-sqlite3`，数据库默认在 `~/.relay/data.db`。
- API/Web: Express 5 + React + Vite + TailwindCSS。
- CLI: commander。
- Build: tsup。
- Test: Vitest。

## 2. 顶层目录与职责

建议按以下目录重新实现：

```text
relay/
├── AGENTS.md                         # 项目内 agent 协作规则
├── docs/
│   ├── roles/
│   │   ├── product.md                # 产品角色规范
│   │   ├── developer.md              # 研发角色规范
│   │   └── tester.md                 # 测试角色规范
│   └── tech/
│       ├── DESIGN.md                 # 技术设计
│       └── REIMPLEMENTATION_GUIDE.md # 本文档
├── src/
│   ├── cli/index.ts                  # relay CLI
│   ├── config.ts                     # ~/.relay/config.json 读写与默认配置
│   ├── mcp/server.ts                 # MCP server 和全部 tools/prompts
│   ├── requirements/
│   │   ├── capture.ts                # requirement 多轮沉淀流程
│   │   └── recall.ts                 # requirement 检索与注入格式化
│   ├── roles/
│   │   ├── library.ts                # 内置角色、训练自定义专家、RAG 搜索
│   │   └── builtin/*.ts              # 内置 role system prompts
│   ├── server/api.ts                 # Dashboard Express API + static frontend
│   ├── spawner/index.ts              # Anthropic / Cursor SDK / Claude CLI spawner
│   ├── storage/database.ts           # SQLite schema + repository methods
│   ├── summarizer/campaign.ts        # campaign 跨 cycle 总结
│   └── workflow/engine.ts            # product/dev/test cycle 状态机
├── web/
│   ├── src/App.tsx                   # routes: requirements, requirement detail, roles
│   ├── src/pages/*.tsx               # Dashboard 页面
│   ├── src/hooks/useApi.ts           # fetch hooks
│   └── package.json                  # relay-web workspace
├── package.json
├── pnpm-workspace.yaml
└── tsup.config.ts
```

## 3. 配置系统

配置文件路径固定为 `~/.relay/config.json`。

`src/config.ts` 需要实现：

```ts
export interface AppConfig {
  llm: {
    provider: 'anthropic' | 'openai';
    model: string;
    apiKey: string;
    embeddingModel?: string;
  };
  cursor?: {
    apiKey: string;
    model: string;
    workspacePath: string;
  };
  spawner: {
    mode: 'sdk' | 'cli';
    fallbackToCli: boolean;
  };
  server: { port: number };
  playwright: {
    browser: 'chromium' | 'firefox' | 'webkit';
    screenshotDir: string;
  };
}
```

默认值：

- `llm.provider = "anthropic"`
- `llm.model = "claude-sonnet-4-6"`
- `llm.apiKey = process.env.ANTHROPIC_API_KEY ?? ""`
- `cursor.apiKey = process.env.CURSOR_API_KEY ?? ""`
- `cursor.model = "composer-2"`
- `cursor.workspacePath = process.cwd()`
- `spawner.mode = "sdk"`
- `spawner.fallbackToCli = true`
- `server.port = 3000`
- `playwright.screenshotDir = ~/.relay/screenshots`

实现 `loadConfig()` 时读取 JSON 并深度 merge 到默认值。`cursor` 是可选字段，不能让旧测试或旧配置因为缺少 `cursor` 字段而报错。`saveConfig()` 负责确保目录存在并写 JSON。

安全要求：不要把用户 API key 写入仓库。`~/.relay/config.json` 位于 home 目录，不属于 git repo。

## 4. SQLite 数据模型

数据库封装在 `src/storage/database.ts`。建议实现一个 `AgentForgeDB` 类，构造函数接收 `dbPath = ~/.relay/data.db`，内部创建 `better-sqlite3` 连接，启用：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

### 4.1 campaigns

表示多天大需求或活动。

```sql
CREATE TABLE campaigns (
  id           TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  title        TEXT NOT NULL,
  brief        TEXT,
  status       TEXT DEFAULT 'active',
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  summary      TEXT
);
```

TypeScript 形状：

```ts
interface Campaign {
  id: string;
  projectPath: string;
  title: string;
  brief?: string;
  status: 'active' | 'completed';
  startedAt: string;
  completedAt?: string;
  summary?: string;
}
```

Repository methods：`insertCampaign`、`getCampaign`、`listCampaigns`、`updateCampaign`。

### 4.2 cycles

表示 product -> dev -> test 的单轮循环。

```sql
CREATE TABLE cycles (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cycle_num      INTEGER NOT NULL,
  status         TEXT DEFAULT 'pending',
  product_brief  TEXT,
  screenshots    TEXT,
  started_at     TEXT,
  completed_at   TEXT
);
```

`screenshots` 是 JSON array。状态枚举：`pending | product | dev | test | completed`。

Repository methods：`insertCycle`、`getCycle`、`getActiveCycle`、`listCycles`、`updateCycle`。

### 4.3 tasks

表示某 cycle 下分配给 dev/test 的任务。

```sql
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  cycle_id         TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  acceptance       TEXT,
  e2e_scenarios    TEXT,
  status           TEXT DEFAULT 'pending',
  result           TEXT,
  doc_audit_token  TEXT,
  comments         TEXT,
  created_at       TEXT NOT NULL,
  completed_at     TEXT
);
```

`acceptance`、`e2e_scenarios`、`comments` 是 JSON arrays。任务角色为 `dev | test`，状态为 `pending | in_progress | completed | failed`。

Repository methods：`insertTask`、`getTask`、`listTasks(cycleId, role?)`、`updateTask`。

### 4.4 roles

表示内置 agent 角色和自定义专家角色。

```sql
CREATE TABLE roles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  doc_path      TEXT,
  is_builtin    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);
```

内置角色：

- `product`: Product Agent
- `developer`: Developer Agent
- `tester`: Test Agent

Repository methods：`upsertRole`、`getRole`、`listRoles`。

### 4.5 knowledge_chunks

表示训练自定义专家时产生的知识片段。

```sql
CREATE TABLE knowledge_chunks (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  source_file TEXT,
  chunk_text  TEXT NOT NULL,
  embedding   BLOB,
  created_at  TEXT NOT NULL
);
```

`embedding` 用 `Buffer.from(float32Array.buffer)` 存储，读出时转回 `Float32Array`。

Repository methods：`insertChunk`、`getChunksForRole`、`deleteChunksForRole`。

注意：从 Buffer 恢复 Float32Array 时更严谨的写法应尊重 `byteOffset` 和 `byteLength`，例如：

```ts
const b = row.embedding as Buffer;
new Float32Array(b.buffer, b.byteOffset, b.byteLength / Float32Array.BYTES_PER_ELEMENT);
```

当前实现使用 `new Float32Array(buffer.buffer)`，能跑测试，但重实现时建议使用上面的严格形式。

### 4.6 agent_sessions

用于 Cursor SDK local agent 的会话复用。

```sql
CREATE TABLE agent_sessions (
  provider    TEXT NOT NULL,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (provider, role_id, session_id)
);
```

用途：`spawn_agent(provider="cursor", sessionId="...")` 首次调用创建 Cursor local agent 并保存 `external_id = agent.agentId`；后续同一个 `(provider, roleId, sessionId)` 调用通过 `Agent.resume(external_id)` 复用同一个 Cursor agent。

Repository methods：`upsertAgentSession`、`getAgentSession`。

### 4.7 doc_audit_log

用于强制 doc-first 纪律。

```sql
CREATE TABLE doc_audit_log (
  token        TEXT PRIMARY KEY,
  task_id      TEXT,
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
```

`update_doc_first(filePath, content, taskId?)` 写文档后生成 `auditToken` 存入此表。`complete_task` 对 dev 任务要求必须传合法 `docAuditToken`。

Repository methods：`insertDocAudit`、`getDocAudit`。

### 4.8 requirements 和 capture_sessions

需求沉淀相关。

```sql
CREATE TABLE requirements (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  purpose      TEXT,
  context      TEXT NOT NULL,
  summary      TEXT,
  related_docs TEXT,
  changes      TEXT,
  tags         TEXT,
  todos        TEXT,
  project_path TEXT,
  status       TEXT DEFAULT 'draft',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

`related_docs`、`changes`、`tags`、`todos` 是 JSON arrays。

```sql
CREATE TABLE capture_sessions (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT,
  phase          TEXT NOT NULL,
  answers        TEXT DEFAULT '{}',
  draft          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

`phase`: `questioning | confirming | done`。

Repository methods：`insertRequirement`、`updateRequirement`、`getRequirement`、`listRequirements`、`insertCaptureSession`、`updateCaptureSession`、`getCaptureSession`。

## 5. WorkflowEngine 状态机

`src/workflow/engine.ts` 是 product/dev/test 循环的核心。

### 5.1 initWorkflow

输入：`projectPath, title, brief?`。

行为：

1. 创建 `campaign`，状态为 `active`。
2. 创建 cycle 1，初始 `pending`。
3. 更新 cycle 1 状态为 `product`，写 `startedAt`。
4. 返回 campaign。

### 5.2 createTasks

输入：`cycleId, taskInputs[]`。

前置：cycle 必须存在且状态必须是 `product`。

行为：

1. 为每个 input 创建 task，状态 `pending`。
2. 写入 DB。
3. 将 cycle 状态推进到 `dev`。
4. 返回创建的 tasks。

### 5.3 completeTask

输入：`taskId, { result, docAuditToken? }`。

规则：

- 如果 task.role 是 `dev`，必须传 `docAuditToken`。
- 如果传 token，必须能在 `doc_audit_log` 查到。
- 更新 task 为 `completed`，写 result、docAuditToken、completedAt。
- 如果 cycle 当前是 `dev`，并且所有 dev task 都完成，将 cycle 状态推进到 `test`。

### 5.4 createBugTasks

测试 agent 发现 bug 时调用。

行为：

1. 对每个 bug 创建一个 dev task，title 前缀为 `[BUG]`。
2. 把 expected/actual/screenshotDescription 拼进 description。
3. 将 cycle 状态回退到 `dev`。

### 5.5 completeCycle

前置：cycle 状态必须为 `test`。

行为：

1. 将当前 cycle 更新为 `completed`，写 screenshots 和 completedAt。
2. 如果 campaign 仍然 `active`，自动创建下一轮 cycle，状态为 `product`。

### 5.6 addTaskComment / addProductFeedback / captureScreenshot

- `addTaskComment`: 给 task.comments append comment。
- `addProductFeedback`: 将测试发现的设计反馈追加到 cycle.productBrief。
- `captureScreenshot`: 将 `{filePath, description, capturedAt}` append 到 cycle.screenshots。

## 6. 角色库与知识库

`src/roles/library.ts` 负责内置角色、训练自定义专家、搜索专家知识。

### 6.1 内置角色

启动 MCP 或 CLI init 时调用 `seedBuiltinRoles(db)`。它 upsert 三个内置角色：

- product: system prompt 来自 `src/roles/builtin/product.ts`，docPath 是 `docs/roles/product.md`。
- developer: system prompt 来自 `src/roles/builtin/developer.ts`，docPath 是 `docs/roles/developer.md`。
- tester: system prompt 来自 `src/roles/builtin/tester.ts`，docPath 是 `docs/roles/tester.md`。

### 6.2 trainRole

输入：

```ts
interface TrainRoleInput {
  roleId: string;
  name: string;
  documents: Array<{ filename: string; content: string }>;
  baseSystemPrompt?: string;
  embedFn: (text: string) => Promise<Float32Array>;
}
```

行为：

1. 如果 `baseSystemPrompt` 存在，用它作为 system prompt。
2. 否则如果已有同 roleId 的 role，沿用旧 system prompt。
3. 否则生成默认专家 prompt：`You are a specialized expert agent with deep knowledge of ${name}...`。
4. upsert role，`isBuiltin=false`。
5. 删除该 role 旧 chunks。
6. 对每个文档调用 `chunkDocument(content, filename)`。
7. 对每个 chunk 调用 `embedFn` 生成 embedding。
8. 写入 `knowledge_chunks`。

### 6.3 chunkDocument

当前策略：

- `CHUNK_SIZE = 800` 字符。
- `OVERLAP = 100` 字符。
- 按行累积到约 800 字符后生成 chunk。
- 每个 chunk 前缀 `[filename]\n`。
- 下一 chunk 从上一 chunk 末尾若干行开始，直到 overlap 大约 100 字符。

### 6.4 searchKnowledge

输入：`roleId, query, embedFn, topK=5`。

行为：

1. 读该 role 的所有 chunks。
2. 对 query 生成 query embedding。
3. 过滤有 embedding 的 chunks。
4. 计算 cosine similarity。
5. 按分数降序取 topK。

当前 MCP server 内置 `makePseudoEmbedFn`，用 128 维字符频率 hash embedding，无外部 embedding API。重实现时可以保持此逻辑，也可以替换成真实 embedding provider，但要保留 fallback。

## 7. AgentSpawner

`src/spawner/index.ts` 抽象专家 agent 调用，当前支持三条路径：Anthropic SDK、Cursor SDK local agent、Claude CLI。

### 7.1 输入输出

```ts
interface SpawnAgentInput {
  roleId: string;
  prompt: string;
  context?: string;
  tools?: Anthropic.Messages.Tool[];
  provider?: 'anthropic' | 'cursor';
  sessionId?: string;
}

interface SpawnAgentResult {
  text: string;
  toolCalls: Array<{ name: string; input: unknown; result?: unknown }>;
  stopReason: string;
}
```

`spawnAgent(input)` 分发规则：

1. 如果 `input.provider === "cursor"`，走 Cursor SDK。
2. 否则如果 `config.spawner.mode === "cli"`，走 Claude CLI。
3. 否则走 Anthropic SDK。

### 7.2 Anthropic SDK provider

实现步骤：

1. `getRole(db, input.roleId)`。
2. `db.getChunksForRole(roleId)`。
3. 如果 chunk 数在 `1..80`，将所有 chunks 拼成：
  `Source: file\nchunkText`，中间用 `\n\n---\n\n` 分隔。
4. 如果 chunks > 80，调用 `buildKnowledgeContext(roleId, input.prompt)`，即 RAG top 5。
5. system prompt = role.systemPrompt + `## Knowledge Base` + optional `## Additional Context`。
6. 调用 `client.messages.stream({ model, system, messages: [{role:'user', content: prompt}], tools, max_tokens: 4096 })`。
7. 遍历 stream：
  - text delta append 到 `fullText`。
  - content_block_start 且 type 为 tool_use 时记录 tool call name 和 input。
8. `finalMessage()` 获取 stop_reason。
9. 返回 `{ text, toolCalls, stopReason }`。
10. 对 5xx / network error 做最多 3 次重试，重试间隔 1s、2s。4xx 直接抛出。

重要行为：小知识库会每次完整注入。这个行为在 goofy 专家场景会导致每次 Anthropic 调用都重复发送所有 chunks。

### 7.3 Cursor SDK provider

这是最近新增的能力，目标是在同一个 chat/session 中只初始化一次专家上下文，后续调用 resume 同一个 Cursor local agent。

配置来源：

```ts
cursor.apiKey = config.cursor?.apiKey ?? process.env.CURSOR_API_KEY ?? '';
cursor.model = config.cursor?.model ?? 'composer-2';
cursor.workspacePath = config.cursor?.workspacePath ?? process.cwd();
```

前置规则：

- `provider="cursor"` 时必须传 `sessionId`。
- 必须存在 Cursor API key，否则返回明确错误。
- 不影响默认 Anthropic provider。

建议实现一个可注入的 runtime，便于测试：

```ts
interface CursorRuntime {
  create(options: CursorAgentOptions): Promise<CursorAgentLike>;
  resume(agentId: string, options: CursorAgentOptions): Promise<CursorAgentLike>;
}
```

生产 runtime：

```ts
const { Agent } = await import('@cursor/sdk');
const agent = await Agent.create({
  apiKey,
  model: { id: model },
  local: { cwd: workspacePath },
});
```

`resume` 使用：

```ts
await Agent.resume(agentId, {
  apiKey,
  model: { id: model },
  local: { cwd: workspacePath },
});
```

包装 `SDKAgent`：

```ts
async function send(prompt: string): Promise<string> {
  const run = await agent.send(prompt);
  const result = await run.wait();
  if (result.status === 'error') throw new Error(`Cursor agent run failed: ${run.id}`);
  return result.result ?? '';
}
```

Cursor provider 调用流程：

1. 校验 `sessionId` 和 API key。
2. 读取 role。
3. 查询 `db.getAgentSession('cursor', roleId, sessionId)`。
4. 如果存在：`cursorRuntime.resume(existing.externalId, options)`。
5. 如果不存在：
  1. `cursorRuntime.create(options)`。
  2. 构造初始化 prompt：
    - `You are being initialized as the Relay expert role "${roleId}".`
    - `## Role System Prompt\n${role.systemPrompt}`
    - `## Knowledge Base\n${allChunks}`
    - optional `## Additional Context\n${context}`
    - `Keep this role and knowledge context for the rest of this agent session. Reply with a brief acknowledgement only.`
  3. `agent.send(initPrompt)`。
  4. 写 `agent_sessions`，externalId 为 Cursor agentId。
6. 对当前用户 prompt 调用 `agent.send(input.prompt)`。
7. 返回 `{ text, toolCalls: [], stopReason: 'end_turn' }`。

注意：初始化 prompt 和用户 prompt 是两次 send。这样后续同一个 sessionId 不再由 Relay 发送所有 chunks，只发送用户 prompt。上下文复用依赖 Cursor agent 会话。

### 7.4 Claude CLI provider

如果 `config.spawner.mode === "cli"`：

```bash
claude -p <prompt> --system <role.systemPrompt>
```

使用 Node `child_process.spawn`，收集 stdout/stderr，exit code 非 0 时 reject。

## 8. MCP Server

`src/mcp/server.ts` 是最重要的入口。`createMcpServer()` 应完成：

1. `const config = loadConfig()`。
2. `const db = getDatabase(); db.init(); seedBuiltinRoles(db)`。
3. 创建 `WorkflowEngine` 和 `AgentSpawner`。
4. `new McpServer({ name: 'relay', version: '0.1.0' })`。
5. 注册 tools 和 prompts。
6. 返回 server。

`startMcpServer()` 使用 `StdioServerTransport` 并 `mcp.connect(transport)`。

### 8.1 Workflow tools

#### init_workflow

Input：`projectPath, title, brief?`。

调用 `engine.initWorkflow`，返回 campaignId、title、status 和提示消息。

#### get_cycle_state

Input：`cycleId?`, `campaignId?`。

调用 `engine.getCycleState(cycleId, campaignId)`，无 active cycle 时返回文本 `No active cycle found.`。

#### complete_cycle

Input：`cycleId, passRate?, failedTests?, screenshots?`。

将 screenshots 补 `capturedAt`，调用 `engine.completeCycle`，返回 completedCycleId、cycleNum、nextCycleId 和提示消息。

### 8.2 Task tools

#### create_tasks

Input：

```ts
{
  cycleId: string;
  tasks: Array<{
    role: 'dev' | 'test';
    title: string;
    description?: string;
    acceptance?: string[];
    e2eScenarios?: string[];
  }>;
  productBrief?: string;
}
```

如果传 productBrief，先写到 cycle.productBrief。然后 `engine.createTasks`。

#### get_my_tasks

Input：`cycleId, role`。返回该 role 的 tasks。

#### complete_task

Input：`taskId, result, docAuditToken?`。调用 `engine.completeTask`。

#### add_task_comment

Input：`taskId, comment`。append 到 task comments。

#### create_bug_tasks

Input：`cycleId, bugs[]`。调用 `engine.createBugTasks`。

#### add_product_feedback

Input：`cycleId, feedback`。追加到 cycle.productBrief 的 Test Feedback 段落。

### 8.3 Doc-first tool

#### update_doc_first

Input：`filePath, content, taskId?`。

行为：

1. `mkdirSync(dirname(filePath), { recursive: true })`。
2. `writeFileSync(filePath, content, 'utf8')`。
3. `contentHash = sha256(content).slice(0,16)`。
4. `token = randomUUID()`。
5. 写 `doc_audit_log`。
6. 返回 `{ auditToken, filePath, message }`。

这是项目纪律的核心：dev task 完成时必须带这个 token。

### 8.4 Role / knowledge tools

#### list_roles

返回 role 列表：id、name、isBuiltin、docPath。

#### get_role

Input：`roleId`。返回完整 role，包括 systemPrompt。

#### train_role

Input：`roleId, name, documents[], baseSystemPrompt?`。使用 pseudo embedding 调用 `trainRole`，返回 roleId、name、chunksIndexed 和使用提示。

#### search_knowledge

Input：`roleId, query, topK?`。调用 `searchKnowledge`，默认 topK=5。

### 8.5 spawn_agent

Input：`roleId, prompt, context?, provider?, sessionId?`。

- 默认 provider 为空时走 Anthropic/CLI 分支。
- `provider="cursor"` 时要求 `sessionId`，走 Cursor SDK local agent 复用。

返回 JSON：

```json
{
  "stopReason": "end_turn",
  "toolCallCount": 0,
  "text": "...",
  "toolCalls": []
}
```

### 8.6 Screenshot / test tools

#### capture_screenshot

Input：`cycleId, filePath, description`。调用 `engine.captureScreenshot`。

#### run_e2e_tests

Input：`cycleId, testPattern?`。执行：

```bash
npx playwright test "${pattern}" --reporter=json --screenshot=on
```

默认 pattern：`tests/e2e/**`。成功返回前 2000 字符输出，失败返回错误文本并 `isError: true`。

### 8.7 Campaign tools

#### list_campaigns

返回 campaign 列表，包含 id、title、status、brief 前 200 字符、startedAt。

#### summarize_campaign

Input：`campaignId`。调用 `summarizeCampaign`，返回结构化 summary。

### 8.8 Requirement tools

#### capture_requirement

三步状态机：

1. `action="start"`：需要 `chatContext` 和 `name` 或 `requirementId`。
  - 新需求：返回 5 个澄清问题。
  - 更新旧需求：预填已有 purpose/changes/tags，返回更新相关问题。
  - 创建 `capture_sessions` 记录，phase=`questioning`。
2. `action="answer"`：需要 `sessionId` 和 `answers`。
  - 合并 answers。
  - `buildDraft` 生成 draft。
  - phase 改为 `confirming`。
3. `action="confirm"`：需要 `sessionId`，可传 edits。
  - 如果是新需求，创建 `requirements`。
  - 如果是更新旧需求，merge changes/tags/docs/context。
  - phase 改为 `done`。

#### recall_requirement

Input：`id?`, `name?`。

- 无参数：返回需求列表供选择。
- `id`：返回 `formatRequirementForInjection(req)`。
- `name`：模糊搜索；如果唯一命中，直接返回完整注入内容；多个命中则返回列表。

### 8.9 setup_project_rules

Input：`projectPath, rules[]`，rules 可选：`doc-first | role-product | role-developer | role-qa | git-branch`。

行为：

1. 写 `.cursor/rules/relay.mdc`，frontmatter 为 `alwaysApply: true`。
2. 写或合并 `CLAUDE.md`，用 `<!-- relay-rules-start -->` 和 `<!-- relay-rules-end -->` 标记区块。
3. 返回写入文件列表。

### 8.10 MCP prompts

注册这些 prompts：

- `relay:doc-first`
- `relay:role-product`
- `relay:role-developer`
- `relay:role-qa`
- `relay:recall-requirement`

这些 prompts 只是把项目纪律和角色规范以 prompt 形式提供给客户端，不直接执行逻辑。

## 9. Requirement Memory 实现

`src/requirements/capture.ts` 是纯业务逻辑，不依赖 LLM。

### 9.1 startCapture

输入：`db, chatContext, name, requirementId?`。

行为：

- 如果传 requirementId，读取已有 requirement。
- 创建 capture session：
  - answers 包含 `_context` 和 `_name`。
  - 如果更新旧需求，预填 purpose、changes、tags。
- 返回 sessionId、isUpdate、existing、questions。

新需求问题：

1. 核心目的是什么？
2. 是否有背景文档/PRD/设计稿/参考链接？
3. 做了哪些主要改动？
4. 最终达成了什么结果？
5. 属于哪个方向/标签？

更新旧需求问题更聚焦：changes、outcome、purpose 是否变化、tags 是否新增。

### 9.2 submitAnswers

- 读取 session。
- 合并原 answers 和新 answers。
- 调用 `buildDraft`：
  - tags 按逗号/中文逗号/顿号/空白切分。
  - changes 按换行/分号切分。
  - relatedDocs 从 background 切分。
  - summary 用 Markdown 拼出 `目的`、`改动`、`结果`。
- 更新 session phase=`confirming`，保存 draft。

### 9.3 confirmCapture

新建 requirement：

- id = randomUUID。
- name = edits.name ?? draft.name ?? answers._name ?? `Untitled`。
- context = answers._context。
- status = `confirmed`。
- createdAt/updatedAt = now。

更新旧 requirement：

- context = existing.context + separator + session.answers._context。
- relatedDocs/tags merge 去重。
- changes 用 mergeChanges，按前 20 字符近似去重。
- status = `confirmed`。

`src/requirements/recall.ts` 需要实现：

- `recallRequirements(db, query?)`：直接调用 `db.listRequirements(query)`。
- `formatRequirementForInjection(req)`：输出可注入当前 chat 的 Markdown，包含名称、目的、状态、标签、摘要、主要改动、相关文档、上下文等。

## 10. Campaign Summarizer

`src/summarizer/campaign.ts` 使用 Anthropic 对 campaign 做跨 cycle 总结。

### 10.1 summarizeCampaign

输入：`db, campaignId, config`。

行为：

1. 读取 campaign。
2. 读取 cycles。
3. 对每个 cycle：
  - devWork = 已完成且有 result 的 dev tasks，格式 `title: result`。
  - testResults = test tasks completed/failed 计数。
  - screenshots = cycle.screenshots 的 description。
4. 调用 `buildSummarizationPrompt(title, brief, cycleSummaries)`。
5. Anthropic `messages.create`，max_tokens=2048。
6. `parseSummaryResponse` 提取 `## Why`、`## Key Decisions`、`## Overall Path`。
7. 将 campaign status 更新为 `completed`，写 completedAt 和 summary JSON。
8. 返回 `CampaignSummary`。

### 10.2 返回结构

```ts
interface CampaignSummary {
  why: string;
  cycles: CycleSummary[];
  keyDecisions: string[];
  overallPath: string;
}
```

## 11. Express Dashboard API

`src/server/api.ts` 创建 HTTP server。

启动方式：`startApiServer(port, webDistPath?)`，内部调用 `createApiServer(webDistPath)` 并 listen。

如果 `webDistPath` 存在：

- `app.use(express.static(webDistPath))`
- 最后注册 SPA fallback：`app.get('/{*path}', send index.html)`。

API：

### 11.1 Requirements

- `GET /api/requirements?q?`：返回 `recallRequirements(db, query)`。
- `GET /api/requirements/:id`：返回单个 requirement。
- `PATCH /api/requirements/:id`：只允许更新 `name, purpose, context, summary, relatedDocs, changes, tags, status`。
- `POST /api/requirements/:id/chat`：用 Anthropic 根据当前 requirement 内容回答用户问题。
- `POST /api/requirements/:id/apply-chat`：把前端 chat history 交给 Anthropic，提取可写回字段，只允许 `context, summary, changes`。

`apply-chat` 关键安全/质量规则：

- system prompt 要求只返回纯 JSON。
- 只 whitelist `context, summary, changes`。
- 删除任何 `不变/无变化/unchanged/no change/same` 等占位值。
- changes 是数组时，与已有 changes merge 去重。

### 11.2 Requirement todos

- `POST /api/requirements/:id/todos`：新增 todo，body `{ text }`。
- `PATCH /api/requirements/:id/todos/:todoId`：更新 done 或 text。
- `DELETE /api/requirements/:id/todos/:todoId`：删除 todo。

Todos 保存在 requirement.todos JSON array 中。

### 11.3 Campaigns

- `GET /api/campaigns`：返回 campaign 列表。
- `GET /api/campaigns/:id`：返回 campaign 和 cycles。

### 11.4 Roles

- `GET /api/roles`：返回所有 roles。
- `GET /api/roles/:id/chunks`：返回该 role 的 chunks，按 sourceFile 分组：

```json
{
  "total": 30,
  "sources": {
    "file.md": [{ "id": "...", "chunkText": "..." }]
  }
}
```

## 12. Web Dashboard

`web/` 是 pnpm workspace package，名称 `relay-web`。使用 React、React Router、React Markdown、Vite、Tailwind。

### 12.1 Vite 配置

`web/vite.config.ts`：

- React plugin。
- Tailwind Vite plugin。
- alias `@` -> `web/src`。
- dev server proxy：
  - `/api` -> `http://localhost:3000`
  - `/ws` -> `ws://localhost:3000`

### 12.2 Routing

`web/src/App.tsx`：

- sidebar 导航：需求库、专家库。
- routes：
  - `/` -> `Requirements`
  - `/requirements` -> `Requirements`
  - `/requirements/:id` -> `RequirementDetail`
  - `/roles` -> `Roles`

### 12.3 useGet hook

`web/src/hooks/useApi.ts`：

- `useGet<T>(url: string | null)`：当 url 为 null 时跳过请求；否则 fetch JSON，维护 `data/loading/error/refetch`。
- `useSearch<T>()` 目前包装 `/api/search`，但后端当前没有对应 route，重实现时要么补 route，要么删除此未用 hook。

### 12.4 Requirements page

功能：

- 搜索输入：修改 query 后请求 `/api/requirements?q=...`。
- 空状态提示用户调用 MCP `capture_requirement(action: "start", ...)`。
- 列表卡片展示 name、purpose、tags、status、updatedAt。
- 点击进入 `/requirements/:id`。

### 12.5 RequirementDetail page

功能：

- 展示 requirement 的 purpose、summary、changes。
- 右侧 sidebar 展示 tags、todos、relatedDocs、createdAt/updatedAt。
- TodoList 支持新增、勾选/更新、删除，调用后端 todo API。
- Chat drawer：
  - 用户输入后 POST `/api/requirements/:id/chat`。
  - 显示 assistant 回复。
  - 有消息后可点击“更新需求”，POST `/api/requirements/:id/apply-chat`，成功后 refetch requirement。

注意：当前前端 chat 使用 Anthropic requirement chat API，不会自动使用 goofy 专家或 Cursor SDK spawner。goofy/Cursor 是 MCP `spawn_agent` 路径。

### 12.6 Roles page

功能：

- `GET /api/roles` 列出内置和自定义角色。
- 每个角色可展开 System Prompt。
- 自定义角色可展开知识库，通过 `/api/roles/:id/chunks` 获取 chunks。
- KnowledgePanel 按 sourceFile 折叠展示 chunk 数和字符量。

## 13. CLI

`src/cli/index.ts` 使用 commander。

### 13.1 relay mcp

启动 MCP server on stdio：

```bash
relay mcp
```

内部调用 `startMcpServer()`。

### 13.2 relay init

行为：

1. 创建 `~/.relay`。
2. 如果 `~/.relay/config.json` 不存在，写默认配置。
3. 初始化数据库，seed builtin roles。
4. 输出下一步提示：设置 API key、添加 MCP server。

注意：当前 init 默认配置里没有写 cursor 字段。重实现时建议补上 cursor 默认配置，和 `getDefaultConfig()` 保持一致。

### 13.3 relay workflow

子命令：

- `workflow start <projectPath> <title> [-b brief]`：创建 campaign 和第一轮 cycle。
- `workflow list`：列出 campaigns。
- `workflow status <campaignId>`：展示 active cycle、dev tasks、test tasks。

### 13.4 relay roles

列出 roles，标记 builtin/custom，展示 docPath。

### 13.5 relay campaign summarize

输入 campaignId，读取 config 和 DB，调用 `summarizeCampaign`，输出 WHY、KEY DECISIONS、OVERALL PATH。

### 13.6 relay web

启动 dashboard：

```bash
relay web --port 3000
```

它使用 `new URL('../../web/dist', import.meta.url).pathname` 找生产 frontend dist，然后调用 `startApiServer(port, webDist)`。

## 14. 构建与脚本

根 `package.json`：

```json
{
  "type": "module",
  "bin": { "relay": "./bin/relay.mjs" },
  "scripts": {
    "dev": "tsup --watch",
    "dev:web": "pnpm --filter relay-web dev",
    "dev:api": "node dist/cli/index.js web",
    "build": "tsup && pnpm --filter relay-web build",
    "build:backend": "tsup",
    "build:frontend": "pnpm --filter relay-web build",
    "web": "pnpm build && node dist/cli/index.js web",
    "start": "node dist/cli/index.js start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - '.'
  - 'web'
```

`pnpm.onlyBuiltDependencies` 必须包含：

- `better-sqlite3`
- `esbuild`
- `sqlite3`

原因：`@cursor/sdk` 依赖 `sqlite3` native binding，如果 pnpm 阻止 build scripts，Cursor SDK import 会失败，报无法定位 `node_sqlite3.node`。

`tsup.config.ts`：entry 包含：

- `src/cli/index.ts` -> `dist/cli/index.js`
- `src/mcp/server.ts` -> `dist/mcp/server.js`
- `src/mcp/run.ts` -> `dist/mcp/run.js`

格式 ESM，target node18，splitting true，sourcemap true。

## 15. 端到端业务流程

### 15.1 Vibe coding campaign

1. 用户或 CLI 调 `init_workflow(projectPath, title, brief)`。
2. Relay 创建 campaign 和 cycle 1，cycle 状态为 `product`。
3. Product Agent 调 `get_cycle_state`，读取当前 cycle 和上一轮信息。
4. Product Agent 必须先调 `update_doc_first("docs/product/PRD.md", content)` 记录产品决策。
5. Product Agent 调 `create_tasks(cycleId, tasks, productBrief?)`，cycle 进入 `dev`。
6. Dev Agent 调 `get_my_tasks(cycleId, "dev")`。
7. Dev Agent 每个任务先调 `update_doc_first` 获取 auditToken，再实现代码。
8. Dev Agent 调 `complete_task(taskId, result, docAuditToken)`。
9. 所有 dev tasks 完成后 cycle 自动进入 `test`。
10. Test Agent 调 `get_my_tasks(cycleId, "test")`。
11. Test Agent 写 Playwright e2e，调 `run_e2e_tests` 或本地跑测试，调 `capture_screenshot` 记录截图。
12. 如果失败，Test Agent 调 `create_bug_tasks`，cycle 回到 `dev`。
13. 如果通过，Test Agent 调 `complete_cycle`，当前 cycle 完成，Relay 自动创建下一 cycle，状态 `product`。

### 15.2 自定义专家训练与调用

1. 调 `train_role(roleId, name, documents, baseSystemPrompt?)`。
2. Relay 将文档 chunk 成约 800 字符片段，生成 embedding，写 `knowledge_chunks`。
3. 调 `spawn_agent(roleId, prompt)`：默认 Anthropic provider。
4. 调 `spawn_agent(roleId, prompt, provider="cursor", sessionId="chat-id")`：Cursor provider。
  - 第一次：创建 Cursor local agent，发送 role prompt + 所有 chunks。
  - 之后同 sessionId：resume 同一个 agent，只发送 prompt。

### 15.3 需求沉淀与唤起

1. 在任意 chat 中调：
  `capture_requirement(action="start", name="...", chatContext="...")`。
2. 回答 questions 后调：
  `capture_requirement(action="answer", sessionId, answers={...})`。
3. 审阅 draft 后调：
  `capture_requirement(action="confirm", sessionId, edits?)`。
4. 以后可调：
  `recall_requirement()` 列表，或 `recall_requirement(name="...")` / `recall_requirement(id="...")` 注入上下文。
5. Dashboard 的需求详情页也可以对需求聊天，并用 `apply-chat` 将对话新增信息写回需求。

## 16. 重实现建议顺序

如果另一个 agent 要从零重写，建议按下面顺序实现，保证每一步可测试。

### Step 1: 项目骨架

- 建 TypeScript ESM 项目。
- 配置 pnpm workspace 和 web workspace。
- 加依赖：`@modelcontextprotocol/sdk`、`better-sqlite3`、`commander`、`zod`、`@anthropic-ai/sdk`、`@cursor/sdk`、`express`、`tsup`、`vitest`。
- 配置 `tsconfig.json`、`tsup.config.ts`、package scripts。

验收：`pnpm typecheck` 能跑空项目。

### Step 2: 配置与数据库

- 实现 `config.ts`。
- 实现 `AgentForgeDB` schema 和 repository methods。
- 写 Vitest 覆盖 campaigns/cycles/tasks/roles/chunks/agent_sessions/requirements/capture_sessions/doc_audit。

验收：数据库单测通过。

### Step 3: workflow engine

- 实现 `WorkflowEngine`。
- 覆盖状态推进：init -> product、createTasks -> dev、complete dev tasks -> test、completeCycle -> next product、createBugTasks -> dev。
- 覆盖 docAuditToken 校验。

验收：workflow 单测通过。

### Step 4: roles library

- 实现 builtin role prompts。
- 实现 seedBuiltinRoles、trainRole、chunkDocument、searchKnowledge、cosineSimilarity。
- 覆盖 chunk overlap、重新训练删除旧 chunks、RAG topK 排序。

验收：roles 单测通过。

### Step 5: spawner

- 先实现 Anthropic provider，mock Anthropic stream 做测试。
- 再实现 CursorRuntime injection 和 Cursor provider 单测：
  - new session 发送 initPrompt + user prompt。
  - same session resume，只发送 user prompt。
  - missing sessionId 报错。
  - missing cursor apiKey 报错。
- 最后实现 Claude CLI provider。

验收：spawner 单测通过；可用真实 `CURSOR_API_KEY` 做 smoke test。

### Step 6: MCP server

- 注册全部 tools 和 prompts。
- 用 zod v4 定义 input schemas。
- 保证 `createMcpServer()` 初始化 DB 和 builtin roles。
- `startMcpServer()` 使用 stdio transport。

验收：通过 MCP client 或本地集成测试调用关键 tools。

### Step 7: requirement memory

- 实现 capture.ts 和 recall.ts。
- 覆盖新建需求、更新需求、merge changes/tags/docs、format injection。

验收：requirement 单测通过。

### Step 8: campaign summarizer

- 实现 prompt builder、response parser、Anthropic 调用。
- 测试 parser 对缺失 section 的 fallback。

验收：summarizer 单测通过。

### Step 9: CLI

- 实现 `relay init/mcp/workflow/roles/campaign/web`。
- 确认 `relay init` 写 config 并 seed roles。
- 确认 `relay web` 能启动 API + static frontend。

验收：CLI smoke test。

### Step 10: Dashboard API 和前端

- 实现 Express API。
- 实现 React 页面：Requirements、RequirementDetail、Roles。
- Vite proxy `/api` 到 3000。
- 生产 build 后由 Express static serve `web/dist`。

验收：`pnpm build` 成功，`pnpm web` 后 `curl -I http://localhost:3000` 返回 200。

## 17. 关键测试清单

至少保留这些测试：

- `src/storage/database.test.ts`
  - campaign CRUD。
  - cycle active lookup。
  - task JSON fields。
  - requirement arrays/todos。
  - capture session phase/draft。
  - doc audit insert/get。
  - agent_sessions upsert/get。
- `src/roles/library.test.ts`
  - chunkDocument 单 chunk、多 chunk、overlap。
  - cosineSimilarity。
  - trainRole create/replace chunks。
  - searchKnowledge topK。
- `src/workflow/engine.test.ts`
  - 状态机推进。
  - dev task docAuditToken required。
  - bug tasks revert to dev。
- `src/requirements/capture.test.ts`
  - start/answer/confirm。
  - update existing requirement。
  - merge/dedupe。
- `src/requirements/recall.test.ts`
  - formatRequirementForInjection。
- `src/summarizer/campaign.test.ts`
  - buildSummarizationPrompt。
  - parseSummaryResponse。
- `src/spawner/index.test.ts`
  - Cursor provider first call sends chunks once。
  - same session resumes same external id。
  - missing sessionId error。
  - default Anthropic path unchanged。

最终验证命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 18. 已知实现注意点与坑

1. `update_doc_first` 使用传入 `filePath` 直接写文件。MCP server 的工作目录可能不是用户当前 git repo。调用时如果要保证写到指定仓库，最好传绝对路径或确保 MCP server cwd 正确。
2. `@cursor/sdk` 引入 `sqlite3` native binding。pnpm 必须允许 `sqlite3` build script，否则 import Cursor SDK 会失败。
3. Cursor SDK 模型名必须来自 Cursor 可用模型列表。示例可用：`composer-2`、`gpt-5.5` 等。错误模型会抛 `ConfigurationError: Cannot use this model`。
4. Dashboard requirement chat 目前仍走 Anthropic，不走 `spawn_agent`。如果要让 dashboard chat 支持 goofy/Cursor，需要在 API 层另加 provider/sessionId 参数并调用 `AgentSpawner`。
5. Anthropic provider 对小知识库全量注入，适合可靠性，但对同一 chat 多次调用会重复发送 chunks。Cursor provider 解决的是同一 `sessionId` 下的重复发送问题。
6. `spawner.mode='cli'` 只影响默认 provider；显式 `provider='cursor'` 应始终走 Cursor SDK。
7. `complete_task` 只强制 dev 任务带 docAuditToken，test 任务不强制。
8. `complete_cycle` 会自动创建下一轮 product cycle，不会自动关闭 campaign。Campaign 结束由 `summarize_campaign` 将 status 改为 completed。
9. `useSearch` hook 指向 `/api/search`，当前后端没有实现这个 route。重实现时需要确认是否保留。
10. `relay init` 当前写出的默认配置未包含 cursor 字段。重实现时建议同步默认 config，避免用户手写。

## 19. 最小可运行示例

### 初始化

```bash
pnpm install
pnpm build
node dist/cli/index.js init
```

编辑 `~/.relay/config.json`：

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "sk-ant-..."
  },
  "cursor": {
    "apiKey": "crsr_...",
    "model": "gpt-5.5",
    "workspacePath": "/Users/bytedance/projects/relay"
  },
  "spawner": {
    "mode": "sdk",
    "fallbackToCli": true
  },
  "server": { "port": 3000 },
  "playwright": {
    "browser": "chromium",
    "screenshotDir": "/Users/bytedance/.relay/screenshots"
  }
}
```

### 启动 MCP

```bash
node dist/cli/index.js mcp
```

Cursor/Claude Code 通过 MCP config 指向此命令。

### 启动 Dashboard

```bash
pnpm web
```

访问 `http://localhost:3000`。

### Cursor expert session 调用形态

MCP tool 调用：

```json
{
  "roleId": "goofy-expert",
  "provider": "cursor",
  "sessionId": "chat-123",
  "prompt": "请基于 goofy 专家知识回答这个问题..."
}
```

第一次 `chat-123` 会创建 Cursor local agent 并发送所有 goofy chunks。后续同一个 `chat-123` 只发送新 prompt，并 resume 同一个 Cursor agent。

## 20. 项目当前能力总览

当前 Relay 已具备：

- 多 agent 工作流编排：campaign/cycle/task 状态机。
- Doc-first 强制：update_doc_first + doc_audit_token。
- 内置 product/developer/tester 角色规范。
- 自定义专家训练：上传文档、chunk、embedding、RAG。
- 专家调用：Anthropic SDK、Claude CLI、Cursor SDK local agent。
- Cursor expert session 复用：基于 `(provider, roleId, sessionId)` 的 SQLite session store。
- 需求沉淀：多轮 capture、draft、confirm、更新已有需求。
- 需求唤起：recall requirement 并格式化为 chat context。
- Campaign 总结：基于 cycles/tasks/screenshots 生成 why/decisions/path。
- Dashboard：需求库、需求详情、需求聊天、写回需求、待办、专家库、知识片段浏览。
- 项目规则注入：写 `.cursor/rules/relay.mdc` 和 `CLAUDE.md`。
- Playwright 测试触发与截图记录工具。

如果要复刻项目，优先实现 MCP server、SQLite schema、WorkflowEngine、Role/Knowledge、AgentSpawner 这五个核心模块；Dashboard 和 CLI 可以在核心稳定后补上。