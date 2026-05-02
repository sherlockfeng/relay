# Relay Project Blueprint

This document is a rebuild-grade blueprint for Relay. A capable agent should be able to implement the project from an empty repository by following the product model, architecture, data model, module contracts, command list, API surface, and test plan described here.

## 1. Product Definition

Relay is an MCP-first multi-agent orchestration platform. It is designed for AI coding environments such as Cursor and Claude Code, where the user wants repeatable product -> developer -> tester workflows, reusable expert roles, remembered requirements, and local dashboard visibility.

Relay is not primarily a normal always-on SaaS backend. Its primary entry point is an MCP server exposed over stdio. A web dashboard and HTTP API exist as optional local UI surfaces over the same SQLite data.

Core capabilities:

- Start and manage a campaign, which represents a larger product or engineering effort.
- Drive each campaign through repeated product -> dev -> test cycles.
- Store tasks assigned to dev and test agents.
- Enforce doc-first behavior for dev tasks through an audit token.
- Seed built-in product, developer, and tester roles.
- Train custom expert roles from uploaded documents or source code.
- Search role knowledge chunks.
- Spawn role-specific agents through Cursor SDK, Anthropic SDK, or Claude CLI.
- Default `spawn_agent` to Cursor Agent session reuse in MCP calls.
- Capture requirements from chat and recall them into future chats.
- Summarize multi-cycle campaigns.
- Serve a local dashboard for requirements and expert roles.

Non-goals in the current implementation:

- It does not provide a multi-user hosted backend.
- It does not implement authentication for the local dashboard.
- It does not provide production vector embeddings; pseudo embeddings are used unless a real embedding implementation is added.
- It does not currently implement a WebSocket server, even though the web Vite config and a hook mention `/ws`.

## 2. Repository Shape

Create the project as a pnpm workspace with a backend package at the repository root and a web app in `web/`.

```text
relay/
├── AGENTS.md
├── PROJECT_BLUEPRINT.md
├── README.md
├── bin/
│   └── relay.mjs
├── docs/
│   ├── roles/
│   │   ├── product.md
│   │   ├── developer.md
│   │   └── tester.md
│   ├── tech/
│   │   ├── DESIGN.md
│   │   ├── CURSOR_DEFAULT_SPAWN.md
│   │   └── REIMPLEMENTATION_GUIDE.md
│   ├── product/
│   │   └── PRD.md
│   ├── test/
│   │   └── TEST_STRATEGY.md
│   └── collab/
│       └── LOG.md
├── src/
│   ├── cli/index.ts
│   ├── config.ts
│   ├── mcp/run.ts
│   ├── mcp/server.ts
│   ├── requirements/capture.ts
│   ├── requirements/recall.ts
│   ├── roles/library.ts
│   ├── roles/builtin/product.ts
│   ├── roles/builtin/developer.ts
│   ├── roles/builtin/tester.ts
│   ├── server/api.ts
│   ├── spawner/index.ts
│   ├── storage/database.ts
│   ├── summarizer/campaign.ts
│   └── workflow/engine.ts
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
└── web/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── hooks/useApi.ts
        ├── hooks/useWebSocket.ts
        ├── pages/Requirements.tsx
        ├── pages/RequirementDetail.tsx
        ├── pages/Roles.tsx
        ├── types.ts
        └── components/*.tsx
```

The current implementation keeps all MCP tool registration in `src/mcp/server.ts`. Do not create a `src/mcp/tools/` split unless intentionally refactoring.

## 3. Runtime And Dependencies

Root package requirements:

- ESM TypeScript package: `"type": "module"`.
- Node >= 20 recommended.
- Package manager: pnpm workspace.
- Binary: `relay` points to `./bin/relay.mjs`.

Root dependencies:

- `@modelcontextprotocol/sdk` for MCP server and stdio transport.
- `@anthropic-ai/sdk` for Anthropic messages and streaming.
- `@cursor/sdk` for Cursor local agent create/resume.
- `better-sqlite3` for local SQLite storage.
- `commander` for CLI.
- `express` for local HTTP dashboard API.
- `playwright` for test runner invocation.
- `uuid` or `node:crypto` random UUID for identifiers.
- `zod` for MCP input schemas.
- `tsup`, `typescript`, `vitest`, and `@types/*` for build/test.

`pnpm.onlyBuiltDependencies` must include at least `better-sqlite3`, `esbuild`, and `sqlite3`, because Cursor SDK brings native SQLite-related dependencies that need build permission in pnpm environments.

Web dependencies:

- `react`, `react-dom`, `react-router-dom`, `react-markdown`.
- Vite, Tailwind, React plugin, TypeScript, and relevant type packages.

Root scripts:

