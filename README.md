# Relay

**MCP-first multi-agent orchestration platform** — automate the product → dev → test vibe coding loop, manage reusable agent roles, and summarize multi-day campaigns.

**MCP 优先的多 Agent 编排平台** — 自动化 product → dev → test 循环，管理可复用的 agent 角色，总结多天开发 campaign。

---

## 核心能力 / Features

| 能力 / Feature | 说明 / Description |
|------|------|
| **Vibe Coding Loop** | 自动化 product→dev→test 循环，agent 之间任务传递无需手工复制粘贴 / Automate the full loop; no manual context transfer between agents |
| **Role Library** | 内置产品/研发/测试角色，支持上传文档训练自定义专家 / Built-in roles + trainable custom experts via document upload |
| **Doc-First 强制** | `update_doc_first()` 写文档返回审计 token，dev 任务不附 token 无法完成 / Docs must be written before code; enforced via audit token |
| **Campaign Summary** | 多天大需求结束后，跨 cycle 总结演进路径 / Cross-cycle summary after long-running campaigns |
| **MCP 集成** | 接入 Claude Code / Cursor，agent 直接调用工具 / Integrates with Claude Code & Cursor as an MCP server |

---

## 快速开始 / Quick Start

### 前置要求 / Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9
- Anthropic API Key

### 1. 安装 / Install

```bash
git clone https://github.com/sherlockfeng/relay.git
cd relay
pnpm install
pnpm build
```

### 2. 初始化配置 / Init Config

```bash
# 生成默认配置文件 / Generate default config
node bin/relay.mjs init

# 编辑配置，填入 API Key / Edit config and fill in your API Key
# 配置文件路径 / Config path: ~/.relay/config.json
```

`~/.relay/config.json` 最小配置示例 / Minimal config example:

```json
{
  "llm": {
    "provider": "anthropic",
    "apiKey": "sk-ant-xxxxxxxx",
    "model": "claude-sonnet-4-6"
  },
  "spawner": {
    "mode": "sdk",
    "fallbackToCli": true
  },
  "server": {
    "port": 3000
  },
  "playwright": {
    "browser": "chromium",
    "screenshotDir": "~/.relay/screenshots"
  }
}
```

### 3. 启动 MCP Server / Start MCP Server

**接入 Claude Code / Connect to Claude Code:**

```bash
claude mcp add relay -- node /path/to/relay/dist/mcp/server.js
```

**接入 Cursor / Connect to Cursor:**

在 `~/.cursor/mcp.json` 添加 / Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay/dist/mcp/server.js"]
    }
  }
}
```

**手动启动（stdio 模式）/ Start manually (stdio mode):**

```bash
relay mcp
# 或 / or
node dist/mcp/server.js
```

---

## Vibe Coding 循环 / Vibe Coding Loop

在任意 AI agent 中调用 MCP tools / Call MCP tools from any AI agent:

```text
# 1. 启动 campaign / Start campaign
init_workflow(projectPath: "/my/project", title: "登录页重设计", brief: "用户反馈登录体验差")

# 2. 产品 agent / Product agent
get_cycle_state(campaignId: "...")           # 读上轮截图 + 状态 / Read last cycle state
update_doc_first("docs/product/PRD.md", content)
create_tasks(cycleId: "...", tasks: [...])   # 生成研发+测试任务 / Create dev & test tasks

# 3. 研发 agent / Developer agent
get_my_tasks(cycleId: "...", role: "dev")
update_doc_first("docs/tech/DESIGN.md", content)   # 返回 auditToken / Returns auditToken
complete_task(taskId: "...", result: "...", docAuditToken: "...")

# 4. 测试 agent / Test agent
get_my_tasks(cycleId: "...", role: "test")
run_e2e_tests(cycleId: "...")               # 跑 Playwright，自动截图 / Run Playwright with screenshots
complete_cycle(cycleId: "...")              # 触发下一轮 / Trigger next cycle

