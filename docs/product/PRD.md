# PRD：AI Chat Digest — AI Chat Management Dashboard

**文档类型**：产品说明  
**状态**：v0.1  
**读者**：独立开发者（自用 + 开源）

---

## 1. 背景与问题

使用多个 AI 工具（Cursor, Claude Code, Codex）进行日常开发时，每次对话中产生大量有价值的信息：

- **讨论主题**与决策过程
- **内部工具/定义**的上下文
- **发现的问题**与确定的方案
- **项目领域知识**：项目用途、用户对象、业务流程

但这些信息**散落在各个 chat session 中**，没有系统性的提取、归类和沉淀。同时，多个 AI agent 并行工作时，缺乏统一的状态监控面板。

## 2. 产品定位

**AI Chat Management Dashboard** — 你与 AI 对话的第二大脑。

一句话描述：一个本地 Web Dashboard，统一管理你与 AI 工具的所有对话。用户只需一次接入，后台自动完成一切。

## 3. 核心价值

三个关键能力：

| 能力 | 一句话 | 典型场景 |
|------|--------|----------|
| **Monitor** | 实时监控所有 AI chat 运行状态 + 系统通知 | 同时跑 3 个 agent，一个面板看全部状态 |
| **Digest** | Chat 结束自动总结、自动打 tag、知识沉淀 | 聊了 2 小时容灾方案，结束后自动生成结构化总结 |
| **Recall** | 按 tag 聚合、全文搜索、找相似历史对话 | 新 chat 要讨论容灾，先搜出过去所有容灾相关讨论 |

## 4. 目标

- 提供后台守护进程，**自动监控** Cursor / Claude Code / Codex 的所有 chat 运行状态
- Chat 结束后**自动生成结构化总结**（讨论主题、上下文、问题、方案、领域知识）并**自动打 tag**
- 通过 **Web Dashboard** 提供实时监控、总结浏览、tag 聚合、全文搜索能力
- 提供 **MCP Server**，让 AI 工具可以查询历史知识（按 tag、关键词、相似度）
- 支持**系统通知**：chat 完成 / 总结生成时推送 macOS 通知

## 5. 非目标（v0 明确不做）

- 不做原生 macOS 应用（v5 计划，先用 Web）
- 不做多用户/团队协作功能
- 不做 AI chat 内容的自动注入（用户主动搜索+选择）
- 不替代 AI 工具自身功能
- 不做云端存储 / SaaS

## 6. 用户与场景

| 用户 | 场景 |
|------|------|
| 独立开发者 | 日常使用多个 AI 工具，希望对话知识不丢失 |
| 重度 AI 用户 | 同时运行多个 agent，需要统一监控面板 |
| 项目负责人 | 想回顾某个主题的历史讨论（如"容灾"相关的 5 次对话） |

## 7. 用户旅程

```
1. 安装 → ai-chat-digest start（一行命令）
2. 接入 → 配置 MCP server 到 Cursor / Claude Code / Codex（一次性）
3. 使用 → 正常使用 AI 工具，无需任何额外操作
4. 查看 → 打开 localhost:3000 Dashboard
         ├─ Monitor 面板：实时看到所有正在进行的 chat
         ├─ 收到通知：某 chat 完成 → 总结已生成
         ├─ Summaries 面板：浏览/搜索所有历史总结
         ├─ Tags 面板：按 "容灾" tag 聚合查看 5 次相关讨论
         └─ 相似 chat：找到与当前话题相关的历史对话
5. 复用 → 在新 chat 中让 AI 调用 MCP 查询历史知识
```

## 8. 总结输出结构

每次 chat 自动总结后生成以下结构化内容：

- **标题**：自动生成的对话主题
- **Tags**：自动提取的主题标签（如 "容灾"、"CDN"、"React"）
- **讨论主题列表**
- **提供的上下文**：内部工具、内部定义、外部资源
- **讨论过程**：按时间顺序的关键节点
- **发现的问题**
- **确定的方案**
- **领域知识**：项目概览、目标用户、用户流程、技术栈、关键术语
- **待办事项**

## 9. Web Dashboard 页面

### Monitor（实时监控）
- 顶部状态栏：活跃 session 数、今日已总结数
- Session 卡片网格：平台图标、状态指示灯、消息数、运行时间、首条消息预览
- WebSocket 实时更新

### Summaries（总结列表）
- 按平台、日期、tag 多选筛选
- 全文搜索
- 卡片式列表：标题 + tags + 摘要预览

### Tags（标签聚合）
- Tag 云展示 + 使用频次
- 点击 tag 查看该 tag 下所有总结

### Detail（总结详情）
- 完整结构化总结
- 侧边栏：相似 chat 推荐
- 操作：编辑 tag、重新生成总结、导出 Markdown

### Similar（相似 chat）
- 基于 tags + 内容匹配的相似度排序列表

## 10. 通知机制

双层保障：
- **守护进程层**：node-notifier → macOS Notification Center（不依赖浏览器）
- **Web 层**：浏览器 Notification API + 页面内 toast

## 11. 支持平台

| 平台 | Transcript 路径 | 格式 |
|------|-----------------|------|
| Cursor | `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/` | JSONL: `{role, message}` + XML 标签 |
| Claude Code | `~/.claude/projects/<encoded-path>/` | JSONL: `{type, uuid, message}` + 结构化 tool_use |
| Codex | `~/.codex/sessions/YYYY/MM/DD/` | JSONL event-log: `{timestamp, type, payload}` |

## 12. 成功指标

- 作者本人连续 2 周日常使用，不再需要手动回翻 chat 历史
- 90%+ 的 chat 能成功自动总结并打出有意义的 tag
- Dashboard 日均打开 > 3 次
- 每周至少 1 次通过 MCP/搜索 复用历史知识

## 13. 开放问题

- Tag 归一化策略：LLM 输出 "容灾方案" 和 "灾备" 是否需要自动合并？
- 长对话 (>100K tokens) 的分段总结质量如何保证？
- 是否需要支持手动编辑总结内容？
- v1 是否引入 embedding 向量做语义相似度？

## 14. 分阶段交付

| Phase | 内容 |
|-------|------|
| 0 | 文档先行：PRD / DESIGN / TEST_STRATEGY |
| 1 (MVP) | 后端核心：解析器 + DB + 守护进程 + 自动总结 + auto-tag |
| 2 | Web Dashboard：监控 + 浏览 + tag 聚合 + 搜索 |
| 3 | MCP + CLI：AI 工具集成 + 命令行操作 |
| 4 | 增强：相似推荐、tag 归一化、导出、通知 |
| 5 | 原生 macOS 应用 (Swift) |

## 15. 相关文档

- `docs/tech/DESIGN.md` — 技术设计
- `docs/test/TEST_STRATEGY.md` — 测试策略
- `docs/collab/LOG.md` — 协作日志
