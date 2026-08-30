## MODIFIED Requirements

### Requirement: Workspace Sidebar Hydration MUST Be Staged And Deduplicated

系统 MUST 按 foreground priority 分阶段加载 workspace sidebar sessions，并确保同一 workspace/query generation 不会并发启动重复 hydration。用户显式 reload MUST 直接使用 workspace session index 的强制同步结果完成当前列表更新，且 MUST NOT 继续启动全量 engine catalog fan-out。

#### Scenario: active workspace hydrates before idle workspaces

- **WHEN** 应用恢复多个 workspaces
- **THEN** active workspace MUST 先进入 hydration
- **AND** inactive workspaces MUST 通过 bounded idle scheduling 预热
- **AND** inactive hydration MUST NOT block the active-workspace ready milestone

#### Scenario: duplicate hydration request reuses current work

- **WHEN** 同一 workspace 在 loading 或 in-flight 状态再次收到等价 hydration 请求
- **THEN** 系统 MUST skip or reuse the current work
- **AND** MUST NOT issue a duplicate full-catalog request

#### Scenario: explicit reload uses the current workspace session index

- **WHEN** 用户点击工作区菜单中的“重新加载会话”
- **THEN** 系统 MUST invoke `list_session_index_for_workspace` with forced synchronization
- **AND** MUST project the returned index page into the sidebar session rows
- **AND** MUST NOT invoke the legacy multi-engine catalog fan-out for that reload

#### Scenario: main workspace reload cascades only to its child worktrees

- **WHEN** 用户从 main workspace 触发显式 reload
- **THEN** 系统 MUST refresh the main workspace and its child worktrees
- **AND** MUST NOT refresh unrelated workspaces

#### Scenario: stale reload result cannot overwrite a newer request

- **WHEN** an older reload response resolves after a newer reload for the same workspace
- **THEN** the older response MUST NOT overwrite the newer sidebar projection

#### Scenario: reload exposes loading feedback

- **WHEN** a workspace reload request is in flight
- **THEN** the reload menu action MUST show a busy visual state
- **AND** the action MUST be disabled until the request settles
