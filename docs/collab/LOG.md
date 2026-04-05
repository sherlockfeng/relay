# 协作日志（Collaboration Log）

本文件为 **追加式** 记录：新条目写在最上方（倒序），禁止删除历史条目；若需更正，追加一条「更正说明」并引用原日期。

## 条目模板

```markdown
### YYYY-MM-DD — <角色：产品|研发|测试> — <一句话标题>

- **背景**：
- **决策 / 结论**：
- **开放问题**：
- **下一步**：@<角色或具体动作>
- **相关文档**：`docs/...`
```

---

### 2026-04-04 — 产品 — 确定产品定位：AI Chat Management Dashboard

- **背景**：需要一个工具来管理与 AI 工具（Cursor / Claude Code / Codex）的所有对话，沉淀对话中的知识。
- **决策 / 结论**：
  - 产品定位为 **AI Chat Management Dashboard**，三大核心能力：Monitor（实时监控）、Digest（自动总结 + tag）、Recall（搜索 + 聚合）
  - 产品形态为**本地 Web Dashboard**（localhost:3000），后续 v5 迁移原生 macOS
  - 通知双层保障：daemon 层 node-notifier + Web 层 Notification API
  - 上下文注入不做自动注入，而是用户主动搜索相似 chat
  - LLM 驱动采用双模式：MCP 模式（host AI 总结）+ CLI 模式（独立 API 调用）
- **开放问题**：
  - Tag 归一化策略待定（embedding 合并 vs 手动管理）
  - 长对话分段总结的合并质量待验证
- **下一步**：@研发 填写技术设计文档，初始化 TypeScript 项目
- **相关文档**：`docs/product/PRD.md`、`docs/tech/DESIGN.md`

---

### 2026-04-04 — 研发 — 技术选型与架构设计

- **背景**：基于产品定位，确定技术栈和架构。
- **决策 / 结论**：
  - 技术栈：TypeScript + Node.js，SQLite (better-sqlite3 + FTS5)，Express + ws，React + Vite
  - 三平台 transcript 格式已调研完成（Cursor JSONL + XML 标签，Claude Code JSONL + 结构化 tool_use，Codex event-log JSONL）
  - 采用 chokidar 文件监听 + debounce timer 检测 session 生命周期
  - 数据库四表设计：sessions / summaries / tags / session_tags + FTS5 虚拟表
  - Auto-tag 两层：LLM 语义提取 + 规则补充（平台/项目/技术栈）
  - 分 5 个 Phase 交付，从 Phase 1 后端核心开始
- **开放问题**：是否需要引入 embedding 向量数据库做语义相似度（暂用 FTS5 + tag 交集）
- **下一步**：@研发 初始化 TypeScript 项目，实现 Phase 1
- **相关文档**：`docs/tech/DESIGN.md`、`docs/test/TEST_STRATEGY.md`

---

### 2026-04-04 — 研发 — 接入 Solo AI Collab 工作流

- **背景**：通过 `solo-ai-collab-adopt` Skill 初始化文档先行工作流。
- **决策 / 结论**：已建立 `docs/product`、`docs/tech`、`docs/test`、`docs/collab`；`AGENTS.md` 已包含协作规则。
- **开放问题**：待补充完整的 PRD、DESIGN、TEST_STRATEGY 内容。
- **下一步**：@产品 填写 `docs/product/PRD.md`；@测试 在阅读 PRD 后更新 `docs/test/TEST_STRATEGY.md`。
- **相关文档**：`docs/product/PRD.md`、`docs/tech/DESIGN.md`、`docs/test/TEST_STRATEGY.md`、`docs/ADOPTION.md`
