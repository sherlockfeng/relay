# Relay — Agent 协作手册

## 必读文档

所有参与本项目的 agent，**无论角色**，必须在开始工作前读完：

1. **[产品角色文档](docs/roles/product.md)** — 产品分析、竞品研究、任务拆解规范
2. **[研发角色文档](docs/roles/developer.md)** — 实现规范、doc-first 强制规则
3. **[测试角色文档](docs/roles/tester.md)** — 攻击性测试策略、e2e 截图规范
4. **[技术设计](docs/tech/DESIGN.md)** — 系统架构、数据模型、MCP tools 列表

## 核心规则（不可违反）

### Doc-First 规则
> **任何代码或设计变更，必须先修改对应文档，再写代码。**

违反流程：
```
❌ 改代码 → 改文档（或不改文档）
✅ 改文档 → 改代码
```

执行方式：调用 MCP tool `update_doc_first(filePath, content)` 强制写文档并记录审计日志，返回成功后才可动代码。

### 角色边界规则
- 产品 agent：只输出任务列表，不写代码，不写测试
- 研发 agent：只做实现，不做测试，不替产品做决策
- 测试 agent：只写测试和截图分析，发现问题通过任务系统反馈

### 任务流规则
- 所有跨 agent 通信通过 MCP tools（`create_tasks` / `get_my_tasks` / `complete_task`）
- 禁止 agent 直接修改其他角色的任务
- cycle 完成前不跳过任何角色

## Vibe Coding 循环

```
init_workflow(projectPath)
       ↓
[Product Agent] — 分析截图 + 竞品 → create_tasks()
       ↓
[Dev Agent]    — get_my_tasks() → update_doc_first() → 实现 → complete_task()
       ↓
[Test Agent]   — get_my_tasks() → 写 e2e → 跑 Playwright → 截图 → complete_cycle()
       ↓
[Product Agent] — 读新截图 → 开始下一轮
```

## 角色知识库

预置角色在 `~/.relay/roles/` 下。可通过 `train_role(roleId, docs)` 上传文档/源码训练自定义专家角色（如内部平台专家）。

## Campaign 记录

每次多天大需求结束后，调用 `summarize_campaign(campaignId)` 生成：
- 为什么要做（初始 brief）
- 经历了哪些 cycle
- 做了什么改动
- 整体演进路径
