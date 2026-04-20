# Relay 技术设计

**状态**：v1.0 — 全量重写  
**依赖**：Node.js >=20, SQLite

---

## 1. 定位

Relay 是一个 **MCP-first 多 agent 编排平台**。它不监听 transcript 文件，而是通过 MCP 工具主动进入 Claude Code / Cursor 的 agent 生命周期，注入角色、分发任务、调度循环。

核心价值：
- 把手工复制粘贴的"vibe coding 循环"自动化
- 沉淀可复用的 agent 角色（含可训练的专家角色）
- 强制 doc-first 开发规范
- 跨多天大需求的 Campaign 总结

---

## 2. 技术栈

| 层 | 技术 | 理由 |
|----|------|------|
| Runtime | Node.js + TypeScript | MCP 生态原生语言 |
| Agent 调用 | `@anthropic-ai/sdk` streaming | 平台无关，可控 system prompt |
| Agent 调用备选 | `claude` CLI 子进程 | 复用本地 Claude Code session |
| MCP | `@modelcontextprotocol/sdk` | 标准协议，Cursor/Claude Code 原生支持 |
| 存储 | `better-sqlite3` + FTS5 | 零配置，支持全文搜索 |
| 向量检索 | SQLite BLOB + cosine 相似度 | 无外部依赖的 RAG |
| e2e 测试 | Playwright | 截图 + 自动化测试 |
| Web UI | React + Vite + TailwindCSS | 可选 Dashboard |
| CLI | commander | 标准 CLI 库 |
| Build | tsup | 快速 bundle |

---

## 3. 系统架构

```
用户 / 任意 AI agent（Claude Code / Cursor）
           │
           │  MCP Protocol
           ▼
┌──────────────────────────────────────────────────┐
│              MCP Server (主入口)                  │
│  src/mcp/server.ts                               │
│                                                  │
│  工作流工具   角色工具   知识库工具   总结工具     │
└──────┬────────────┬──────────┬──────────┬────────┘
       │            │          │          │
  ┌────▼────┐  ┌───▼────┐ ┌──▼──────┐ ┌─▼──────────┐
  │Workflow │  │  Role  │ │Knowledge│ │  Campaign  │
  │ Engine  │  │Library │ │  Store  │ │ Summarizer │
  └────┬────┘  └───┬────┘ └──┬──────┘ └────────────┘
       │            │         │
       └────────────┴────┬────┘
                         │
                   ┌─────▼──────┐
                   │   SQLite   │
                   └─────┬──────┘
                         │
                   ┌─────▼──────┐
                   │   Agent    │
                   │  Spawner   │
                   │(Anthropic  │
                   │   SDK)     │
                   └────────────┘
```

---

## 4. 数据模型

### campaigns（大需求/多天任务）
```sql
CREATE TABLE campaigns (
  id           TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  title        TEXT NOT NULL,
  brief        TEXT,          -- 初始需求描述
  status       TEXT DEFAULT 'active',  -- active | completed
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  summary      TEXT           -- summarize_campaign() 产出
);
```

### cycles（单轮 product→dev→test 循环）
```sql
CREATE TABLE cycles (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT REFERENCES campaigns(id),
  cycle_num      INTEGER NOT NULL,
  status         TEXT DEFAULT 'pending',
                 -- pending | product | dev | test | completed
  product_brief  TEXT,   -- 产品 agent 本轮分析结果
  screenshots    TEXT,   -- JSON array，截图路径 + 描述
  started_at     TEXT,
  completed_at   TEXT
);
```

### tasks（具体任务条目）
```sql
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  cycle_id         TEXT REFERENCES cycles(id),
  role             TEXT NOT NULL,  -- dev | test
  title            TEXT NOT NULL,
  description      TEXT,
  acceptance       TEXT,    -- JSON array，验收标准
  e2e_scenarios    TEXT,    -- JSON array，仅 test 任务
  status           TEXT DEFAULT 'pending',
                   -- pending | in_progress | completed | failed
  result           TEXT,    -- 完成时的产出摘要
  doc_audit_token  TEXT,    -- update_doc_first() 返回的审计 token
  comments         TEXT,    -- JSON array，任务评论
  created_at       TEXT,
  completed_at     TEXT
);
```

### roles（角色定义）
```sql
CREATE TABLE roles (
  id            TEXT PRIMARY KEY,  -- "tester" | "developer" | "product" | 自定义
  name          TEXT NOT NULL,
  system_prompt TEXT NOT NULL,     -- 注入给 agent 的 system prompt
  doc_path      TEXT,              -- 对应角色文档
  is_builtin    INTEGER DEFAULT 0,
  created_at    TEXT
);
```

### knowledge_chunks（角色知识库，RAG）
```sql
CREATE TABLE knowledge_chunks (
  id          TEXT PRIMARY KEY,
  role_id     TEXT REFERENCES roles(id),
  source_file TEXT,
  chunk_text  TEXT NOT NULL,
  embedding   BLOB,   -- float32 向量
  created_at  TEXT
);
```

### doc_audit_log（doc-first 审计）
```sql
CREATE TABLE doc_audit_log (
  token        TEXT PRIMARY KEY,
  task_id      TEXT,
  file_path    TEXT,
  content_hash TEXT,
  created_at   TEXT
);
```

---

## 5. MCP Tools 完整列表

### 工作流管理
| Tool | 参数 | 说明 |
|------|------|------|
| `init_workflow` | `projectPath, title, brief` | 创建 campaign，进入第一个 cycle |
| `get_cycle_state` | `cycleId?` | 当前 cycle 状态、截图、任务列表 |
| `complete_cycle` | `cycleId, result` | 测试完成，触发下一轮产品分析 |

