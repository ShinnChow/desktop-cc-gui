# Design: fix-context-compacted-marker-turn-finality

## 决策 D1：专用 `context-event` kind，而不是守卫特判

两个候选：

- **A（采纳）**：新增 `kind: "context-event"`，留痕不再伪装 assistant message。
- **B（否决）**：保持 assistant message，在 `markLatestAssistantMessageFinal` 与 `foldCompletedTurn` 里按 `context-compacted-` id 前缀跳过。

B 的问题：三处消费点（finality、折叠 prose 判定、完成邮件聚合）各打一个前缀补丁，且未来任何「从尾部找 assistant」的新代码都要重复这个知识——前缀约定是隐性契约。A 把「这不是模型说的话」表达进类型系统，三个消费点的既有谓词（`isAssistantMessageItem` / `isAssistantMessageWithVisibleText` / `isCollapsibleProcessItem`）天然排除，**零特判**；代价只是渲染层加一个 case 和 memo 加一个分支。

## 决策 D2：`compaction_end` 的 reason 缺省置 null，不伪造 `"manual"`

`events.rs` 现状：`compaction_start` 缺 reason 时缺省 `"manual"`。对 start（进行中幕布）这是既有渲染契约，保留不动；对 end（留痕落库）伪造 manual 会让用户把自动压缩误读成人为操作——比缺省更糟。pi 的 `compaction_end` 实际恒发 reason（`threshold`/`overflow`/`manual`），null 只出现在异常 payload 下，此时 UI 显示中性文案即可。

## 决策 D3：Codex 链路不迁

`appendCodexCompactionMessage` / `settleCodexCompactionMessage` 是 Codex 专属形态（有 in-flight 状态机与 completed settle 语义），文案已 i18n，且 Codex 线程的极简折叠走独立判定，不受本 bug 影响。迁移它会扩大回归面，不做过。

（2026-08-27 追加轮补强证据链）时序侧核实：Codex auto-compaction 由 Rust 侧 watermark 门控（`app_server_auto_compaction.rs::evaluate_auto_compaction_state`——`is_processing || pending_user_dispatch || in_flight` 时不触发），即 `thread/compacted` 恒晚于 `turn/completed` 到达；手动压缩同样只在 idle 触发（`try_reserve_manual_compaction` 拒绝 processing 窗口）。因此 `markLatestAssistantMessageFinal` 早已打在真实回答上，后到的 codex fallback 留痕无 `isFinal`、极简锚点回溯天然跳过——与 pi 的「compaction_end 先于 agent_settled」不同型，锚点劫持在 Codex 链路结构上不成立。

## 渲染形态

`context-event` 行 = 居中细分割线 + 弱化小字：`已自动压缩上下文 · 236.5k → 41.2k tokens`（manual 则「已手动压缩上下文」，无 token 数据则只显示文案）。默认模式与极简模式同形态，均不进 chip、不参与折叠统计。命名沿用 `context-event` 而非 `context-compacted`，为未来同类引擎侧上下文事件（如溢出告警）留扩展位（`eventType` 判别字段）。

## 测试策略（TDD）

红→绿顺序（每步先写失败测试再实现）：

1. `useThreadsReducer.context-compaction.test.ts` 重写：append 产 `context-event`（断言 kind/reason/tokens/去重）；随后 dispatch `markLatestAssistantMessageFinal` 断言 `isFinal` 落在真实 assistant 消息（此断言在旧实现下必红）。
2. `messagesViewModel` 极简折叠新增 scenario：segment 含 final assistant + 留痕时锚点=final、留痕不在 `hiddenItemIds`（旧实现下留痕被误标 final 后锚点会错——配合 1 的 reducer 修复后绿；视图模型层本身零改动，测试钉契约）。
3. `events.rs` `pi_rpc_compaction_events_map_to_canonical_thread_methods` 扩展：`compaction_end` params 含 `reason`/`tokensBefore`/`estimatedTokensAfter`；无 reason 时为 null。
4. `ContextEventRow` 渲染测试：manual/threshold 文案、token 格式化、无 token 时省略。

## 影响面核对清单（实现时逐项过）

- `threadReducerTypes.ts`：action 增加可选字段（向后兼容，非破坏签名）。
- `useAppServerEvents.ts:2953` / `extractCompactionSourceFlags`：payload 扩展。
- `useThreadTurnEvents.ts:1097 onContextCompacted`：透传 reason/tokens；`ContextCompactionSourcePayload` 扩展字段。
- `TimelineRowRenderer.tsx`：新增 `renderKind === "context-event"` 分支（在 message 分支之前的类型收窄处）。
- `messageRowEquality.ts`：`MessageItem` 只覆盖 kind=message；新 kind 走通用 item 比较，核对比较函数对未知 kind 的行为（当前 fallback 为引用/浅比较即可，必要时加分支）。
- 客户端不持久化 `itemsByThread`（历史由引擎事件重放重建），无 round-trip 白名单问题；Claude 恢复重放 `compact_boundary` → `thread/compacted` 走同一 reducer，自动产新 kind。
- i18n：`src/i18n/locales/{zh,en}/*.ts` threads 命名空间新增 `contextCompactedAuto` / `contextCompactedManual`；检查 `i18nTestMessages.ts` 是否需要同步 key 集。
- 既有测试断言修正：`Composer.context-dual-view.test.tsx`（期待 `"Context compacted."` 文本）、`useThreadsReducer.compaction.test.ts`。

## 风险

- 极简折叠测试若已有对留痕消息的快照/统计断言，proseCount 会 -1（叙述段数变化）——属预期行为变化，随测试更新。
- `context-event` 进 `prepareThreadItems` 的 normalize 路径需确认不丢未知 kind（实现时读该函数核实，若存在 kind 白名单则补）。
