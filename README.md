# AI Chat Digest

**AI Chat Management Dashboard** — Monitor, Digest, Recall your AI conversations.

一个本地 Web Dashboard，统一管理你与 Cursor / Claude Code / Codex 的所有对话。后台自动监控 chat 状态，chat 结束自动生成结构化总结并打 tag，支持按 tag 聚合、全文搜索、查找相似对话。

## 核心能力

| 能力 | 说明 |
|------|------|
| **Monitor** | 实时监控所有 AI chat 运行状态 + 系统通知 |
| **Digest** | Chat 结束自动总结、自动打 tag、知识沉淀 |
| **Recall** | 按 tag 聚合、全文搜索、找相似历史对话 |

## 快速开始

### 1. 安装

```bash
git clone https://github.com/user/ai-chat-digest.git
cd ai-chat-digest
npm install
cd web && npm install && cd ..
```

### 2. 配置

```bash
mkdir -p ~/.ai-chat-digest
cat > ~/.ai-chat-digest/config.json << 'EOF'
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-your-key-here"
  },
  "platforms": {
    "cursor": { "enabled": true },
    "claude-code": { "enabled": true },
    "codex": { "enabled": true }
  },
  "server": { "port": 3000 },
  "notifications": { "enabled": true }
}
EOF
```

支持的 LLM provider: `openai`、`anthropic`

### 3. 构建 & 启动

```bash
npm run build
node bin/ai-chat-digest.mjs start
```

打开浏览器访问 `http://localhost:3000`

## 接入 AI 工具

### Cursor（MCP Server）

在 `~/.cursor/mcp.json` 中添加:

```json
{
  "mcpServers": {
    "ai-chat-digest": {
      "command": "node",
      "args": ["/path/to/ai-chat-digest/dist/mcp/server.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add ai-chat-digest -- node /path/to/ai-chat-digest/dist/mcp/server.js
```

### Codex

在 `~/.codex/config.toml` 中添加:

```toml
[mcp_servers.ai-chat-digest]
command = "node"
args = ["/path/to/ai-chat-digest/dist/mcp/server.js"]
```

## CLI 命令

```bash
ai-chat-digest start              # 启动守护进程 + Web Dashboard
ai-chat-digest stop               # 停止
ai-chat-digest status             # 查看运行状态
ai-chat-digest summarize [id]     # 手动总结
ai-chat-digest search "关键词"     # 搜索历史总结
ai-chat-digest tags               # 列出所有 tags
ai-chat-digest open               # 打开 Dashboard
```

## MCP Tools

接入后，AI 工具可使用以下 tools 查询历史知识:

- `search_summaries` — 全文搜索历史总结
- `get_similar_chats` — 查找相似对话
- `get_tag_summaries` — 按 tag 查看总结
- `get_summary` — 获取完整总结
- `list_tags` — 列出所有 tags

## 支持平台

| 平台 | Transcript 路径 |
|------|-----------------|
| Cursor | `~/.cursor/projects/*/agent-transcripts/` |
| Claude Code | `~/.claude/projects/*/` |
| Codex | `~/.codex/sessions/` |

## 开发

```bash
# 启动后端 (watch mode)
npx tsup --watch

# 启动前端 (dev server, 会代理 API 到 :3000)
cd web && npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build
```

## 技术栈

- **Backend**: TypeScript, Express, WebSocket, better-sqlite3 (FTS5), chokidar
- **Frontend**: React, Vite, TailwindCSS
- **LLM**: OpenAI / Anthropic SDK
- **Integration**: MCP (Model Context Protocol)

## 文档

- [产品需求](docs/product/PRD.md)
- [技术设计](docs/tech/DESIGN.md)
- [测试策略](docs/test/TEST_STRATEGY.md)
- [协作日志](docs/collab/LOG.md)

## License

MIT