### 任务管理
| Tool | 参数 | 说明 |
|------|------|------|
| `create_tasks` | `cycleId, tasks[]` | 产品 agent 创建本轮任务列表 |
| `get_my_tasks` | `cycleId, role` | 拉取指定角色的任务 |
| `complete_task` | `taskId, result` | 标记任务完成 |
| `add_task_comment` | `taskId, comment` | 对任务提问或补充说明 |
| `create_bug_tasks` | `cycleId, bugs[]` | 测试 agent 创建 bug 修复任务 |
| `add_product_feedback` | `cycleId, feedback` | 测试 → 产品的设计反馈 |

### 文档强制
| Tool | 参数 | 说明 |
|------|------|------|
| `update_doc_first` | `filePath, content` | 写文档，返回 auditToken |

### 角色管理
| Tool | 参数 | 说明 |
|------|------|------|
| `list_roles` | — | 列出所有可用角色 |
| `get_role` | `roleId` | 获取角色详情和 system prompt |
| `train_role` | `roleId, name, documents[]` | 上传文档/源码训练自定义角色 |
| `search_knowledge` | `roleId, query` | RAG 查询角色知识库 |

### Agent 调度
| Tool | 参数 | 说明 |
|------|------|------|
| `spawn_agent` | `roleId, prompt, context?` | 用指定角色启动子 agent |

### 截图 & 测试
| Tool | 参数 | 说明 |
|------|------|------|
| `capture_screenshot` | `cycleId, filePath, description` | 上传截图关联到 cycle |
| `run_e2e_tests` | `cycleId, testPattern?` | 触发 Playwright 运行 |

### Campaign 总结
| Tool | 参数 | 说明 |
|------|------|------|
| `summarize_campaign` | `campaignId` | 跨 cycle 总结大需求 |
| `list_campaigns` | — | 列出所有 campaign |

---

## 6. Agent 生命周期集成

### 主路径：Anthropic SDK

```typescript
// src/spawner/index.ts
const client = new Anthropic();
const stream = await client.messages.stream({
  model: 'claude-sonnet-4-6',
  system: role.system_prompt + '\n\n## 相关知识\n' + knowledgeContext,
  messages: [{ role: 'user', content: prompt }],
  tools: MCP_TOOLS,
  max_tokens: 8096,
});
```

知识注入：`spawn_agent` 时自动调用 `search_knowledge(roleId, prompt)` 检索相关 chunks，拼入 system prompt。

### 备选路径：claude CLI

```bash
claude -p "prompt" --system "role_system_prompt"
```

当用户在 Claude Code 内部且想复用现有 session 时使用。

---

## 7. Campaign Summarizer

```
输入：
  campaign.brief                → 初始需求
  cycles[].product_brief        → 每轮产品决策
  tasks[].title + tasks[].result→ 每个任务的产出
  cycles[].screenshots          → 截图描述列表

LLM 生成输出：
  - 为什么做：原始需求 + 演进动机
  - 做了什么：按 cycle 的改动列表  
  - 关键决策：每轮产品 agent 的核心判断
  - 整体路径：从 brief 到最终状态的演进叙述
```

---

## 8. 目录结构

```
relay/
├── AGENTS.md
├── docs/
│   ├── roles/
│   │   ├── product.md
│   │   ├── developer.md
│   │   └── tester.md
│   └── tech/
│       └── DESIGN.md
├── src/
│   ├── mcp/
│   │   ├── server.ts           ← MCP server 入口
│   │   └── tools/              ← 按类别拆分的工具实现
│   │       ├── workflow.ts
│   │       ├── tasks.ts
│   │       ├── roles.ts
│   │       ├── knowledge.ts
│   │       ├── spawner.ts
│   │       └── campaign.ts
│   ├── workflow/
│   │   └── engine.ts           ← cycle 状态机
│   ├── roles/
│   │   ├── library.ts          ← 角色 CRUD
│   │   └── builtin/            ← 内置角色 system prompts
│   │       ├── product.ts
│   │       ├── developer.ts
│   │       └── tester.ts
│   ├── knowledge/
│   │   ├── store.ts            ← chunk + embedding 存取
│   │   └── trainer.ts          ← 文档/源码 ingestion
│   ├── spawner/
│   │   ├── index.ts            ← Anthropic SDK agent 调用
│   │   └── cli.ts              ← claude CLI fallback
│   ├── storage/
│   │   └── database.ts         ← SQLite schema + 封装
│   ├── summarizer/
│   │   └── campaign.ts         ← Campaign 跨 cycle 总结
│   └── cli/
│       └── index.ts            ← CLI 入口
├── bin/
│   └── relay.mjs
├── web/                        ← Dashboard（可选）
├── package.json
└── tsconfig.json
```

---

## 9. 配置

`~/.relay/config.json`：
```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "sk-ant-..."
  },
  "spawner": {
    "mode": "sdk",
    "fallbackToCli": true
  },
  "server": { "port": 3000 },
  "playwright": {
    "browser": "chromium",
    "screenshotDir": "~/.relay/screenshots"
  }
}
```

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Anthropic SDK streaming 中断 | 指数退避重试，任务状态回滚到 in_progress |
| 子 agent 不调用 complete_task | 超时检测（configurable），自动标记 failed |
| doc_audit_token 被跳过 | complete_task 时验证 token，缺失则拒绝完成 |
| 知识库 embedding 维度不匹配 | 存储时记录 model，检索时过滤匹配 |
| SQLite 并发写 | MCP server 单进程，写操作串行化 |
