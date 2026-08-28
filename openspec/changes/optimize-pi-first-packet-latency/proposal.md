# optimize-pi-first-packet-latency

## Why

pi 作为 Native engine 时「对话首包」显著慢于终端直跑与其它引擎：客户端 error-log 中 pi turn 的 `firstDeltaAtMs` p50 = 34.8s、6/10 样本超 30s、max 148s。诊断（`docs/analysis/2026-08-28-pi-rpc-first-packet-latency.md`，含 2026-08-28 第二轮代码校准）确认时间线由三段构成：

1. **上游静默（80%+，范围外）**：kimi-coding k3 每 turn 冷 prefill（实测 `input: 181,294 tokens, cacheRead: 0`），静默 3.5~50.8s。已裁定不做三方 / upstream 事项，本 change 不触及。
2. **客户端固定开销 ~2.5-2.8s**：`ensure_resident` 懒加载——spawn pi + handshake + `refresh_thinking_levels` 全部发生在用户按下回车之后，计入首包。
3. **静默期反馈缺口（体感）**：agent_start 后 20-50s 零事件窗口内，`WorkingIndicator` 的秒表虽已点亮（校准结论：`WorkingClock` ref 直写现状已具备），但 pi 只有泛化「响应中...」文案，且无 12s 安抚提示——用户无法区分「引擎没起来」与「模型在 prefill」。

## What Changes

按三阶段实施，每阶段独立可验收、独立提交：

- **阶段一（D2）静默期反馈补齐**：`waitingForFirstTextLabel` 引擎名单扩入 `pi`（静默期主文案变「pi 已启动，正在等待首段文本...」）；`resolvePresentationProfile` 为 `pi` 返回 `heartbeatWaitingHint: true`（12s 无首包后显示安抚提示 + heartbeat pulse）。不新建组件 / timer / 通道，秒表底座复用现状。
- **阶段二（D1）resident 预热**：新增 engine-neutral `engine_prewarm(thread_id)` command（按 engine 分发臂；pi 臂同步等待 `ensure_resident` 完成，其余引擎 no-op）；前端在 pi 会话激活时延迟 fire-and-forget 触发，per-thread 去重，复用 `rpc_disabled` 闩与既有失败路径。形态对齐 codex 先例 `prewarm_codex_disk_runtime`。
- **阶段三（D4）思考档按需降档**：pi 发送路径上，仅当「思考档为引擎默认档（用户未手动改过）+ 本次 prompt 极短 + 无 / 短历史」时，本 turn 降档到 `low`，缩短琐碎消息 ~11s 的思考静默；用户显式设档永不覆盖。

## Capabilities

### New Capabilities

- `pi-first-packet-feedback`: pi 静默窗口（agent_start → 首个 message_update）内的可见反馈契约——等待首段文本专属文案、12s 安抚提示、秒表复用（不新增渲染链 timer）。
- `pi-thinking-auto-downgrade`: pi 发送路径的思考档按需降档契约——默认档 + 短消息 + 短历史才降，用户显式设档永不覆盖，降档仅作用于单 turn。

### Modified Capabilities

- `pi-rpc-session-runtime`: 新增 resident 预热 requirement——`engine_prewarm` 通用 command、幂等（连发多次仅一个 resident）、`rpc_disabled_blocks_spawn` 同源 gate、首次发送仍走 `ensure_resident`（预热失败不新增失败路径）。

## Impact

- Affected code:
  - 阶段一：`src/features/messages/orchestration/hooks/useMessagesRuntimeState.ts`、`src/conversation-presentation/presentationProfile.ts`、相关单测。
  - 阶段二：`src-tauri/src/engine/{manager.rs,commands.rs,pi.rs}`、`src-tauri/src/command_registry.rs`、`src/services/tauri/**`、pi 会话激活触发 hook。
  - 阶段三：pi 发送链路的思考档决策点（前端 composer 发送参数 or `pi.rs` send 路径，随设计定稿）。
- APIs: 新增 Tauri command `engine_prewarm`（阶段二）。
- Compatibility: 全部为 additive 变更；非 pi 引擎行为零变化（阶段二 command 对其余引擎 no-op；阶段三仅 pi 发送臂生效）。

## 目标与边界

- 目标：清零客户端可及的首包债务（-2.5s 冷发送）与静默期体感缺口；预期口径是「客户端可省的 2.5-3s + 可解释反馈」，不是首包总数降到秒级（p50 主因在 upstream，范围外）。
- 边界：
  - 预热是 fire-and-forget 优化，**首次发送仍必须走 `ensure_resident`**——双轨保证预热失败不产生新失败路径。
  - 预热不得破坏 `session.switch` 的 capability 限制（`Session Switch Catalog Fetch Gate`：切换独立配置禁止 switch L1；点击路径禁止 catalog 拉取）。
  - 阶段一禁止新增 reducer 秒级 timer / `thinkingMsSinceStart` 类字段（`Render Perf Baseline` 红线③；现有 `WorkingClock` ref 直写是正确范式）。

## 非目标

- 不做 kimi context cache 调研与一切 upstream 事项（用户裁定 2026-08-28）。
- 不做思考档「短消息路径」的 pi upstream 联动（A3）。
- 不改 `rpc_disabled` 闩语义、不引入 resident 的 idle 驱逐策略变更（现有生命周期管理保持；驱逐调优若预热后有必要，独立 change）。
- 不把 `pendingVisibleTextSinceDeltaAtMs` 诊断字段暴露进 UI 文案（保持 error-log 落盘）。