- `dev`: `tsup --watch`
- `dev:web`: `pnpm --filter relay-web dev`
- `dev:api`: `node dist/cli/index.js web`
- `build`: `tsup && pnpm --filter relay-web build`
- `build:backend`: `tsup`
- `build:frontend`: `pnpm --filter relay-web build`
- `web`: `pnpm build && node dist/cli/index.js web`
- `test`: `vitest run`
- `test:watch`: `vitest`
- `typecheck`: `tsc --noEmit`

Note: if adding a `start` script, ensure it maps to an implemented CLI command. The current code historically had a `start` script pointing to a non-existent `start` command.

## 4. Configuration System

Implement `src/config.ts`.

Configuration file path:

```ts
const CONFIG_DIR = join(homedir(), '.relay');
export const CONFIG_FILE_PATH = join(CONFIG_DIR, 'config.json');
```

`AppConfig` shape:

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

Default config:

- `llm.provider = 'anthropic'`
- `llm.model = 'claude-sonnet-4-6'`
- `llm.apiKey = process.env.ANTHROPIC_API_KEY ?? ''`
- `cursor.apiKey = process.env.CURSOR_API_KEY ?? ''`
- `cursor.model = 'composer-2'`
- `cursor.workspacePath = process.cwd()`
- `spawner.mode = 'sdk'`
- `spawner.fallbackToCli = true`
- `server.port = 3000`
- `playwright.browser = 'chromium'`
- `playwright.screenshotDir = join(homedir(), '.relay', 'screenshots')`

Functions to implement:

- `getConfigDir(): string`
- `getDefaultConfig(): AppConfig`
- `loadConfig(): AppConfig`
- `saveConfig(config: AppConfig): void`

`loadConfig` must tolerate missing or invalid config files and fall back to defaults. `mergeConfig` must only accept recognized enum values. The `cursor` field is optional in user config, but `getDefaultConfig` may provide it.

Never write secrets into the repository. API keys live in `~/.relay/config.json` or environment variables.

## 5. SQLite Storage

Implement `src/storage/database.ts` around `better-sqlite3`.

Default DB path:

```ts
export const DEFAULT_DB_PATH = join(homedir(), '.relay', 'data.db');
```

The class is named `AgentForgeDB`. Constructor creates the parent directory, opens the DB, and sets:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

Expose a singleton helper:

```ts
export function getDatabase(dbPath?: string): AgentForgeDB
```

The helper should create and initialize the singleton once. `close()` should clear the singleton when closing that instance.

### 5.1 Tables

Create all tables in `init()` with `CREATE TABLE IF NOT EXISTS`.

`campaigns` stores long-running product efforts:

```sql
CREATE TABLE IF NOT EXISTS campaigns (
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

`cycles` stores one product -> dev -> test loop:

```sql
CREATE TABLE IF NOT EXISTS cycles (
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

Cycle statuses are `pending`, `product`, `dev`, `test`, `completed`. `screenshots` is JSON.

`tasks` stores dev/test task entries:

```sql
CREATE TABLE IF NOT EXISTS tasks (
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

Task roles are `dev` and `test`. Task statuses are `pending`, `in_progress`, `completed`, `failed`. `acceptance`, `e2e_scenarios`, and `comments` are JSON arrays.

`roles` stores built-in and custom agent roles:

```sql
CREATE TABLE IF NOT EXISTS roles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  doc_path      TEXT,
  is_builtin    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);
```

`knowledge_chunks` stores training chunks and optional embeddings:

```sql
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  source_file TEXT,
  chunk_text  TEXT NOT NULL,
  embedding   BLOB,
  created_at  TEXT NOT NULL
);
```

`agent_sessions` stores Cursor Agent session reuse:

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  provider    TEXT NOT NULL,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (provider, role_id, session_id)
);
```

For Cursor, `external_id` is `agent.agentId` from `@cursor/sdk`.

`doc_audit_log` stores doc-first writes:

```sql
CREATE TABLE IF NOT EXISTS doc_audit_log (
  token        TEXT PRIMARY KEY,
  task_id      TEXT,
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
```

`requirements` stores captured requirement memory:

