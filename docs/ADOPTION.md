# 新项目与旧项目接入指南

本文说明：**从零新建** 与 **已有仓库** 如何落地本工作流。原则不变：真相在 `docs/` + `docs/collab/LOG.md`，聊天只辅助推进。

---

## 一、新项目如何使用

### 1. 拷贝内容到仓库根目录

任选其一：

- **模板整仓**：若本工作流已发布到你的 Git 远端，可 fork / clone 后改名为业务项目名；或
- **最小拷贝**：只复制到你的空项目根目录：
  - `docs/` 整树（含四个子目录与初始 md）
  - `AGENTS.md`
  - 可选：`README.md` 中「工作流」章节改成你项目的说明，或保留本仓库 README 作「流程说明」、另写 `README` 介绍业务

### 2. 初始化 Git（若尚未）

```bash
git init
```

首条提交建议包含：`docs/`、`AGENTS.md`、你的项目 `README`。

### 3. 清空或改写模板里的「元文档」

本模板里的 `PRD.md`、`DESIGN.md`、`TEST_STRATEGY.md` 描述的是 **工作流本身**。新项目应改为 **你的业务**：

| 文件 | 新项目里应写成 |
|------|----------------|
| `docs/product/PRD.md` | 你的产品：用户、问题、范围、非目标 |
| `docs/tech/DESIGN.md` | 你的技术：架构、栈、关键决策（可用 tech-doc-collab 迭代） |
| `docs/test/TEST_STRATEGY.md` | 你的测试：策略、用例、验收（黑盒依据 PRD + 契约） |

可在 `docs/collab/LOG.md` **追加一条**：「已切换为业务项目，模板元文档已替换为 xxx」。

### 4. 写第一条业务向 LOG

在 `LOG.md` 顶部（模板规定的倒序区）追加，例如：

- 背景：项目立项 / 想法验证
- 决策：MVP 范围
- 开放问题：未决需求
- 下一步：@产品 补 PRD §x / @研发 技术 spike

### 5. 开 Agent 会话时的固定开场

每个会话第一条消息建议包含：

1. 角色：**我是产品 | 研发 | 测试**
2. 指令：**先阅读 `docs/collab/LOG.md`，再读我职责对应的 `docs/<product|tech|test>/`**
3. 本轮目标：一句话

### 6. 日常迭代顺序（推荐）

1. 产品改 `docs/product/` → 追加 LOG  
2. 研发更新 `docs/tech/`（必要时 `/decision`）→ 再改代码 → LOG  
3. 测试更新 `docs/test/`（只引用产品与已文档化契约）→ LOG  

---

## 二、旧项目如何接入

旧项目已有代码和零散文档，建议 **渐进接入**，避免大爆炸重写。

### 1. 盘点现有文档

列出仓库里已有内容，例如：`README`、`CONTRIBUTING`、`docs/*`、`RFC*`、`*.md` 根目录等。

### 2. 建立四目录（若不存在则新建）

```text
docs/product/
docs/tech/
docs/test/
docs/collab/
```

### 2b. 可选：脚本把旧文档「复制」到新体系（不删原路径）

若使用 **solo-ai-collab-adopt** 的 `adopt.mjs`，可在项目根执行：

```bash
# 内置 baby-log 映射：01-PRD/PRD.md → product/PRD.md，02-Architecture/overview → tech/DESIGN.md，06-E2E/mobile-e2e → test/TEST_STRATEGY.md
node .cursor/skills/solo-ai-collab-adopt/scripts/adopt.mjs --preset baby-log

# 目标文件已存在时需覆盖旧内容时加 --force（会用源文件覆盖）
node .cursor/skills/solo-ai-collab-adopt/scripts/adopt.mjs --preset baby-log --force
```

自定义项目可复制 `templates/migrate/map.example.json` 为仓库内 `migrate-map.json`，编辑 `copies` 数组后：

```bash
node .cursor/skills/solo-ai-collab-adopt/scripts/adopt.mjs --migrate-map ./migrate-map.json
```

说明：**复制** 而非移动；`AGENTS.md` 里的「必读路径」不会自动改写——若认定 `docs/product|tech|test` 为单一事实来源，请在必读列表中显式加入或改为指向新路径。

### 3. 搬迁与映射（不删原文件也可）

| 常见现状 | 建议落点 |
|----------|----------|
| 需求、原型说明、交互稿 | `docs/product/`（可保留原路径，在新目录放 **索引 md** 链到旧文件） |
| 架构图、ADR、API 说明 | `docs/tech/` |
| 测试计划、用例、E2E 说明 | `docs/test/` |

**原则**：历史路径可以不动，但在 `docs/collab/LOG.md` 写清 **「权威读法」**——例如「产品以 `docs/product/PRD.md` 为准，旧版 `specs/foo.md` 已废弃」。

### 4. 合并 `AGENTS.md`

若项目已有 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules`：

- **不要直接覆盖**。把本模板的 `AGENTS.md` 中与 **多角色、目录、文档门禁** 相关的章节 **合并进去**，或单独成文 `AGENTS.collab.md` 并在主 `AGENTS.md` 顶部写：「协作流程见 `AGENTS.collab.md`」。
- Cursor 多文件规则并存时，以你团队实际生效顺序为准；避免重复矛盾条文。

### 5. 首条「接入」LOG

追加一条，建议包含：

- **背景**：旧项目接入 Solo AI Collab 工作流  
- **决策**：四目录已创建；哪些旧文档仍有效、哪份是单一事实来源（SSOT）  
- **开放问题**：哪些文档仍待搬迁  
- **下一步**：谁补全 PRD / 谁补架构一页纸  

### 6. 门禁分期落地

| 阶段 | 做法 |
|------|------|
| 第 1 周 | 只要求 **新功能** 必须带 `docs/product` 片段 + LOG 一条 |
| 第 2 周起 | 新功能 + **对应 tech/test** 更新（或 LOG 声明豁免原因） |
| 可选 | 在 CI 加脚本：改动了 `src/`（路径自定）时提醒检查 `docs/`（软门禁即可） |

### 7. 测试角色的「黑盒」在旧项目中的折中

若历史用例严重依赖实现，可 **分轨**：

- **新用例**：只依据 `docs/product` + 文档化 API/契约  
- **旧用例**：在 `docs/test/` 注明「历史债务，依据代码行为」，并计划在 LOG 里排期收敛  

---

## 三、自检清单

- [ ] 根目录有 `AGENTS.md`（或与之一致的合并版）  
- [ ] `docs/collab/LOG.md` 存在且最新决策在顶部可见  
- [ ] 产品/技术/测试至少各有一份 **当前迭代可读** 的入口文档（可为短链 + 索引）  
- [ ] 三个 Agent 会话均约定「先 LOG，再本职目录」  

---

## 相关文档

- 仓库根目录 `README.md`  
- `AGENTS.md`  
- `docs/product/PRD.md`、`docs/tech/DESIGN.md`、`docs/test/TEST_STRATEGY.md`（业务项目里应替换为实际内容）
