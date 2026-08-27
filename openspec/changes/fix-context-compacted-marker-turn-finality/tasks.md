# Tasks: fix-context-compacted-marker-turn-finality

TDD：每个实现 task 前置其失败测试；测试与实现同 task 收口（红灯证据记在 task 内）。

## 1. 后端：`compaction_end` 元数据透传（Rust）

- [x] 红灯：扩展 `events.rs::pi_rpc_compaction_events_map_to_canonical_thread_methods`——`compaction_end`（带 reason/tokensBefore/estimatedTokensAfter 的 payload）映射出的 `thread/compacted` params MUST 含三字段；payload 缺 reason 时 MUST 为 `null`（不伪造 manual）。
- [x] 实现：`events.rs` Pi 臂 `compaction_end` 分支 params 增加 `reason` 透传（缺失→`Value::Null`）。
- [x] `rustfmt --edition 2021 --check src-tauri/src/engine/events.rs`；`cargo test engine::events` 全绿。

## 2. 前端类型 + reducer（TDD 核心）

- [x] 红灯：重写 `useThreadsReducer.context-compaction.test.ts`——(a) `appendContextCompacted` 产物 `kind === "context-event"`、`eventType === "compacted"`、携带 reason/tokensBefore/estimatedTokensAfter/turnId；(b) 同 turnId 重复 dispatch 幂等；(c) 追加留痕后 dispatch `markLatestAssistantMessageFinal`，`isFinal` MUST 落在真实 assistant 消息上、留痕 MUST 无 `isFinal`（旧实现必红）。
- [x] 实现：`types/conversation.ts` 新增 `context-event` 变体；`threadReducerTypes.ts` action 增加可选 `reason`/`tokensBefore`/`estimatedTokensAfter`/`timestampMs`；`useThreadsReducer.ts` `appendContextCompacted` 改产新 kind（id/去重语义不变）。
- [x] 核对 `prepareThreadItems` 对新 kind 不丢不改（若存在 kind 白名单则补 `context-event`）。

## 3. 极简折叠锚点契约（测试钉契约，预期零实现）

- [x] 红灯→绿：`messagesViewModel` 测试新增 scenario——segment `user → tools → assistant(final, isFinal) → context-event 留痕`：锚点 MUST 为 final assistant；留痕 MUST NOT 进 `hiddenItemIds`、MUST 保留在 `timelineItems`（先在旧 kind 下跑红，kind 落地后自然绿；视图模型零改动即契约成立的证明）。
- [x] 核对既有极简/phase 快照断言中 proseCount 受留痕影响处并同步。

## 4. 事件分发透传

- [x] `useAppServerEvents.ts` `thread/compacted` 分支：提取 `reason`/`tokensBefore`/`estimatedTokensAfter`（`parseOptionalString`/有限数字），随 `onContextCompacted` 下发；`ContextCompactionSourcePayload` 扩展可选字段（codex 路径不受影响）。
- [x] `useThreadTurnEvents.ts` `onContextCompacted`：非 codex 分支将新字段传入 `appendContextCompacted` dispatch。
- [x] 若 `useAppServerEvents` 有 pi compaction 映射测试则扩展断言；无则依赖 1/2 层测试。

## 5. 渲染 + i18n

- [x] 红灯：新增 `ContextEventRow` 渲染测试——threshold/overflow 显示「已自动压缩上下文」，manual 显示「已手动压缩上下文」，tokens 齐全时显示 `236.5k → 41.2k tokens` 形态，缺失时省略 token 段。
- [x] 实现：`ContextEventRow.tsx`（居中分隔行，弱化样式）；`TimelineRowRenderer.tsx` 增加 `context-event` 分支；`messageRowEquality.ts` 覆盖新 kind 浅比较。
- [x] i18n：zh/en `threads.contextCompactedAuto` / `threads.contextCompactedManual`（+token 格式复用现有数字格式化工具，勿新造）；核对 `i18nTestMessages.ts` key 集合规。

## 6. 既有断言修正 + 回归

- [x] `useThreadsReducer.compaction.test.ts` / `Composer.context-dual-view.test.tsx`：更新对旧 assistant 消息文本 `"Context compacted."` 的断言到新 kind/文案。
- [x] 全量：`npx tsc --noEmit`；vitest 跑 `useThreadsReducer` / `messagesViewModel` / `TimelineRowRenderer` / `Composer.context-dual-view` 相关文件；`cargo test engine::events`。
- [x] `openspec validate fix-context-compacted-marker-turn-finality --strict` 通过。

## 7. 收口

- [x] 提交拆分：OpenSpec 工件 / Rust 透传 / 前端实现+测试（中文 Conventional Commits）。
- [ ] 人工目视验收（可选，隔离开发者客户端）：pi 大会话触发 auto-compaction，极简开启时真实回答保持展开、留痕为独立分隔行；默认模式留痕不再渲染为 assistant 气泡。
- [x] 命中 ADR 触发器核查：本 change 不动 engine registry / Shared 支持集 / binding / canonical fact schema / context compiler / terminal-ACK / recovery exit——确认免回写基石文档。