# 5. 多天后总结 / Summarize after campaign
summarize_campaign(campaignId: "...")
```

---

## 角色管理 / Role Management

### 内置角色 / Built-in Roles

| 角色 ID | 职责 / Responsibility |
|---------|------|
| `product` | 分析截图 + 竞品，生成任务列表 / Analyze screenshots & competitors, create task list |
| `developer` | doc-first 实现，不超出任务范围 / Doc-first implementation, stays in scope |
| `tester` | 攻击性 e2e 测试，强制覆盖边界条件 / Aggressive e2e testing, enforces edge cases |

### 训练自定义角色 / Train Custom Roles

```text
# 在 Claude Code / Cursor 中调用 / Call in Claude Code or Cursor:
train_role(
  roleId: "goofy-expert",
  name: "Goofy Platform Expert",
  documents: [
    { filename: "goofy-api.md", content: "..." },
    { filename: "goofy-patterns.ts", content: "..." }
  ]
)

# 之后 spawn 时自动注入知识库上下文 / Knowledge base is injected automatically on spawn
spawn_agent(roleId: "goofy-expert", prompt: "如何在 Goofy 里实现 SSO？")
```

---

## MCP Tools 完整列表 / Full MCP Tool List

### 工作流 / Workflow
- `init_workflow` — 创建 campaign，启动第一个 cycle / Create campaign, start first cycle
- `get_cycle_state` — 读当前 cycle 状态 + 截图 / Get current cycle state and screenshots
- `complete_cycle` — 测试完成，触发下一轮 / Complete testing, trigger next cycle

### 任务 / Tasks
- `create_tasks` — 产品 agent 生成任务列表 / Product agent creates task list
- `get_my_tasks` — 按角色拉取任务 / Fetch tasks by role
- `complete_task` — 完成任务（dev 需附 docAuditToken）/ Complete task (dev requires docAuditToken)
- `add_task_comment` — 对任务提问 / Comment or question on a task
- `create_bug_tasks` — 测试报 bug，回退到 dev 阶段 / Report bugs, revert to dev phase
- `add_product_feedback` — 测试向产品反馈设计问题 / Tester sends design feedback to product

### 文档强制 / Doc Enforcement
- `update_doc_first` — 写文档，返回 auditToken / Write docs, returns auditToken

### 角色 / Roles
- `list_roles` / `get_role` — 查看角色 / List or get roles
- `train_role` — 上传文档/源码训练角色 / Train role with documents or source code
- `search_knowledge` — RAG 查询角色知识库 / RAG search role knowledge base

### Agent 调度 / Agent Scheduling
- `spawn_agent` — 用指定角色启动子 agent / Spawn sub-agent with a specified role

### 截图 & 测试 / Screenshots & Testing
- `capture_screenshot` — 附加截图到 cycle / Attach screenshot to cycle
- `run_e2e_tests` — 触发 Playwright / Trigger Playwright tests

### Campaign
- `list_campaigns` / `summarize_campaign` — 列出 / 总结大需求 / List or summarize campaigns

---

## CLI 命令 / CLI Commands

```bash
relay init                              # 初始化配置 + 种子角色 / Init config and seed roles
relay mcp                               # 启动 MCP server（stdio）/ Start MCP server (stdio)
relay workflow start <path> <title>     # 命令行启动 campaign / Start campaign from CLI
relay workflow list                     # 列出所有 campaign / List all campaigns
relay workflow status <campaignId>      # 查看当前 cycle 进度 / View current cycle status
relay roles                             # 列出所有角色 / List all roles
relay campaign summarize <campaignId>   # 生成 campaign 总结 / Generate campaign summary
```

---

## 技术栈 / Tech Stack

- **MCP**: `@modelcontextprotocol/sdk` — 接入 Claude Code / Cursor / Integrates with Claude Code & Cursor
- **Agent 调用**: `@anthropic-ai/sdk` streaming — 直接进入 agent 生命周期 / Direct agent lifecycle management
- **存储**: `better-sqlite3` — campaigns / cycles / tasks / roles / knowledge
- **e2e**: Playwright — 测试 agent 自动截图 / Automated screenshots in test agent
- **Build**: tsup + TypeScript
- **Package Manager**: pnpm (workspace)

---

## 文档 / Documentation

- [AGENTS.md](AGENTS.md) — agent 必读，角色规则 / Required reading for all agents
- [docs/roles/product.md](docs/roles/product.md) — 产品角色 / Product role guide
- [docs/roles/developer.md](docs/roles/developer.md) — 研发角色 / Developer role guide
- [docs/roles/tester.md](docs/roles/tester.md) — 测试角色 / Tester role guide
- [docs/tech/DESIGN.md](docs/tech/DESIGN.md) — 技术设计 / Technical design

---

## License

MIT
