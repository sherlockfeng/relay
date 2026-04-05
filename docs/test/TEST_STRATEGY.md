# 测试策略：AI Chat Digest

**文档类型**：测试设计（黑盒为主）  
**状态**：v0.1  
**依据**：`docs/product/PRD.md`、`docs/tech/DESIGN.md`（REST API / WebSocket 契约）

---

## 1. 测试目标

验证 AI Chat Digest 的核心功能链路可靠运行：transcript 解析 → 自动总结 → 存储 → 查询展示。

## 2. 测试范围

| 范围 | 说明 |
|------|------|
| Transcript 解析 | 三平台 JSONL 正确解析为 UnifiedTranscript |
| Session 生命周期 | active → idle → completed 状态流转正确 |
| 自动总结 | completed 后触发 LLM 调用，生成符合 ChatSummary 结构的输出 |
| Auto-Tag | 总结中提取的 tags 合理、可聚合 |
| REST API | 各端点返回正确数据（筛选、搜索、分页） |
| WebSocket | 状态变更事件正确推送 |
| Web Dashboard | 页面可访问、数据展示正确（验收级） |

## 3. 非范围

- 不测试 LLM 输出内容质量（依赖外部模型）
- 不测试 Cursor / Claude Code / Codex 自身行为
- 不测试操作系统通知渲染效果

## 4. 测试分层

### 4.1 单元测试（解析器）

| 用例 | 输入 | 期望输出 |
|------|------|----------|
| TC-P01: Cursor 解析 | Cursor JSONL fixture | UnifiedTranscript，messages 非空，XML 标签内容提取正确 |
| TC-P02: Claude Code 解析 | Claude Code JSONL fixture | UnifiedTranscript，tool_use/tool_result 正确关联 |
| TC-P03: Codex 解析 | Codex event-log JSONL fixture | UnifiedTranscript，function_call 提取正确 |
| TC-P04: 空文件 | 空 JSONL | 返回空 transcript，不抛异常 |
| TC-P05: 格式异常行 | 含非法 JSON 行的文件 | 跳过异常行，正常解析其余行 |
| TC-P06: 平台自动检测 | 不指定 platform 的文件路径 | 根据路径模式正确识别平台 |

### 4.2 集成测试（Daemon + 总结）

| 用例 | 前置 | 步骤 | 期望 |
|------|------|------|------|
| TC-D01: 新 session 检测 | 启动 watcher | 在监控目录创建新 JSONL 文件 | DB 中出现 status=active 的 session |
| TC-D02: session 状态流转 | TC-D01 | 停止写入文件 > 2min | status 变为 completed |
| TC-D03: 自动总结触发 | TC-D02 + mock LLM | session completed | summaries 表有对应记录，tags 已关联 |
| TC-D04: 恢复写入 | session 处于 idle | 向文件追加新行 | status 回到 active，取消 completed 计时 |

### 4.3 API 端到端测试

| 用例 | 端点 | 期望 |
|------|------|------|
| TC-A01: 列出 sessions | `GET /api/sessions` | 200，返回数组，含 id/platform/status |
| TC-A02: 按平台筛选 | `GET /api/sessions?platform=cursor` | 仅返回 cursor sessions |
| TC-A03: 获取总结 | `GET /api/summaries/:id` | 200，返回完整 ChatSummary 结构 |
| TC-A04: Tag 筛选 | `GET /api/summaries?tags=容灾` | 仅返回含该 tag 的总结 |
| TC-A05: 全文搜索 | `GET /api/search?q=CDN` | 返回匹配结果，按相关度排序 |
| TC-A06: Tag 列表 | `GET /api/tags` | 返回所有 tags + count，按频次降序 |

### 4.4 WebSocket 测试

| 用例 | 触发 | 期望收到事件 |
|------|------|-------------|
| TC-W01: session 启动 | 创建新 transcript 文件 | `session:started` 事件 |
| TC-W02: session 完成 | session idle > 2min | `session:completed` 事件 |
| TC-W03: 总结完成 | 总结生成写入 DB | `summary:ready` 事件含 title + tags |

### 4.5 Web Dashboard 验收

| 用例 | 步骤 | 期望 |
|------|------|------|
| TC-UI01: Monitor 页面 | 打开 localhost:3000 | 显示活跃 sessions 卡片 |
| TC-UI02: 实时更新 | session 状态变更 | 卡片状态指示灯自动变色 |
| TC-UI03: Summaries 筛选 | 选择 tag "容灾" | 列表仅显示含该 tag 的总结 |
| TC-UI04: 搜索 | 输入关键词搜索 | 结果列表相关且非空 |
| TC-UI05: Detail 页 | 点击总结卡片 | 展示完整结构化总结 |

## 5. 测试 Fixtures

为三个平台各准备至少一个真实格式的 JSONL fixture 文件：
- `fixtures/cursor-sample.jsonl` — 含 user/assistant 多轮对话 + XML 标签
- `fixtures/claude-code-sample.jsonl` — 含 tool_use/tool_result + uuid 链
- `fixtures/codex-sample.jsonl` — 含 session_meta + event_msg + response_item

## 6. LLM Mock 策略

集成测试中 mock LLM API，返回固定 ChatSummary JSON，确保测试不依赖外部 API。

## 7. 风险与技术债

| 风险 | 缓解 |
|------|------|
| 平台 transcript 格式升级导致解析失败 | fixture 文件版本化，新版本追加新 fixture |
| LLM 总结质量无法测试 | 人工抽检 + 留 regenerate 能力 |

## 8. 相关文档

- `docs/product/PRD.md` — 产品需求
- `docs/tech/DESIGN.md` — 技术设计（含 API/WS 契约）
- `docs/collab/LOG.md` — 协作日志
