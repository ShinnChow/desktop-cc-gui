## Context

工作区菜单的 reload handler 当前调用 `listThreadsForWorkspaceTracked`，该 loader 在强制刷新 Session Index 后仍会继续执行旧的 titles/shared/engine catalog stages。最新 workspace session index 已提供 `list_session_index_for_workspace`，其结果已能直接投影为 sidebar `ThreadSummary`。

## Goals / Non-Goals

**Goals:**

- 显式 reload 只执行强制 Session Index sync + index projection。
- 复用 loader 已有的 stale request、visibility、archive 与 main/worktree scope 处理。
- 保持重复点击安全，后发请求不得被旧请求覆盖。

**Non-Goals:**

- 不改变 backend command、session index schema 或普通 hydration/full catalog 行为。
- 不改会话 membership、archive/delete/folder 规则。

## Decisions

1. **在现有 loader 增加 index-only option（推荐）**：loader 仍是唯一 state owner，完成 index page 到 summaries 的现有映射后立即 dispatch 并 return。相比在 layout 层直接调用 service，避免绕过 reducer、visibility 与 stale guard；代价是新增一个明确的 option。
2. **保留 main→worktree cascade**：与现有 workspace scope resolver 一致。相比只刷新当前 workspace，用户从主项目触发时能同步看到所有项目会话，且不改变既有边界。
3. **移除确认弹窗**：reload 是可重复、只读的同步动作；相比保留确认，直接执行减少交互阻塞与旧说明文案维护。

## Risks / Trade-offs

- [Risk] index sync 失败时列表可能保持旧数据。→ 复用 loader 的错误/partial 状态与 stale guard，不清空 last-good rows，并保留可再次点击的入口。
- [Risk] index-only 不主动刷新 transcript title 映射。→ index row 自带 title；普通 hydration 与单会话加载继续负责详细 title/历史。
- [Risk] 多 worktree 并发刷新增加 IPC。→ 仅对主项目已有 scope 内 workspaces 发起一次 bounded index request，不启动 engine fan-out。

## Migration Plan

前端 option 与 handler 同步发布；无需数据迁移。若出现回归，可 revert 本次前端提交，恢复旧 loader 调用。

## Open Questions

无。刷新范围已确认保留主项目及其 child worktrees。
