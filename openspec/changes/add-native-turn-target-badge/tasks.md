# Tasks: add-native-turn-target-badge

## 1. 数据层

- [x] 1.1 `src/types/conversation.ts`：提取 `ExecutionTargetSnapshot` 命名类型，`MessageSendOptions` 增加 `nativeExecutionTarget`
- [x] 1.2 新增 `src/features/threads/utils/nativeTurnTargetLedger.ts`（record/get/rename/clear-for-tests + shared-id 守卫 + resolve 兜底合成）
- [x] 1.3 新增 `nativeTurnTargetLedger.test.ts`

## 2. 发送边界

- [x] 2.1 `Composer.tsx` 提交处对非 shared / 非 create-picker 会话冻结 `freezeTurnSnapshot(nativeSessionTarget)` 进 `sendOptions`
- [x] 2.2 `useThreadMessaging.sendMessageToThread` native 分支记账（options 缺失时兜底合成）+ `rememberRuntimeReceipt(send.request)`
- [x] 2.3 pending 别名 rename 点补 `renameNativeTurnTarget`

## 3. 入列咽喉

- [x] 3.1 `applyRealtimeDeltaOperation` agentDelta 分支附带账本快照
- [x] 3.2 `handleItemUpdate` 三处 appendAgentDelta + assistant upsertItem 附带；`onAgentMessageCompleted` 两个 flush dispatch 附带
- [x] 3.3 `tryRouteNormalizedRealtimeEvent` 扩 native 注入（normalized.item）

## 4. Reducer 契约

- [x] 4.1 `appendAgentDelta` action 接受可选快照；建壳落地、existing 缺失补
- [x] 4.2 `flushAgentCompletedBatch` / `completeAgentMessage` → `applyCompleteAgentMessageToState` 同上
- [x] 4.3 reducer 单测覆盖：建壳带快照 / existing 不被覆盖 / 终稿合并保留 / 无壳结算补挂

## 5. Runtime receipt 与展开面板

- [x] 5.1 `maybeCaptureRuntimeReceipt` 门改排除式（修复初版误排 `shared:` 的回归，shared 用例恢复全绿）
- [x] 5.2 tokenUsage 集成测试改断言 native sidecar 捕获为新语义
- [x] 5.3 咽喉 action 增加 `runtimeReceipt` 可选字段并注入 `getRuntimeReceipt()` 记账：pi 等引擎出现 Ⓡ 尾巴与可展开面板
- [x] 5.4 pending → 正式 id 改名点补 `renameRuntimeReceipt` 同迁（修复 pi 首轮实时 Ⓡ 尾巴丢失：7294029c0 的 shared-only 门未随 native 接入放宽，`pi-pending-*` 下记的 send.request 回执改名后查不到，历史冷加载反有；含 claude candidate reconcile 同类缺口）

## 6. 历史 sidecar（真机验收后补）

- [x] 6.1 新增 `turnTargetBadgeStorage.ts`（ring + 尾对齐 merge）与单测
- [x] 6.2 发送边界追加 + reducer `setThreadItems` 补挂接线
- [x] 6.4 历史补挂同步合成 `send.request` 语义回执（修复「历史有 badge 但无 Ⓡ 尾巴/无法展开」）
- [ ] 6.3 手工验收：重开 native 会话历史 badge 保留、Ⓡ 尾巴可展开、同轮不被二次发送改写

## 7. 验证与收口

- [x] 7.1 目标 vitest 套件 + `tsc --noEmit` 通过（详见 verification.md）
- [ ] 7.2 手工验收：PI/Claude/Grok 各发一轮，幕布首条助手回复出现显示条；切模型后下一轮显示新档位；进行中 bubble 不被改写
- [ ] 7.3 verify / sync / archive 流程；如命中基石文档触发器再回写校准行

