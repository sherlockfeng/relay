# 技术设计：AI Chat Digest

**文档类型**：技术方案  
**状态**：v0.1  
**依赖**：Node.js >=18, SQLite

---

## 1. 范围

本文描述 AI Chat Digest 的技术架构、数据模型、模块设计与对外契约。

## 2. 技术栈

| 层 | 技术 | 选型理由 |
|----|------|----------|
| Runtime | Node.js (TypeScript) | MCP 生态原生语言，npx 分发方便 |
| File Watching | chokidar | 跨平台文件监听，成熟稳定 |
| Database | better-sqlite3 + FTS5 | 嵌入式、零配置、支持全文搜索 |
| API | Express + ws | 轻量 HTTP + WebSocket |
| Web UI | React + Vite + TailwindCSS | 快速开发，现代 UI |
| LLM | openai + @anthropic-ai/sdk | 双 provider 支持 |
| MCP | @modelcontextprotocol/sdk | 标准 AI 工具集成协议 |
| CLI | commander | Node.js CLI 标准库 |
| Notifications | node-notifier | 跨平台系统通知 |
| Build | tsup (backend) + Vite (frontend) | 快速 bundle |

## 3. 架构

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                  User Interfaces                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Web UI   │  │   CLI    │  │   MCP Server     │  │
│  │ :3000    │  │          │  │ (for AI tools)   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                  │            │
│  ┌────┴──────────────┴──────────────────┴─────────┐ │
│  │           REST API + WebSocket (:3000)          │ │
│  └────────────────────┬───────────────────────────┘ │
│                       │                              │
│  ┌────────────────────┴───────────────────────────┐ │
│  │                  Core Engine                    │ │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │ │
│  │  │ Parsers  │ │Summarizer │ │   Tagger     │  │ │
│  │  │(3 types) │ │ (LLM API) │ │(LLM+rules)  │  │ │
│  │  └──────────┘ └───────────┘ └──────────────┘  │ │
│  └────────────────────┬───────────────────────────┘ │
│                       │                              │
│  ┌────────────────────┴───────────────────────────┐ │
│  │        SQLite (sessions, summaries, tags)       │ │
│  │              + FTS5 full-text index             │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │          Background Daemon                      │ │
│  │  ┌──────────┐ ┌──────────────┐ ┌───────────┐  │ │
│  │  │ Watcher  │ │Session Tracker│ │ Notifier  │  │ │
│  │  │(chokidar)│ │ (lifecycle)  │ │(node-ntfy)│  │ │
│  │  └──────────┘ └──────────────┘ └───────────┘  │ │
│  └────────────────────────────────────────────────┘ │
│                       ▲                              │
│         ┌─────────────┼─────────────┐               │
│         ▼             ▼             ▼               │
│   ~/.cursor/    ~/.claude/    ~/.codex/              │
│   transcripts   projects      sessions              │
└─────────────────────────────────────────────────────┘
```

### 数据流

1. **File Watcher** 监听三个平台的 transcript 目录
2. **Session Tracker** 通过文件变更检测 session 生命周期
3. Session completed → **Parsers** 将 JSONL 解析为 UnifiedTranscript
4. **Summarizer** 调用 LLM 生成结构化总结
5. **Tagger** 从总结中提取 tags（LLM 语义 + 规则补充）
6. 结果写入 **SQLite**，通过 WebSocket 推送前端

## 4. 核心类型

```typescript
interface UnifiedTranscript {
  id: string;
  platform: 'cursor' | 'claude-code' | 'codex';
  project?: string;
  gitBranch?: string;
  startTime: string;
  endTime?: string;
  messages: UnifiedMessage[];
  toolsUsed: ToolUsage[];
  filesReferenced: string[];
  metadata: Record<string, unknown>;
}

interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  toolCalls?: { name: string; input: string; output?: string }[];
}

interface ChatSummary {
  title: string;
  topics: string[];
  tags: string[];
  contextProvided: {
    internalTools: string[];
    internalDefinitions: string[];
    externalResources: string[];
  };
  discussionProcess: string[];
  problemsDiscovered: string[];
  decidedSolutions: string[];
  domainKnowledge: {
    projectOverview?: string;
    targetUsers?: string;
    userFlows?: string[];
    techStack?: string[];
    keyTerms?: Record<string, string>;
  };
  actionItems?: string[];
}

type SessionStatus = 'active' | 'idle' | 'completed';
```

## 5. 数据库 Schema

```sql
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL,          -- 'cursor' | 'claude-code' | 'codex'
  project_path    TEXT,
  git_branch      TEXT,
  transcript_path TEXT NOT NULL,
  status          TEXT DEFAULT 'active',  -- 'active' | 'idle' | 'completed'
  message_count   INTEGER DEFAULT 0,
  first_message   TEXT,
  started_at      TEXT NOT NULL,
  last_active_at  TEXT,
  completed_at    TEXT,
  summarized      INTEGER DEFAULT 0
);

CREATE TABLE summaries (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  title               TEXT NOT NULL,
  topics              TEXT,               -- JSON array
  context_tools       TEXT,               -- JSON array
  context_defs        TEXT,               -- JSON array
  discussion_process  TEXT,               -- JSON array
  problems            TEXT,               -- JSON array
  solutions           TEXT,               -- JSON array
  domain_knowledge    TEXT,               -- JSON object
  action_items        TEXT,               -- JSON array
  raw_summary         TEXT,
  created_at          TEXT NOT NULL,
  model_used          TEXT
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  color TEXT
);

CREATE TABLE session_tags (
  session_id TEXT REFERENCES sessions(id),
  tag_id     INTEGER REFERENCES tags(id),
  PRIMARY KEY (session_id, tag_id)
);

