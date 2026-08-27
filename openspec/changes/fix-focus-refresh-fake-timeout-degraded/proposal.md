# Change: fix-focus-refresh-fake-timeout-degraded

## Why

接续 `fix-thread-list-timeout-backoff` 的根因复核（2026-08-27）：用户（Windows 0.9.3）数据中「129 次 30s 超时 / 49 分钟」**不是真超时**——实测本机 `list_claude_sessions` 扫描仅 ~260ms（daemon 直连计时），且 `list_codex_sessions`/`list_claude_sessions` 的快照 sync p50=14ms。代码走查钉死真相：

- `dff066c7b`（0.9.3，`isFocusRefreshMerge` 新增）让 focus-refresh merge **按设计跳过** codex 在线分页 / claude 磁盘 list / 活动 catalog（`Promise.resolve(null)`）。
- 但下游分支把 `value === null` 一律当 timeout：每次 focus-refresh merge 都会
  1. 打 2 条**假的**「30s 超时」日志（`thread/list claude timeout`、`thread/list codex catalog timeout`，payload `timeoutMs: 30000`）；
  2. `rememberPartialSource("claude-session-timeout" / "codex-catalog-timeout")` → `degradedPartialSource` 非空；
  3. 下游 `markThreadSummariesDegraded(visibleSummaries, ..., "partial-thread-list")` **把整个可见列表误标 degraded**；
  4. degraded 行进 `lastGoodSnapshotCandidates` → 下一轮 last-good floor 继续被污染（degradation 自粘）。
- 0.9.2 没有 `isFocusRefreshMerge` 跳过路径（git 实证），focus-refresh 是高频事件（用户机 233 次加载 / 53min ≈ 每 14s 一次），所以 0.9.3 上假超时与误标 degraded 呈常驻态——回归窗口实锤。

误标还直接误导诊断：本轮分析最初把「30s 扫描风暴」当真，实为日志假象；排障口径必须先诚实化。

## What Changes

- **focus-refresh merge 路径不再伪造 timeout**：`isFocusRefreshMerge` 时
  - 不 `rememberPartialSource("claude-session-timeout" / "codex-catalog-timeout")`；
  - 不打 `thread/list claude timeout` / `thread/list codex catalog timeout` 调试事件；
  - 因此下游不再把 by-design merge 的列表误标 `partial-thread-list` degraded。
- **last-good 兜底行为不变**：`seedLastGoodClaudeIntoMerged` 等 seed 路径在 focus-refresh merge 下照常执行（spec 的 last-good 保留契约不受影响）。
- **真实 timeout 语义不变**：full-catalog 路径（显式 reload / Session Management）的 `withTimeout` 竞出仍按现状记录 partialSource + 日志 + degraded 标记。

### Non-Goals

- 不动 first-paint 跳过 claude seed 时的既有 timeout 标记（0.9.2 已存在的语义，非本次回归；是否同样诚实化另案评估）。
- 不改 focus-refresh merge 的跳过集合本身（codex 分页 / claude list / catalog 仍跳过，这是 dff066c7b 的既定设计）。
- 不清理历史 diagnostics.json 中已写入的假超时条目。

## Capabilities

### Modified Capabilities

- `sidebar-list-timeout-fallback`：MODIFIED requirement「full-catalog hydration 子源 timeout 保留 last-good」——明确 timeout 判定仅适用于实际发起子源请求且 `withTimeout` 竞出的场景；focus-refresh merge 的 by-design skip MUST NOT 记为 timeout（日志 / partialSource / degraded 标记均不适用），last-good seed 兜底不变。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `src/features/threads/hooks/useThreadActions.ts`（两处 `rememberPartialSource` + onDebug 调用加 `!isFocusRefreshMerge` 门控） |
| 行为 | focus-refresh merge 的列表不再携带伪造 degraded 标记；诊断日志恢复「timeout = 真超时」语义 |
| 兼容性 | 列表成员/排序/显隐逻辑零变化；last-good floor 不变；无持久化/协议变更 |
| 验证方式 | TDD 先红后绿：`useThreadActions.native-session-bridges.test.tsx` 增 focus-refresh 无假超时/无误标用例；`useThreadActions.timeout-fallback.test.tsx`（真实 timeout 路径）回归全绿 |

## Acceptance

- **A1**：focus-refresh merge 运行后，`onDebug` 不出现 `thread/list claude timeout` 与 `thread/list codex catalog timeout`；dispatch 的 threads 无 `partialSource: "claude-session-timeout" / "codex-catalog-timeout"` 与 `degradedReason: "partial-thread-list"`。
- **A2**：focus-refresh merge 下 last-good Claude 行仍出现在最终列表（seed 兜底不回归）。
- **A3**：full-catalog 真实 timeout（mock 子源永不 resolve）仍按现状记录 partialSource、打 timeout 日志、标记 degraded（既有 timeout-fallback 测试全绿）。
- **A4**：`npm run typecheck` 本 change 文件 0 error；相关测试文件无新增失败（对照在途基线）。
