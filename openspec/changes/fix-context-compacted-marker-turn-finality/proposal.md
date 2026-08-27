# Change: fix-context-compacted-marker-turn-finality

## Why

2026-08-27 用户反馈（群截图）：ccgui + pi 每轮回答结束后追加一条 "Context compacted."，且极简展示下**真实回答被折叠进 turn chip，幕布上只剩这句英文留痕**——看起来像「引擎答完只回了一句 Context compacted.」。

代码事实源（四步因果链，全部已核实）：

1. pi 的 auto-compaction 在 turn 收尾、`agent_settled` 之前执行（上游 `agent-session.js` `_handlePostAgentRun`），`compaction_end` 事件先于 settle 到达。
2. ccgui 后端把 `compaction_end` 映射为 canonical `thread/compacted`（`src-tauri/src/engine/events.rs:1054-1108`），前端 `onContextCompacted` → `appendContextCompacted`（`useThreadsReducer.ts:2418`）追加一条 **assistant 角色的合成消息**：id `context-compacted-<turnId>`、硬编码英文 `"Context compacted."`。
3. 随后 `agent_settled` → `turn/completed` → `onTurnCompleted`（`useThreadTurnEvents.ts:671`）执行 `markLatestAssistantMessageFinal`（`useThreadsReducer.ts:2176`）——从尾部找「最后一条 assistant 消息」打 `isFinal: true`。此时最后一条恰是刚入库的留痕消息，**真实回答反而没拿到 final**。「最后一条 = 最终回答」这一启发式被留痕消息破坏。
4. 极简展示 `foldCompletedTurn`（`messagesViewModel.ts:695-728`）：锚点默认取最后一条可见 prose 并回溯 `isFinal === true`——回溯第一眼命中被误标的留痕 → 锚点定为 "Context compacted."，segment 内其余全部 assistant prose（含真实回答）被折进 chip。

另外两处一并修正的次生问题：

- 后端 `compaction_end` 映射丢弃了 pi 提供的 `reason`（threshold/overflow/manual）与 token 前后值，前端留痕无法表达「这是自动压缩、压了多少」。
- 留痕文案硬编码英文，未走 i18n。

## What Changes

- **F1 新增 `context-event` item kind**：`ConversationItem` 增加独立变体 `{ kind: "context-event", eventType: "compacted", reason, tokensBefore, estimatedTokensAfter, turnId, timestampMs }`。压缩留痕不再是 assistant message——三个契约天然成立、零特判：
  - `markLatestAssistantMessageFinal` 的 `isAssistantMessageItem` 不命中 → `isFinal` 落到真实回答；
  - 极简折叠 `isAssistantMessageWithVisibleText` / `isCollapsibleProcessItem` 均不命中 → 留痕不参与锚点竞选、不折进 chip、不被 unmount，作为独立系统行常显；
  - `conversationCompletionEmail` 等按 assistant 文本聚合的链路不再把留痕当模型输出。
- **F2 `appendContextCompacted` 改产 `context-event`**：携带 reason / tokensBefore / estimatedTokensAfter / turnId / timestampMs；按 turnId 去重语义原样保留。
- **F3 后端透传**：`events.rs` Pi 臂 `compaction_end` → `thread/compacted` params 增加 `reason`（pi 恒发；缺失时置 null，不再伪造 `"manual"`——现 `compaction_start` 缺省 manual 的口径对 start 保留，end 不伪造）。
- **F4 事件分发透传**：`useAppServerEvents` 的 `thread/compacted` 分支提取 `reason` / `tokensBefore` / `estimatedTokensAfter`，经 `onContextCompacted` → `useThreadTurnEvents` 传入 reducer。
- **F5 渲染**：`TimelineRowRenderer` 新增 `context-event` 分支，渲染为居中弱化分隔行（「已自动压缩上下文 · 236.5k → 41.2k tokens」），reason=manual 显示「已手动压缩上下文」；文案走 i18n（zh/en 同步）。`messageRowEquality` 认识新 kind（按 id+字段浅比较）。
- **F6 测试**（TDD 先行，见 tasks）：reducer 契约、极简折叠锚点契约、`events.rs` 映射 reason 断言、渲染分支；同步修正断言旧 assistant 消息形态的既有测试。

## Capabilities

### Modified Capabilities

- `message-process-phase-collapse`：
  - MODIFIED「Minimal Transcript Mode MUST Fold Completed Turns Into A Single Turn Chip」：最终回答锚点竞选 MUST 排除 `context-event` 留痕；留痕 MUST 保持可见、不折进 chip。
  - ADDED「Context Event Marker MUST NOT Participate In Prose Finality Or Folding」：留痕的 kind 契约（不参与 finality、不参与折叠、默认模式同样渲染为独立系统行）。
- `claude-context-compaction-recovery`：
  - MODIFIED「Claude Compaction Lifecycle Event Mapping」与「Claude Prompt Overflow Compaction UI MUST Remain Explicit And Recoverable」：`Context compacted.` 语义消息升级为 `context-event` 留痕 item（dedupe 语义保留）。

### Added Requirements (pi)

- `pi-rpc-session-runtime`：ADDED「PI compaction 事件 MUST 映射 canonical thread/compaction 方法并携带元数据」——`compaction_end` 映射 MUST 透传 `reason` / `tokensBefore` / `estimatedTokensAfter`，缺失字段置 null，MUST NOT 伪造取值。

## Non-Goals

- 不改 pi auto-compaction 本身的触发语义（引擎内置行为；阈值/开关属用户侧 pi 配置，另见 `docs/analysis` PI gap 报告的运营项）。
- 不改 Codex 的 compaction 消息链（`appendCodexCompactionMessage` / `settleCodexCompactionMessage` 专属形态保留，不迁 `context-event`；其文案已 i18n 且不走 assistant 锚点）。
- 不改 `compaction_start`（进行中）事件的 reason 缺省口径（`"manual"` 缺省在 start 侧是既有幕布渲染契约，风险大于收益）。
- 不动 `markLatestAssistantMessageFinal` 的「最后一条 assistant」启发式本身——留痕改 kind 后不变量自然恢复；若未来再出现新的合成 assistant 消息，再评估显式 finality 目标传递。
- 不做留痕的历史重放恢复（pi 历史重载不补 emit compacted 事件——与现状一致，非本次回归面）。
