# Agent-Forge

**MCP-first multi-agent orchestration platform** — automate the product → dev → test vibe coding loop, manage reusable agent roles, and summarize multi-day campaigns.

## 核心能力

| 能力 | 说明 |
|------|------|
| **Vibe Coding Loop** | 自动化 product→dev→test 循环，agent 之间任务传递无需手工复制粘贴 |
| **Role Library** | 内置产品/研发/测试角色，支持上传文档训练自定义专家（如内部平台专家） |
| **Doc-First 强制** | `update_doc_first()` 写文档返回审计 token，dev 任务不附 token 无法完成 |
| **Campaign Summary** | 多天大需求结束后，跨 cycle 总结：为什么做、做了什么、整体演进路径 |
| **MCP 集成** | 接入 Claude Code / Cursor，agent 直接调用工具启动循环、生成子 agent |

## 快速开始

### 1. 安装

```bash
git clone https://github.com/user/agent-forge.git
cd agent-forge
npm install
npm run build
```

### 2. 初始化

```bash
node bin/agent-forge.mjs init
# 编辑 ~/.agent-forge/config.json，填入 ANTHROPIC_API_KEY
```

### 3. 接入 Claude Code

```bash
claude mcp add agent-forge -- node /path/to/agent-forge/dist/mcp/server.js
```

### 4. 接入 Cursor

在 `~/.cursor/mcp.json` 添加：

```json
{
  "mcpServers": {
    "agent-forge": {
      "command": "node",
      "args": ["/path/to/agent-forge/dist/mcp/server.js"]
    }
  }
}
```

## Vibe Coding 循环

在任意 AI agent 中调用 MCP tools：

```
# 1. 启动 campaign
init_workflow(projectPath: "/my/project", title: "登录页重设计", brief: "用户反馈登录体验差")

# 2. 产品 agent 自动激活
get_cycle_state(campaignId: "...")          # 读上轮截图 + 状态
update_doc_first("docs/product/PRD.md", content)
create_tasks(cycleId: "...", tasks: [...])  # 输出研发+测试任务

# 3. 研发 agent 激活
get_my_tasks(cycleId: "...", role: "dev")
update_doc_first("docs/tech/DESIGN.md", content)  # 返回 auditToken
complete_task(taskId: "...", result: "...", docAuditToken: "...")

# 4. 测试 agent 激活
get_my_tasks(cycleId: "...", role: "test")
run_e2e_tests(cycleId: "...")              # 跑 Playwright，自动截图
complete_cycle(cycleId: "...")             # 触发下一轮

# 5. 多天后总结
summarize_campaign(campaignId: "...")
```

## 角色管理

### 内置角色

| 角色 ID | 职责 |
|---------|------|
| `product` | 分析截图 + 竞品，生成任务列表 |
| `developer` | doc-first 实现，不超出任务范围 |
| `tester` | 攻击性 e2e 测试，强制覆盖边界条件 |

### 训练自定义角色

```
# 在 Claude Code / Cursor 中：
train_role(
  roleId: "goofy-expert",
  name: "Goofy Platform Expert",
  documents: [
    { filename: "goofy-api.md", content: "..." },
    { filename: "goofy-patterns.ts", content: "..." }
  ]
)

# 之后 spawn 时自动注入知识库上下文
spawn_agent(roleId: "goofy-expert", prompt: "如何在 Goofy 里实现 SSO？")
```

## MCP Tools 完整列表

### 工作流
- `init_workflow` — 创建 campaign，启动第一个 cycle
- `get_cycle_state` — 读当前 cycle 状态 + 截图
- `complete_cycle` — 测试完成，触发下一轮

### 任务
- `create_tasks` — 产品 agent 生成任务列表
- `get_my_tasks` — 按角色拉取任务
- `complete_task` — 完成任务（dev 需附 docAuditToken）
- `add_task_comment` — 对任务提问
- `create_bug_tasks` — 测试报 bug，回退到 dev 阶段
- `add_product_feedback` — 测试向产品反馈设计问题

### 文档强制
- `update_doc_first` — 写文档，返回 auditToken

### 角色
- `list_roles` / `get_role` — 查看角色
- `train_role` — 上传文档/源码训练角色
- `search_knowledge` — RAG 查询角色知识库

### Agent 调度
- `spawn_agent` — 用指定角色启动子 agent（Anthropic SDK）

### 截图 & 测试
- `capture_screenshot` — 附加截图到 cycle
- `run_e2e_tests` — 触发 Playwright

### Campaign
- `list_campaigns` / `summarize_campaign` — 列出 / 总结大需求

## CLI 命令

```bash
agent-forge init                              # 初始化配置 + 种子角色
agent-forge mcp                               # 启动 MCP server（stdio）
agent-forge workflow start <path> <title>     # 命令行启动 campaign
agent-forge workflow list                     # 列出所有 campaign
agent-forge workflow status <campaignId>      # 查看当前 cycle 进度
agent-forge roles                             # 列出所有角色
agent-forge campaign summarize <campaignId>   # 生成 campaign 总结
```

## 技术栈

- **MCP**: `@modelcontextprotocol/sdk` — 接入 Claude Code / Cursor
- **Agent 调用**: `@anthropic-ai/sdk` streaming — 直接进入 agent 生命周期
- **存储**: `better-sqlite3` — campaigns / cycles / tasks / roles / knowledge
- **e2e**: Playwright — 测试 agent 自动截图
- **Build**: tsup + TypeScript

## 文档

- [AGENTS.md](AGENTS.md) — agent 必读，角色规则
- [docs/roles/product.md](docs/roles/product.md) — 产品角色
- [docs/roles/developer.md](docs/roles/developer.md) — 研发角色
- [docs/roles/tester.md](docs/roles/tester.md) — 测试角色
- [docs/tech/DESIGN.md](docs/tech/DESIGN.md) — 技术设计

## License

MIT