```sql
CREATE TABLE IF NOT EXISTS requirements (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  purpose      TEXT,
  context      TEXT NOT NULL,
  summary      TEXT,
  related_docs TEXT,
  changes      TEXT,
  tags         TEXT,
  project_path TEXT,
  status       TEXT DEFAULT 'draft',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

A migration should attempt to add `todos TEXT`:

```sql
ALTER TABLE requirements ADD COLUMN todos TEXT;
```

Catch and ignore the duplicate-column error.

`capture_sessions` stores in-progress multi-turn requirement capture:

```sql
CREATE TABLE IF NOT EXISTS capture_sessions (
  id             TEXT PRIMARY KEY,
  requirement_id TEXT,
  phase          TEXT NOT NULL,
  answers        TEXT DEFAULT '{}',
  draft          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_cycles_campaign ON cycles(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tasks_cycle ON tasks(cycle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_role ON tasks(role, status);
CREATE INDEX IF NOT EXISTS idx_chunks_role ON knowledge_chunks(role_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_role ON agent_sessions(role_id);
CREATE INDEX IF NOT EXISTS idx_requirements_name ON requirements(name);
```

### 5.2 TypeScript Models

Implement interfaces for `Campaign`, `Cycle`, `Screenshot`, `Task`, `Role`, `KnowledgeChunk`, `RequirementTodo`, `Requirement`, `CaptureSession`, `DocAuditEntry`, and `AgentSession`.

Important shapes:

```ts
export interface RequirementTodo {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export interface AgentSession {
  provider: string;
  roleId: string;
  sessionId: string;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}
```

Use row mapping helpers to translate snake_case columns to camelCase objects. JSON columns should parse with a fallback; invalid JSON should not crash reads.

Embeddings are stored as BLOBs using `Buffer.from(float32Array.buffer)` and loaded as `new Float32Array(buffer.buffer)`. If reimplementing carefully, preserve byte offsets to avoid subtle typed-array bugs when slicing Buffers.

### 5.3 Repository Methods

Implement these methods:

- Campaigns: `insertCampaign`, `getCampaign`, `listCampaigns`, `updateCampaign`
- Cycles: `insertCycle`, `getCycle`, `getActiveCycle`, `listCycles`, `updateCycle`
- Tasks: `insertTask`, `getTask`, `listTasks`, `updateTask`
- Roles: `upsertRole`, `getRole`, `listRoles`
- Knowledge: `insertChunk`, `getChunksForRole`, `deleteChunksForRole`
- Agent sessions: `upsertAgentSession`, `getAgentSession`
- Requirements: `insertRequirement`, `updateRequirement`, `getRequirement`, `listRequirements`
- Capture sessions: `insertCaptureSession`, `updateCaptureSession`, `getCaptureSession`
- Doc audit: `insertDocAudit`, `getDocAudit`
- Lifecycle: `close`

`listRequirements(query)` should use SQL `LIKE` against `name`, `summary`, and `purpose`, ordered by `updated_at DESC`.

## 6. Workflow Engine

Implement `src/workflow/engine.ts` with class `WorkflowEngine`.

Constructor:

```ts
constructor(private readonly db: AgentForgeDB) {}
```

Public input types:

```ts
export interface CreateTaskInput {
  role: 'dev' | 'test';
  title: string;
  description?: string;
  acceptance?: string[];
  e2eScenarios?: string[];
}

export interface CompleteTaskInput {
  result: string;
  docAuditToken?: string;
}

export interface CompleteCycleInput {
  passRate?: number;
  failedTests?: string[];
  screenshots?: Screenshot[];
}

export interface BugInput {
  title: string;
  description?: string;
  expected?: string;
  actual?: string;
  screenshotDescription?: string;
}
```

Behavior:

- `initWorkflow(projectPath, title, brief?)` creates a campaign with status `active`, creates cycle 1, and sets cycle 1 to `product` with `startedAt`.
- `createCycle` is a private helper that inserts a cycle with status `pending`.
- `getCycleState(cycleId?, campaignId?)` returns `{ cycle, tasks }` by explicit cycle or active cycle for campaign. If neither resolves, return `null`.
- `createTasks(cycleId, taskInputs)` requires the cycle status to be `product`, inserts all tasks with status `pending`, then sets cycle status to `dev`.
- `getTasksForRole(cycleId, role)` validates cycle existence and returns tasks for role.
- `completeTask(taskId, input)` requires dev tasks to include a `docAuditToken`. If a token is supplied, it must exist in `doc_audit_log`. Mark the task completed and store `result`, `docAuditToken`, and `completedAt`. If the cycle is in `dev` and no dev tasks remain incomplete, move the cycle to `test`.
- `addTaskComment(taskId, comment)` appends to the task `comments` JSON array.
- `createBugTasks(cycleId, bugs)` creates dev tasks named `[BUG] <title>`, builds description from description/expected/actual/screenshot, and moves the cycle back to `dev`.
- `addProductFeedback(cycleId, feedback)` appends a `## Test Feedback` section to `productBrief`.
- `completeCycle(cycleId, input)` requires status `test`, marks the current cycle `completed`, stores screenshots and completedAt, and if the campaign remains `active`, creates the next cycle and sets it to `product`.
- `captureScreenshot(cycleId, filePath, description)` appends a screenshot record with current timestamp.

Important invariant: `completeCycle` does not mark the campaign completed. Campaign completion is performed by the summarizer when summarizing.

## 7. Roles And Knowledge Base

Implement `src/roles/library.ts`.

Built-in roles:

- `product`: name `Product Agent`, prompt from `src/roles/builtin/product.ts`, doc path `docs/roles/product.md`, `isBuiltin: true`.
- `developer`: name `Developer Agent`, prompt from `src/roles/builtin/developer.ts`, doc path `docs/roles/developer.md`, `isBuiltin: true`.
- `tester`: name `Test Agent`, prompt from `src/roles/builtin/tester.ts`, doc path `docs/roles/tester.md`, `isBuiltin: true`.

Functions:

- `seedBuiltinRoles(db)` upserts all built-ins.
- `getRole(db, roleId)` returns a role or throws `Role not found: ${roleId}`.
- `listRoles(db)` returns `db.listRoles()`.
- `trainRole(db, input)` creates or retrains a custom role.
- `chunkDocument(content, filename)` splits documents into chunks.
- `searchKnowledge(db, roleId, query, embedFn, topK = 5)` scores chunks by cosine similarity.
- `cosineSimilarity(a, b)` returns dot product divided by vector norms.

Training behavior:

- Preserve an existing role's system prompt if retraining without `baseSystemPrompt`.
- If no prompt exists, use a generic expert prompt mentioning the role name.
- Upsert the role with `isBuiltin: false`.
- Delete all existing chunks for the role.
- For each document, call `chunkDocument` and embed each chunk.
- Insert chunks with `sourceFile`, `chunkText`, embedding, and timestamp.

Chunking behavior:

- Target chunk size is about 800 characters.
- Overlap is about 100 characters.
- Split by lines; each chunk text is prefixed with `[filename]\n`.

MCP training uses a pseudo embedding function implemented in `src/mcp/server.ts`: 128-dimensional character histogram normalized to unit length. Anthropic spawner also has a hash embedding fallback for large knowledge bases.

## 8. Agent Spawner

Implement `src/spawner/index.ts` with class `AgentSpawner`.

Input and output:

```ts
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
```

Routing:

- If `input.provider !== 'anthropic'`, use Cursor provider.
- If `input.provider === 'anthropic'` and `config.spawner.mode === 'cli'`, use Claude CLI.
- Otherwise use Anthropic SDK streaming.

This means the programmatic default is Cursor. The MCP layer also defaults to Cursor and tells callers to create a Relay chat session if no `sessionId` is supplied.

### 8.1 Anthropic SDK Provider

`spawnViaSdk(input)`:

- Load role with `getRole(db, input.roleId)`.
- Load all chunks for the role.
- If chunk count is 1..80, inject all chunks into system context.
- If chunk count > 80, call `buildKnowledgeContext(roleId, prompt)` to retrieve top chunks.
- Build `system` from role prompt, optional knowledge, and optional `input.context`.
- Call `this.client.messages.stream` with:
  - `model: config.llm.model`
  - `system`
  - `messages: [{ role: 'user', content: input.prompt }]`
  - `tools: input.tools ?? []`
  - `max_tokens: 4096`
- Stream text deltas into `fullText`.
- Collect tool use blocks into `toolCalls`.
- Await `stream.finalMessage()` and return stop reason.
- Retry up to 3 times for transient 5xx/network errors with exponential delay of 1s, 2s. Do not retry known 4xx errors.

### 8.2 Cursor SDK Provider

Define interfaces to make tests mockable:

```ts
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
```

`spawnViaCursor(input)`:

- Require `input.sessionId`; throw `sessionId is required when provider is "cursor"` if missing.
- Load Cursor config from `config.cursor` or env fallback.
- Require API key; throw a clear configuration error if missing.
- Load role.
- Query `db.getAgentSession('cursor', roleId, sessionId)`.
- If a session exists, call `cursorRuntime.resume(existing.externalId, options)`.
- If no session exists:
  - call `cursorRuntime.create(options)`.
  - build initialization prompt with role id, role system prompt, all knowledge chunks, and optional `input.context`.
  - send initialization prompt once and ignore its acknowledgement.
  - save `agent_sessions` with provider `cursor`, role id, session id, Cursor external id, timestamps.
- Send the user prompt with `agent.send(input.prompt)`.
- Return `{ text, toolCalls: [], stopReason: 'end_turn' }`.

`CursorSdkRuntime` implementation:

- Dynamic import `@cursor/sdk`.
- `Agent.create({ apiKey, model: { id: model }, local: { cwd: workspacePath } })`.
- `Agent.resume(agentId, { apiKey, model: { id: model }, local: { cwd: workspacePath } })`.
- Wrap SDK agent as `CursorAgentLike`:
  - `id` is `agent.agentId`.
  - `send(prompt)` calls `agent.send(prompt)`, waits for run completion with `run.wait()`, throws on `status === 'error'`, and returns `result.result ?? ''`.

Cursor initialization prompt sections:

- `You are being initialized as the Relay expert role "<roleId>".`
- `## Role System Prompt`
- `## Knowledge Base` with full chunks formatted as `Source: <sourceFile>\n<chunkText>` separated by `---`.
- `## Additional Context` if provided.
- End with an instruction to keep this role and knowledge context for the rest of the session and reply with brief acknowledgement only.

### 8.3 Claude CLI Provider

`spawnViaCli(input)`:

- Load role.
- Spawn `claude` with arguments `['-p', input.prompt, '--system', role.systemPrompt]`.
- Resolve stdout on exit code 0.
- Reject with stderr on non-zero exit.
- If spawn fails, reject with a message telling the user to install Claude Code or use SDK mode.

## 9. MCP Server

Implement `src/mcp/server.ts`.

`createMcpServer()` should:

- Load config.
- Get DB singleton and call `init()`.
- Seed built-in roles.
- Construct `WorkflowEngine` and `AgentSpawner`.
- Create `new McpServer({ name: 'relay', version: '0.1.0' })`.
- Register tools and prompts.
- Return the server.

`startMcpServer()` should connect to `new StdioServerTransport()`.

`src/mcp/run.ts` should simply import and call `startMcpServer()`.

### 9.1 MCP Tools

All tools return MCP `content` arrays with text payloads. JSON responses should be `JSON.stringify(obj, null, 2)`.

Workflow tools:

- `init_workflow(projectPath, title, brief?)`: calls `engine.initWorkflow`; returns campaign id, title, status, and next-step message.
- `get_cycle_state(cycleId?, campaignId?)`: calls `engine.getCycleState`; returns state or `No active cycle found.`
- `complete_cycle(cycleId, passRate?, failedTests?, screenshots?)`: maps screenshots to include `capturedAt`, calls `engine.completeCycle`, then returns completed cycle and next active cycle id.

Task tools:

- `create_tasks(cycleId, tasks[], productBrief?)`: optional `db.updateCycle(cycleId, { productBrief })`, then `engine.createTasks`; schema limits tasks to 1..6 and each role to `dev | test`.
- `get_my_tasks(cycleId, role)`: role is `dev | test`; returns tasks.
- `complete_task(taskId, result, docAuditToken?)`: calls engine complete.
- `add_task_comment(taskId, comment)`: appends comments.
- `create_bug_tasks(cycleId, bugs[])`: creates dev bug tasks and reverts cycle to dev.
- `add_product_feedback(cycleId, feedback)`: appends feedback to product brief.

Doc-first tool:

- `update_doc_first(filePath, content, taskId?)`:
  - Ensure parent directory exists.
  - Write full content to disk.
  - Compute `sha256(content).hex.slice(0, 16)`.
  - Create UUID audit token.
  - Insert into `doc_audit_log`.
  - Return token and file path.

Role/knowledge tools:

- `list_roles()`: returns id, name, builtin flag, doc path.
- `get_role(roleId)`: returns full role.
- `train_role(roleId, name, documents[], baseSystemPrompt?)`: uses pseudo embedding, trains role, returns chunks indexed.
- `search_knowledge(roleId, query, topK?)`: topK 1..20, default 5.

Agent tools:

- `start_relay_chat_session(purpose?)`:
  - Generate `relay-chat-${randomUUID()}`.
  - Return the session id, optional purpose, and next-step instruction.

- `spawn_agent(roleId, prompt, context?, provider?, sessionId?)`:
  - Compute `effectiveProvider = provider ?? 'cursor'`.
  - If `effectiveProvider === 'cursor'` and no `sessionId`, return JSON:
    - `requiresSession: true`
    - a message telling the caller to call `start_relay_chat_session` once for the current chat.
    - `nextTool: 'start_relay_chat_session'`
  - Otherwise call `spawner.spawnAgent({ roleId, prompt, context, provider: effectiveProvider, sessionId })`.
  - Return text, stop reason, tool call count, and tool calls.
  - Anthropic remains available only when explicitly requested with `provider: 'anthropic'`.

Screenshot/test tools:

- `capture_screenshot(cycleId, filePath, description)`: calls engine capture; descriptions should use `[PASS]`, `[FAIL]`, or `[BUG]`.
- `run_e2e_tests(cycleId, testPattern?)`: runs `npx playwright test "<pattern>" --reporter=json --screenshot=on` with 120s timeout. Return first 2000 chars of output; on failure return error text and `isError: true`.

Campaign tools:

- `list_campaigns()`: returns all campaigns, with brief truncated.
- `summarize_campaign(campaignId)`: calls summarizer.

Requirement tools:

- `capture_requirement(action, ...)`: supports `start`, `answer`, and `confirm`.
- `recall_requirement(id?, name?)`: returns list, single fuzzy match, or formatted full requirement.

Rules tool:

- `setup_project_rules(projectPath, rules[])`: writes `.cursor/rules/relay.mdc` and creates/updates `CLAUDE.md` with selected rules. Supported rule ids: `doc-first`, `role-product`, `role-developer`, `role-qa`, `git-branch`.

### 9.2 MCP Prompts

Register these prompts:

- `relay:doc-first`: explains that any code/design change must call `update_doc_first` before code.
- `relay:role-product`: product agent workflow and task format.
- `relay:role-developer`: developer workflow and doc audit requirement.
- `relay:role-qa`: aggressive testing and screenshot protocol.
- `relay:recall-requirement`: guided prompt to recall a saved requirement.

## 10. Requirement Memory

Implement `src/requirements/capture.ts` and `src/requirements/recall.ts`.

### 10.1 Capture Flow

Clarifying questions for new requirements:

- Purpose: core user/business problem.
- Background: docs, PRDs, design references.
- Changes: main commits/modules/features.
- Outcome: final result and deviations.
- Tags: area such as performance, feature, UX, architecture.

`startCapture(db, chatContext, name, requirementId?)`:

- Create capture session UUID.
- If updating an existing requirement, prefill purpose, changes, and tags from existing record.
- Store `_context` and `_name` in session answers.
- Return different question sets for new vs update.

`submitAnswers(db, sessionId, answers)`:

- Load session.
- Merge answers into stored answers.
- Build draft with `buildDraft`.
- Set phase to `confirming` and store draft.
- Return draft.

`confirmCapture(db, sessionId, edits?)`:

- Require session and draft.
- If updating existing requirement:
  - append new raw chat context to old context separated by `---`.
  - merge related docs and tags.
  - merge changes, deduplicating by approximate prefix.
  - set status `confirmed`.
- If creating new requirement:
  - insert new requirement with status `confirmed`.
- Mark capture session `done` and store requirement id.

`buildDraft` details:

- Tags split on comma, Chinese comma, Chinese enumeration comma, or whitespace.
- Changes split on newline, semicolon, or Chinese semicolon.
- Related docs split on newline or commas.
- Summary includes Markdown lines for purpose, changes, and outcome.

### 10.2 Recall Flow

`recallRequirements(db, query?)` delegates to `db.listRequirements`.

`formatRequirementForInjection(req)` returns Markdown:

- `# 需求：<name>`
- status and creation date.
- `## 目的` if present.
- `## 摘要` if present.
- `## 主要改动` bullet list.
- `## 相关文档` bullet list.
- `## 标签` inline code tags.
- pending todos as checkboxes.
- first 800 chars of raw chat context, with truncation marker if longer.

## 11. Campaign Summarizer

Implement `src/summarizer/campaign.ts`.

`CampaignSummary`:

```ts
export interface CampaignSummary {
  why: string;
  cycles: CycleSummary[];
  keyDecisions: string[];
  overallPath: string;
}
```

`CycleSummary`:

```ts
export interface CycleSummary {
  cycleNum: number;
  productBrief?: string;
  devWork: string[];
  testResults: string;
  screenshots: Array<{ description: string }>;
}
```

`summarizeCampaign(db, campaignId, config)`:

- Load campaign or throw.
- Load cycles.
- For each cycle, collect dev task results as `<title>: <result>`.
- Count completed and failed test tasks.
- Include screenshot descriptions.
- Build a summarization prompt.
- Call Anthropic `messages.create` with model and API key from config, `max_tokens: 2048`.
- Parse text response with `parseSummaryResponse`.
- Persist campaign status `completed`, completed timestamp, and JSON summary.
- Return parsed summary.

`buildSummarizationPrompt` must request these sections:

- `## Why`
- `## Key Decisions`
- `## What Was Built`
- `## Overall Path`

`parseSummaryResponse(raw, cycles)` should regex sections for Why, Key Decisions, and Overall Path. Key decisions should be parsed from numbered or bullet lines. If no Why section exists, fallback to first 500 chars of raw text.

## 12. Local HTTP API And Dashboard

Implement `src/server/api.ts` with Express and Node HTTP server.

`createApiServer(webDistPath?)`:

- `app.use(express.json())`.
- Serve static files if `webDistPath` exists.
- Use shared `getDatabase()` singleton.
- Return `createServer(app)`.

Routes:

- `GET /api/requirements?q=`: list/recall requirements.
- `GET /api/requirements/:id`: fetch requirement or 404.
- `PATCH /api/requirements/:id`: whitelist update fields `name`, `purpose`, `context`, `summary`, `relatedDocs`, `changes`, `tags`, `status`; reject empty patch.
- `POST /api/requirements/:id/chat`: chat against a requirement using Anthropic. System prompt includes formatted requirement context. Request body is `{ message, history? }`.
- `POST /api/requirements/:id/todos`: create todo with UUID, text, done false, createdAt.
- `PATCH /api/requirements/:id/todos/:todoId`: update done/text.
- `DELETE /api/requirements/:id/todos/:todoId`: remove todo.
- `POST /api/requirements/:id/apply-chat`: send chat history to Anthropic and extract JSON updates for only `context`, `summary`, and `changes`. Strip no-change placeholders and merge `changes` with existing entries.
- `GET /api/campaigns`: list campaigns.
- `GET /api/campaigns/:id`: campaign plus cycles.
- `GET /api/roles`: list roles.
- `GET /api/roles/:id/chunks`: role knowledge chunks grouped by `sourceFile`.

If serving frontend assets, add Express 5 SPA fallback:

```ts
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(webDistPath, 'index.html'));
});
```

`startApiServer(port, webDistPath?)` listens and logs `Relay dashboard: http://localhost:<port>`.

Important current gap: there is no `/api/search` route and no WebSocket server. Do not build UI features that depend on them unless adding the backend too.

### 12.1 Web App

Implement `web/src/App.tsx` routes:

- `/` -> `Requirements`
- `/requirements` -> `Requirements`
- `/requirements/:id` -> `RequirementDetail`
- `/roles` -> `Roles`

Use a left sidebar with nav items `需求库` and `专家库`.

`useGet<T>(url)` should fetch JSON from a URL and expose `data`, `loading`, `error`, and `refetch`. It should accept `null` to skip fetching, used by lazy panels.

`Requirements` page:

- Search input updates query state.
- Fetch `/api/requirements` or `/api/requirements?q=...`.
- Empty state instructs user to call `capture_requirement(action: "start", ...)`.
- Render requirement cards with name, purpose, tags, status, updated date, and link to detail.

`RequirementDetail` page:

- Fetch `/api/requirements/:id`.
- Show header with back link, title, status, and chat drawer button.
- Render purpose, summary, changes, tags, todos, related docs, and timestamps.
- Todo sidebar calls the todo endpoints.
- Chat drawer calls `POST /api/requirements/:id/chat` and stores local message history.
- `更新需求` button calls `POST /api/requirements/:id/apply-chat` and refetches on update.
- Markdown rendering uses `react-markdown`.

`Roles` page:

- Fetch `/api/roles`.
- Separate custom and built-in roles.
- Each role card can show system prompt.
- Custom roles can open a knowledge panel that fetches `/api/roles/:id/chunks` and shows grouped chunks by source file.

## 13. CLI

Implement `src/cli/index.ts` with Commander.

Commands:

- `relay mcp`: starts stdio MCP server.
- `relay init`: creates `~/.relay/config.json` if missing, seeds built-in roles, and prints next steps.
- `relay workflow start <projectPath> <title> [-b brief]`: starts campaign.
- `relay workflow list`: lists campaigns.
- `relay workflow status <campaignId>`: prints active cycle and dev/test tasks.
- `relay roles`: lists roles.
- `relay campaign summarize <campaignId>`: summarizes campaign through Anthropic; requires configured LLM key.
- `relay web [-p port]`: starts Express API and static dashboard. Build path is `../../web/dist` relative to compiled CLI file.

`relay init` current config template should include llm, spawner, server, and playwright. If reimplementing now, include optional cursor config too so users can immediately configure Cursor provider.

`bin/relay.mjs` should be a small executable that imports the built CLI entry from `dist/cli/index.js`.

## 14. Agent Collaboration Rules

`AGENTS.md` is project-critical. It should require all agents to read:

- `docs/roles/product.md`
- `docs/roles/developer.md`
- `docs/roles/tester.md`
- `docs/tech/DESIGN.md`

Doc-first rule:

- Any code or design change must call `update_doc_first(filePath, content)` before code changes.
- The tool writes the doc and returns an audit token.
- Dev tasks must pass the audit token to `complete_task`.

Role boundaries:

- Product agent outputs tasks and product decisions only.
- Developer agent implements dev tasks and does not write tester-owned e2e tests.
- Tester agent writes tests, captures screenshots, and reports bugs through task tools.

Vibe coding loop:

```text
init_workflow(projectPath)
  -> Product Agent: get_cycle_state, update_doc_first, create_tasks
  -> Dev Agent: get_my_tasks, update_doc_first, implement, complete_task
  -> Test Agent: get_my_tasks, write/run Playwright, capture screenshots, complete_cycle or create_bug_tasks
  -> Product Agent starts next cycle
```

## 15. Current Behavioral Details To Preserve

Preserve these details because callers may depend on them:

- `spawn_agent` defaults to Cursor provider when `provider` is omitted.
- `spawn_agent` without `sessionId` on Cursor path returns a structured instruction instead of silently falling back to Anthropic.
- `start_relay_chat_session` session ids have prefix `relay-chat-` followed by a UUID.
- Cursor session reuse key is `(provider, roleId, sessionId)`.
- First Cursor call sends full role prompt and full knowledge base once; later calls resume and send only user prompt.
- Anthropic provider is still available with `provider: 'anthropic'`.
- Dev tasks require a valid doc audit token before completion.
- Completing all dev tasks advances cycle to `test`.
- Completing a test cycle starts a new product cycle automatically if campaign is still active.
- Summarizing a campaign marks it completed.
- Requirement chat apply may update only `context`, `summary`, and `changes`, never arbitrary fields.

## 16. Test Plan For Reimplementation

Use Vitest for backend tests. Include at least these test files:

- `src/storage/database.test.ts`: table init, campaign/cycle/task CRUD, doc audit, requirements, capture sessions, agent sessions insert/update.
- `src/workflow/engine.test.ts`: init workflow, product-only task creation, dev doc token enforcement, dev-to-test transition, bug tasks returning to dev, cycle completion creating next cycle.
- `src/roles/library.test.ts`: seed built-ins, chunking overlap, train custom role, search ordering.
- `src/spawner/index.test.ts`: Cursor default routing, session creation, full context sent once, resume sends only prompt, missing session id error on direct spawner Cursor path, Anthropic explicit path using mocks if practical.
- `src/mcp/server.test.ts`: `createRelayChatSessionId` prefix/uniqueness and tool schema behavior where feasible.
- `src/requirements/capture.test.ts`: new requirement capture, update existing requirement, draft construction, merge behavior.
- `src/requirements/recall.test.ts`: list and formatted injection.
- `src/summarizer/campaign.test.ts`: prompt construction and response parsing.

Verification commands:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For web-specific changes, also run:

```bash
pnpm --filter relay-web build
```

Playwright e2e tests are invoked by MCP against consumer test patterns; this repository does not currently need bundled e2e tests to pass the default test suite.

## 17. Implementation Order From Scratch

A reliable rebuild order:

1. Create pnpm workspace, TypeScript ESM config, tsup config, Vitest config, and bin wrapper.
2. Implement `src/config.ts` and tests for default/merged config.
3. Implement `src/storage/database.ts` and database tests.
4. Implement built-in role prompts and `src/roles/library.ts`.
5. Implement `src/workflow/engine.ts` and workflow tests.
6. Implement `src/requirements/capture.ts` and `recall.ts` with tests.
7. Implement `src/spawner/index.ts` with injectable Cursor runtime and tests.
8. Implement `src/summarizer/campaign.ts` with parser tests.
9. Implement `src/mcp/server.ts` with all tools and prompts.
10. Implement `src/cli/index.ts` and `src/mcp/run.ts`.
11. Implement `src/server/api.ts`.
12. Implement the Vite React dashboard pages and hooks.
13. Add docs: role docs, tech design, Cursor default spawn note, and AGENTS rules.
14. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.

Build tests before implementation for modules with meaningful behavior, especially storage, workflow, requirements, and spawner.

## 18. Known Gaps And Cleanup Opportunities

These are not required to match the current behavior, but a future implementation may address them deliberately:

- `docs/tech/DESIGN.md` may lag behind the current Cursor-default `spawn_agent` behavior; treat current source and this blueprint as the behavior source of truth.
- Root `start` npm script should either be removed or mapped to an implemented CLI command.
- The dashboard mentions some future pages/components that are not mounted in `App.tsx`.
- `web/src/hooks/useWebSocket.ts` and Vite `/ws` proxy are not backed by a server.
- `useSearch` or `/api/search` references should not be introduced without adding an API route.
- Pseudo embeddings should be replaced with real embeddings if knowledge retrieval quality becomes important.
- The dashboard API is unauthenticated because it is intended for local use.
- `relay init` should be updated to write cursor config fields if Cursor provider is a first-class default.

## 19. Minimal Acceptance Criteria

A from-scratch implementation is compatible with the current Relay project when all of the following are true:

- `relay init` creates usable local config and seeds built-in roles.
- `relay mcp` starts an MCP stdio server exposing the tools listed above.
- `init_workflow`, `create_tasks`, `complete_task`, and `complete_cycle` drive the documented state machine.
- `update_doc_first` writes docs and produces audit tokens that dev task completion validates.
- `train_role` stores chunks, and `search_knowledge` returns scored results.
- `start_relay_chat_session` returns `relay-chat-<uuid>`.
- `spawn_agent` defaults to Cursor session reuse and preserves explicit Anthropic fallback.
- Requirement capture/recall works through MCP and requirements are visible in the dashboard.
- `relay web` serves the dashboard and the API routes listed here.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
