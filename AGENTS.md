# Agent 协作规则（Solo AI Collab）

所有参与本项目的 AI Agent（无论会话角色自称产品、研发或测试）须遵守以下约定。

<!-- solo-ai-collab-workflow:start -->

<!-- solo-ai-collab-workflow:rules -->

## 角色与可写范围

| 角色 | 主要读取 | 主要写入 |
|------|----------|----------|
| 产品 | `docs/product/`、`docs/collab/LOG.md` | `docs/product/**`、`docs/collab/LOG.md` |
| 研发 | `docs/product/`、`docs/tech/`、`docs/collab/LOG.md`、源码 | `docs/tech/**`、源码、`docs/collab/LOG.md` |
| 测试 | `docs/product/`、`docs/test/`、**已文档化的**对外契约 | `docs/test/**`、`docs/collab/LOG.md` |

- **测试角色** 默认不阅读业务源码以实现「测试方案独立」；若必须引用实现，须在 `docs/test/` 注明依据为「文档中的契约」而非「代码行为」。
- 任何角色均可向 `docs/collab/LOG.md` **追加**条目，避免静默覆盖他人段落。

## 文档先行门禁

在提出或应用 **功能性代码变更** 之前：

1. 对应功能在 `docs/product/` 中已有描述（或 LOG 中明确「产品文档待补全」及负责人）。
2. `docs/tech/` 中设计与当前改动一致，或已更新。
3. `docs/test/` 中已有可执行的验收或用例更新计划；若本迭代不测，须在 LOG 说明原因。

## LOG 写法

在 `docs/collab/LOG.md` 追加时使用文件内模板区块格式，至少包含：**日期、作者角色、决策摘要、开放问题、下一步负责人**。

## 技术文档深度撰写

涉及 RFC、多方案对比、专家评审时，可使用 **tech-doc-collab** Skill；产出放在 `docs/tech/` 并在 `LOG.md` 登记链接。

<!-- solo-ai-collab-workflow:end -->
