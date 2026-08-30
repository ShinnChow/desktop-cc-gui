## Why

侧栏“重新加载会话”目前触发旧的多阶段线程列表流程：先强制同步索引，随后仍继续执行 titles、shared 与多引擎 catalog merge，导致按钮响应慢、结果不稳定，且无法体现最新 workspace session index 的查询能力。现在需要把该入口收敛到已落地的 workspace session index 查询契约。

## 目标与边界

- 目标：点击按钮后强制刷新 workspace session index，并立即用索引投影更新侧栏会话列表。
- 保留主 workspace 刷新其 child worktrees 的既有 scope 行为。
- 维持现有服务层与 Tauri command，不新增依赖或后端 command。

## What Changes

- 删除“重新加载会话”确认弹窗及其旧的说明文案拼装。
- 为线程列表 loader 增加 index-only refresh 模式，跳过旧的多引擎 catalog fan-out。
- 菜单 quick reload 与确认入口统一调用 `list_session_index_for_workspace`，携带强制同步参数。
- 增加成功、空结果、失败与重复触发的回归测试。

## 非目标

- 不改变会话归档、删除、隐藏或 folder membership 规则。
- 不修改 `list_session_index_for_workspace` 的 IPC payload/response schema。
- 不重写普通首屏 hydration、Load older 或单会话 transcript 加载流程。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `workspace-sidebar-session-loading`: 用户显式 reload MUST 使用 workspace session index 的强制同步结果，并在不触发全量 engine catalog 的前提下更新 sidebar。

## Impact

- Frontend: `useAppShellLayoutNodesSection`、`useThreadActions` 及相关 Vitest policy/unit tests。
- Runtime/API: 复用现有 `list_session_index_for_workspace` Tauri command，无 Rust schema 变更。
- UX: 点击后无确认弹窗，刷新更快；失败时沿用 loader 的可恢复状态，不吞错误。
