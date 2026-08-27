# Change: add-native-turn-target-badge

## Why

Shared Session 幕布上每轮助手回复顶部已渲染 turn-target 显示条
（`PI CLI · 本地配置 · kimi-coding/k3 · low → Ⓡ kimi-coding/k3 ?`，引擎 · 供应商 · 请求模型 · 思考档位 + runtime model 回执尾巴）。
该能力的数据层完全通用：

- `resolveTurnBadge` / `buildTurnTargetBadgeVisibleItemIds`（`src/utils/turnBadge.ts`）与 session 类型无关；
- `MessageRow` 只要 `item.executionTargetSnapshot` 存在就渲染 badge；
- `ConversationItem.executionTargetSnapshot` 字段与 reducer 合并语义（existing-first 固化）均已就位。

但 Native CLI 会话从不填充这两类数据：

1. `executionTargetSnapshot` 只在 Shared V2 send 边界固化；native 发送路径
   （`useThreadMessaging.sendMessageToThread` → `engineSendMessageService`）没有任何快照记录，
   三条 realtime 入列咽喉（首 delta 建壳 / `handleItemUpdate` / normalized 直达路由）也无从标注。
2. runtime receipt 采集在 `useAppServerEvents.maybeCaptureRuntimeReceipt`
   被硬编码为 `threadId.startsWith("shared:")` 才放行，native 连 `Ⓡ` 回执尾巴也没有。

Composer 已经能合成 native 会话的完整 `ExecutionTarget`（`nativeSessionTarget`，驱动 Atomic picker），
本次全部复用既有语义做前端接线：**后端零改动、无新概念**。

## What Changes

- **F1 Send 边界冻结**：`MessageSendOptions` 新增 `nativeExecutionTarget?: TurnExecutionSnapshot`
  （对齐既有 `sharedExecutionTarget` 冻结模式）；Composer 提交时对非 shared / 非 create-picker
  会话用现成 `freezeTurnSnapshot(nativeSessionTarget)` 固化进 options。
- **F2 Per-thread 账本**：新增 `src/features/threads/utils/nativeTurnTargetLedger.ts`
  （workspace+thread 键的模块 Map，仿同目录 `runtimeModelReceipt.ts` 惯例）。
  `sendMessageToThread` native 分支在 `engineSendMessageService` 前记账
  （options 缺失时按 resolved engine/provider/model/effort 兜底合成），
  并同步 `rememberRuntimeReceipt(modelSource:"send.request")`（与 Shared V1 路径同款）。
- **F3 入列咽喉盖快照**：
  - 首 delta 建壳：`applyRealtimeDeltaOperation` 的 `agentDelta` 分支 dispatch 附带账本快照；
  - `handleItemUpdate`：三处 `appendAgentDelta` tail-drain / snapshot dispatch 与转换后的
    assistant message `upsertItem` 同样附带；
  - normalized 直达路由（codex-native）：`tryRouteNormalizedRealtimeEvent` 扩展为非 shared 线程
    也查账本并注入 assistant item（normalized.item + rawItem 双侧）。
- **F4 Reducer 契约**：`appendAgentDelta` / `flushAgentCompletedBatch` /
  `completeAgentMessage` action 接受可选 `executionTargetSnapshot`
  （沿用 `addAssistantMessage` 先例），仅在建壳或 existing 缺失时落地；
  `applyCompleteAgentMessageToState` 的 `...nextBase` spread 已天然保留既有值。
- **F5 Runtime receipt 放宽**：`maybeCaptureRuntimeReceipt` 的 shared-only 门改为排除式
  （排除 `shared:` / `agent-canvas:` / `-pending-shared-`），native 吃到
  `turn/completed` / init / model sidecar 回写后 `patchAssistantRuntimeReceipt`
  反 patch 最新助手消息（其 anti-mislabel 守卫要求 item 已带 snapshot —— F3 正好满足）。
- **F6 Alias 迁移**：pending → 正式 threadId rename 处（现有 `renameRuntimeReceipt` 调用点旁）
  增加 `renameNativeTurnTarget`。
- **F7 Ⓡ 回执注入（真机验收后补）**：pi 等 native 引擎事件流不带 model，
  采集门放宽不够；三条入列咽喉随快照一并注入 `getRuntimeReceipt()` 记账
  （`appendAgentDelta` / 终稿 action 增加 `runtimeReceipt` 可选字段，沿用同一
  「缺失才落地」不变式），native 显示条因此出现可点击展开的回执面板。
- **F8 历史 sidecar（真机验收后补）**：新增 `turnTargetBadgeStorage.ts`
  （threads store per-thread ring）；发送边界追加，历史冷加载在
  `setThreadItems` 经 `mergeTurnTargetBadgesIntoItems` 按 user 轮次从尾部
  对齐补挂（镜像 `turnFinalMeta` 模式）。修复「重开会话历史 badge 全丢」。

## Capabilities

### Affected Specs

- **ADDED** `specs/native-turn-badge/spec.md`

## Impact

- 纯前端接线；不改 Rust、不改 AppShell domain bag、不加任何 IPC / catalog fetch。
- 渲染性能红线核对：每个首 delta 仅一次 Map.get；无根链 setState 变化；流式正文仍走
  `liveAssistantTextChannel`。
- 历史（重启 / 重载后）native 消息不带 badge——shared 的历史 badge 由 canonical facts 承担，
  native 无此持久层，属预期降级；流式结束后的 in-memory 会话内保留。
