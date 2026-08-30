# Change: harden-pi-session-curtain-fidelity

## Why

用户群反馈「pi + kimi 三方供应商」场景下会话幕布（消息列表）「老被吞会话」：
对话内容消失 / 会话内容不是当前会话。本地（官方 provider、健康磁盘）无法复现，
且无法获取用户机器上的 session jsonl 做端到端对账（区别于
`fix-claude-history-window-message-loss` 的取证路径）。

对 pi 链路的代码走查结论：claude 三根因（window 死游标、256KB 边界吞行、
post-turn reconcile 全量替换）在 pi 链路**结构性不存在**——`load_pi_session`
是整文件全量读（无 window/cursor），正常稳态（`engineSource === "pi"`）不走
codex reconcile。但走查发现 pi 专属的四类静默丢失 / 无自愈隐患，任一命中
都会产生「幕布被吞」体感：

1. **reconcile 排除名单漏 `pi:` 前缀**：`shouldReconcileCodexRealtimeThread`
   的排除名单含 claude/gemini/grok/kimi/opencode/dsh，唯独缺 `pi:` /
   `pi-pending-`。当 pi 线程在 `threadsByWorkspace` 查不到（列表未 hydrate、
   rename 未落地、快照恢复缺字段）或 `engineSource` 为 undefined 时，pi 的
   turn/completed 会误入 codex reconcile 分支触发 `refreshThread`；merge
   锚点对齐失败时回退「信任磁盘整体替换」，磁盘 flush 落后于 live 时裁掉
   live 尾部。测试盲区：reconcile 测试无任何 pi 用例。
2. **pi load 失败静默吞掉且 `loadedThreadsRef` 照样置位**：
   `resumeThreadForWorkspace` 的 pi 分支 `catch` 裸吞加载异常后无条件
   `loadedThreadsRef.current[threadId] = true`——`load_pi_session` 失败一次
   （SESSION_NOT_FOUND / IPC 抖动 / 文件读失败），幕布停留在空 / 旧状态，
   且「已加载」标记阻止后续所有重试（含 20s 切回 refresh），形成
   「吞了刷新也回不来」的 sticky 丢失。其他引擎已有
   `markHistoryRecoveryFailure` 降级记录，pi（与 DSH）是裸吞。
3. **切回 refresh 的落盘竞态无守卫**：切回已加载线程 20s 冷却后自动再
   resume（全量替换），仅挡「正在处理」，不挡「刚 settle、pi CLI 尚未
   flush 完 jsonl」的窗口；kimi 三方供应商（慢响应、长响应）恰是高发配置。
4. **merge 锚点 miss 回退不可观测**：`mergeHydratedItemsPreservePrefix`
   锚点对齐失败时静默回退整体替换，事后无法从 debug 面板判断一次「吞」
   是替换回退还是别的原因。

本 change 按「无法取证 → 埋点自证 + 构造性测试 + 防御性加固」路径收口：
不猜测唯一根因，把上述结构隐患全部封死或变为可观测，发布后下次用户反馈
可凭 debug 面板直接定位。

## What Changes

### Frontend（P0，零回滚风险）

- `useThreadRealtimeHistoryReconcile`：排除名单补 `pi:` / `pi-pending-`，
  pi 线程永不误入 codex post-turn reconcile（与 grok/kimi 同等待遇；
  pi 无 window 加载、无 cursor 语义，codex refresh 分支对其本是错误分支）。
- `resumeThreadForWorkspace` pi 分支：load 抛错不再置
  `loadedThreadsRef = true`；接入 `markHistoryRecoveryFailure` 降级记录
  （`reasonCode: pi-history-load-failed`），使 20s 切回 refresh 与下次
  选中可重试；连续失败达上限（3 次）后停止重试防风暴（保留降级记录）。
- `applyHydratedItems` 的 merge 路径：锚点 miss 触发「信任磁盘整体替换」
  回退时打 debug entry（`pi/merge anchor-miss fallback-to-disk`，附
  itemCountBefore/After），纯观测、零行为变化。

### 已知同类、本 change 不动（记录待办）

- DSH 分支同款「裸吞 + loaded 置位」：单独开 change，避免本次面铺大。
- 后端 `align_rpc_session` 找不到 session 文件静默 `new_session()`
  （`engine/pi.rs`）：已有 warn 日志，事件化回报前端涉及 contract 变更，
  待用户侧证据指向该链再立项。
- pi post-turn 磁盘回底（对齐 claude 的 reconcile 设计）：前置依赖
  「pi live item id 与磁盘 entry id 同源」验证，未验证前不移植，防
  引入新丢失模式。

## Impact

- 影响：`useThreadRealtimeHistoryReconcile.ts`、
  `useThreadActionsResumeThread.ts` 及两者测试。
- 不涉及 backend / Rust 改动，不触碰 engine registry / provider binding /
  canonical fact schema（ADR 校准回写 Gate 不触发）。
- 行为变化仅在 pi 异常路径：正常稳态（load 成功、engineSource 正确）
  零变化。
