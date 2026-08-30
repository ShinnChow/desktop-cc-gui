## ADDED Requirements

### Requirement: PI threads MUST NOT enter the codex post-turn history reconcile

`shouldReconcileCodexRealtimeThread` 的排除名单 MUST 覆盖 `pi:` 与
`pi-pending-` 前缀：无论 pi 线程是否在 `threadsByWorkspace` 中可查、
`engineSource` 是否缺失，pi 线程的 turn/completed MUST NOT 触发 codex
reconcile 分支的 `refreshThread`。

#### Scenario: pi thread missing from the sidebar list

- **WHEN** turn/completed 携带 `pi:{sessionId}` 到达且该 id 不在线程列表
- **THEN** MUST NOT 调度 codex realtime history reconcile（refreshThread 不被调用）

#### Scenario: pending pi thread settles before rename

- **WHEN** turn/completed 携带 `pi-pending-{ts}` 到达（session id rename 尚未落地）
- **THEN** MUST NOT 触发 codex reconcile

#### Scenario: healthy pi thread stays inert

- **WHEN** pi 线程在列表中且 `engineSource === "pi"`
- **THEN** post-turn reconcile MUST NOT 触发（现状语义锁定，防回归）

### Requirement: PI history load failure MUST stay retryable and be observable

`resumeThreadForWorkspace` 的 pi 分支在 `load_pi_session` 抛错时 MUST NOT
置位 loaded 标记（保持可重试），MUST 记录降级 debug entry（reasonCode
`pi-history-load-failed`）；连续失败达到上限（3 次）后 MUST 停止自动重试
（防风暴）且降级记录保留。load 成功路径的行为 MUST 与现状一致。

#### Scenario: transient load failure recovers on next resume

- **WHEN** pi 会话首次 load 抛错（如 IPC 抖动）
- **AND** 用户随后切回该会话触发 resume
- **THEN** load MUST 被重新执行（loaded 标记未在前次失败时置位）
- **AND** debug 面板 MUST 存在 `pi-history-load-failed` 降级记录

#### Scenario: permanently missing session file stops retry storm

- **WHEN** pi 会话连续 3 次 load 失败
- **THEN** 后续 resume MUST 不再自动重试 load
- **AND** 降级记录 MUST 保留（reopenOutcome 反映会话不可恢复）

### Requirement: Preserve-prefix merge fallback to disk MUST be observable

pi 会话 `applyHydratedItems` 的 merge 路径 MUST 在锚点对齐失败、回退「信任磁盘整体替换」时产生 debug entry（附替换前后 item 数）；该观测 MUST NOT 改变合并结果。

#### Scenario: anchor miss during merge

- **WHEN** merge 时当前列表非空但无任何 item id 命中 hydrated 首锚
- **THEN** 合并结果为 hydrated 整体（回退语义不变）
- **AND** debug 面板 MUST 出现 anchor-miss 回退记录（itemCountBefore/After）
