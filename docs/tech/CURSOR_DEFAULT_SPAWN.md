# Cursor 默认专家会话调用

## 背景

Relay 的 `spawn_agent` 过去在未显式传 `provider` 时默认走 Anthropic SDK。这样在 Cursor chat 中引入专家时，每次 MCP tool call 都会等待一次外部模型调用，并且小知识库会重复注入 chunks。

## 新行为

- 新增 MCP tool `start_relay_chat_session`，由当前 Cursor agent 在第一次需要 Relay 专家时自动调用。
- 该 tool 返回 `sessionId`，格式为 `relay-chat-<uuid>`。
- 当前 chat 后续调用 `spawn_agent` 时应传入这个 `sessionId`。
- `spawn_agent` 在未传 `provider` 时默认使用 `cursor` provider。
- `spawn_agent` 如果走 Cursor provider 但没有 `sessionId`，不再回退 Anthropic，而是返回可操作提示：先调用 `start_relay_chat_session`，再用返回的 `sessionId` 重试。
- Anthropic provider 保留为显式兼容路径：只有传 `provider: "anthropic"` 才走 Anthropic SDK。

## 目的

默认路径改为 Cursor SDK local agent 会话复用后，同一个 chat 内的专家上下文只初始化一次，后续调用通过 `(provider, roleId, sessionId)` resume Cursor agent，避免重复注入专家 chunks，并减少用户在 Cursor 中等待 `spawn_agent` 的时间。