CREATE VIRTUAL TABLE summaries_fts USING fts5(
  title, topics, problems, solutions, raw_summary,
  content='summaries', content_rowid='rowid'
);
```

## 6. Transcript 解析器

### Cursor Parser
- 路径模式: `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`
- 每行: `{role: "user"|"assistant", message: {content: [{type: "text", text: "..."}]}}`
- 上下文嵌入在 text 中的 XML 标签: `<user_query>`, `<attached_files>`, `<external_links>`, `<manually_attached_skills>`
- 解析策略: 逐行读取，正则提取 XML 标签中的结构化内容

### Claude Code Parser
- 路径模式: `~/.claude/projects/<encoded-path>/<sessionId>.jsonl`
- 索引文件: `sessions-index.json` 含 sessionId, messageCount, created 等
- 每行有 `type` 字段: `"user"` | `"assistant"` | `"queue-operation"`
- tool_use/tool_result 是结构化 JSON（不需要从 text 中提取）
- 有 uuid/parentUuid 可构建消息树

### Codex Parser
- 路径模式: `~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`
- 索引文件: `~/.codex/session_index.jsonl`
- event-log 格式: `{timestamp, type, payload}`
- type 种类: `session_meta`, `event_msg`, `response_item`, `turn_context`
- response_item 含 function_call / function_call_output（工具调用）

### Parser Factory
- 输入: 文件路径
- 自动检测平台（根据路径模式 / 首行格式）
- 输出: `UnifiedTranscript`

## 7. Session 生命周期

```
新文件出现           → active      → WS: session_started
文件持续增长          → active      → WS: session_updated
文件停止增长 >30s     → idle        → WS: session_idle
文件停止增长 >2min    → completed   → 触发总结 → WS: session_completed
手动重新写入          → active      → 取消计时器
```

实现: chokidar `watch()` + 每个 session 独立的 debounce timer（setTimeout）。

## 8. Auto-Tag 策略

两层提取:
1. **LLM 语义提取**: 总结 prompt 中要求返回 `tags: string[]`
2. **规则补充**: 平台 tag (`cursor` / `claude-code` / `codex`)、项目名 tag、技术栈 tag

Tag 命名规范: 中文优先、简短（2-4 字）、可复用。

## 9. REST API

| Method | Path | 描述 |
|--------|------|------|
| GET | /api/sessions | 列出 sessions（支持 status/platform 筛选） |
| GET | /api/sessions/:id | 获取 session 详情 |
| GET | /api/summaries | 列出总结（支持 tags/date/platform 筛选） |
| GET | /api/summaries/:id | 获取完整总结 |
| PATCH | /api/summaries/:id/tags | 编辑总结的 tags |
| POST | /api/summaries/:id/regenerate | 重新生成总结 |
| GET | /api/tags | 列出所有 tags + 使用频次 |
| GET | /api/tags/:name/summaries | 获取某 tag 下所有总结 |
| GET | /api/search | 全文搜索（q, tags, dateRange） |
| GET | /api/similar/:sessionId | 获取相似 chat |

## 10. WebSocket Events

| Event | Payload | 触发时机 |
|-------|---------|----------|
| `session:started` | `{id, platform, project}` | 检测到新 session |
| `session:updated` | `{id, messageCount}` | session 消息数变化 |
| `session:idle` | `{id}` | session 进入 idle |
| `session:completed` | `{id}` | session 标记完成 |
| `summary:ready` | `{sessionId, summaryId, title, tags}` | 总结生成完成 |

## 11. MCP Server Tools

| Tool | 参数 | 描述 |
|------|------|------|
| `search_summaries` | `query, tags?, limit?` | 全文搜索历史总结 |
| `get_similar_chats` | `sessionId` | 获取相似历史 chat |
| `get_tag_summaries` | `tagName` | 获取某 tag 下所有总结 |
| `get_summary` | `sessionId` | 获取完整总结 |
| `list_tags` | - | 列出所有 tags 及频次 |

## 12. 配置

配置文件: `~/.ai-chat-digest/config.json`

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-..."
  },
  "platforms": {
    "cursor": { "enabled": true },
    "claude-code": { "enabled": true },
    "codex": { "enabled": true }
  },
  "server": {
    "port": 3000
  },
  "notifications": {
    "enabled": true
  }
}
```

## 13. 项目目录结构

```
ai-chat-digest/
├── src/
│   ├── types/                  # 核心类型定义
│   ├── parsers/                # 三平台 JSONL 解析器
│   ├── daemon/                 # 后台守护进程（watcher + tracker + notifier）
│   ├── summarizer/             # LLM 总结引擎（prompts + client + tagger）
│   ├── storage/                # SQLite 存储层（schema + search + export）
│   ├── api/                    # Express REST API + WebSocket
│   ├── mcp/                    # MCP Server
│   ├── cli/                    # CLI 命令行工具
│   └── config.ts               # 配置管理
├── web/                        # React + Vite 前端
│   └── src/
│       ├── pages/              # Monitor, Summaries, Tags, Detail, Similar
│       ├── components/         # ActiveSession, SummaryCard, TagCloud, etc.
│       └── hooks/              # useWebSocket, useApi
├── bin/
│   └── ai-chat-digest.mjs     # CLI entry
└── package.json
```

## 14. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Transcript 格式变更（平台升级） | 解析器做版本检测 + 容错处理 |
| 长对话超出 LLM context window | 分段摘要 + 合并策略 |
| SQLite 单文件并发写 | daemon 是单进程，串行写入 |
| LLM API 失败 | 重试 + 标记为待总结，下次启动重试 |

## 15. 相关文档

- `docs/product/PRD.md` — 产品需求
- `docs/test/TEST_STRATEGY.md` — 测试策略
- `docs/collab/LOG.md` — 协作日志
