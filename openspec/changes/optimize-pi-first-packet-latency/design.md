# optimize-pi-first-packet-latency Design

> 事实源：`docs/analysis/2026-08-28-pi-rpc-first-packet-latency.md`（2026-08-28 第二轮代码校准版）。本文只记设计决策与取舍；实测数据、根因分层见诊断 doc。

## 阶段一（D2）：静默期反馈补齐

### 现状（校准后的代码事实）

- `WorkingIndicator.tsx:105` `WorkingClock`：每秒 tick、ref 直写 `textContent`、无 React 重渲染——秒表底座**现状已具备**，渲染条件 `isThinking && processingStartedAt`。
- `processingStartedAt` 由 `markProcessing` 落（`useThreadsReducer.ts:1033`）；`useThreadItemEvents.ts:1031` `markProcessingIfNeeded` 对所有非终态 realtime 事件触发，`canProgressEventStartProcessing` 仅排除 codex——pi 的 agent_start 后 ~6ms 指示器已点亮。
- `messagesTimelineProjection.ts:255` 无条件插入 `workingIndicator` 行。

### 决策

1. **只补两处小改动**：
   - `useMessagesRuntimeState.ts:405-410`：`waitingForFirstTextLabel` 引擎名单 `codex/qoder/dsh` → 扩入 `pi`。zh 文案 `messages.waitingForFirstText`（"{{engine}} 已启动，正在等待首段文本..."）已存在。
   - `presentationProfile.ts`：为 `pi` 增加 profile 分支返回 `heartbeatWaitingHint: true`（默认分支 false、仅 opencode true 的现状保持）。一处 profile 同时点亮 `WorkingIndicator` 的 12s 安抚提示与 `MessagesCore.tsx:1870` heartbeat pulse。
2. **只走 profile 路线**：不改 `WorkingIndicator.tsx:182` / `MessagesCore.tsx:1871` 两处 inline 引擎 fallback 列表——两处 inline 默认本就不一致（opencode vs opencode/dsh/qoder），不扩大分歧面。
3. **初版方案作废**：「reducer 维护 1s tick + `thinkingMsSinceStart`」比现有 ref 直写更差且蹭 `Render Perf Baseline` 红线③，禁止重新引入。

### 取舍

- 不新增「模型思考中 vs 等待 prefill」的阶段细分：首个 message_update 是 `thinking_start`，thinking_delta 一到 reasoning 行自然接管（现状通路），占位细分无增量价值。
- 前置检查：`resolveConversationAssemblyMigrationGate("pi")` 若存在未启用 gate，profile 会被早退分支覆盖为全 false——实现时需核验 pi 的 migration gate 状态。

## 阶段二（D1）：resident 预热

### 先例与形态

- **codex 先例**：`prewarm_codex_disk_runtime`（`runtime/commands.rs:187`）+ 前端 `useWorkspaces.ts:262`（workspace connected → `setTimeout` 延迟 fire-and-forget、per-workspace completed/in-flight 去重、debug 遥测）。
- **claude 不适用**：per-turn spawn（`claude.rs:1701`），无 resident。
- **决策：command engine-neutral**：`engine_prewarm(thread_id)` 按 engine 分发臂（同 `engine_send_message` 形态）；pi 臂执行真实预热；无 resident 模型的引擎返回 no-op（`Ok(false)`），fire-and-forget 调用方无需关心。不做 `engine_prewarm_pi_resident` 专名 command。

### pi 臂语义

- `pi.rs::prewarm_resident`：直接调 `ensure_resident`（幂等早退已内建），同步等待 spawn + handshake + `refresh_thinking_levels` 完成。session_id 推导与 send 路径同源（复用现有 thread→session 映射），不新造第二套推导。
- 红线（承诊断 doc D1）：
  - `rpc_disabled_blocks_spawn` 检查与 `ensure_resident` 同源——预热不得在闩冷却期外搅动闩自愈。
  - **双轨**：预热失败静默（debug 遥测），首次发送仍走 `ensure_resident`——不新增失败路径。
  - 不给同一 `(session_id, scratch)` 起第二个 resident（`pi_resident_map_key` 行为不变）。
  - 预热是 IPC 触发，不进根 setState 链、不碰 composerDraftStore（`AppShell Structure Gate`）。

### 前端触发

- 触发点：**pi 会话激活**（active thread 变更且 engine 为 pi）。形态复用 codex 先例：延迟 `setTimeout`（避开激活瞬间的高峰）、per-threadId completed/in-flight 双 ref 去重、fire-and-forget + 失败仅 debug log。
- composer focus 触发为可选补强，若与现有 composer hook 耦合度过高则本批不做（线程激活已覆盖「打开会话→阅读→发送」主窗口），在 tasks 中标注可裁剪。
- 切模型不预热：`set_model` 期间旧 resident 不得被杀死/重建（现状 `ensure_resident` 早退已保证，预热不引入新失效逻辑）。

## 阶段三（D4）：思考档按需降档

### 决策

- 降档判定全部在**发送时刻**完成，单 turn 生效，不写回持久化的思考档偏好：
  - 条件（全部满足才降）：engine == pi；composer effort 为空（用户本次未触碰档位选择器——composer 语义：显式选择才有非空 effort，空 = 跟随引擎默认档）；prompt 长度 ≤ 24 字符；该 thread 是新会话（无 pi session id）。
  - 动作：本 turn 以 `low` 档发送（`set_thinking_level` 走 send 前既有 reconcile 路径，无新 IPC 形态；pi 档位 allowlist 不含 low 时 send 侧自动跳过，不阻塞 prompt）。
- **「默认档 vs 用户设档」可判定性（3.1 探明结论）**：composer 侧 effort 为 `null` 即「未触碰」（`resolvedComposerSelection?.effort ?? effort`，显式选择才落非空值），无需新增 touched 标记。
- **「无 assistant 历史」用「无 session id」作保守代理**：只有 `pi-pending-*` → 首条发送窗口才可能命中；恢复会话即使尚无 assistant 消息也不降（宁可不降不可错降）。
- **执行目标快照与 wire 参数同值**：`recordNativeTurnTarget` 与 `engineSendMessageService` 都传降档后的 effort，badge 记录与实际执行保持 honest。

### 取舍

- 不做无历史检测之外的「短历史」档：判定面越小越好，首版只吃新会话首条消息场景（实测 ~11s 静默的典型场景）。
- 不引入设置项：降档不可配置（边界条件已足够保守）；用户反馈需要开关时独立 change。

## 风险与阶段闸门

| 阶段 | 主要风险 | 闸门 |
| --- | --- | --- |
| 一 | 文案切换闪烁 / 双口径计时 | 现有 `waitingForFirstChunk` 派生机制保证；秒表口径不变（`processingStartedAt`）；单测 + 三平台目视 |
| 二 | 预热风暴 / 闩冲突 / 启动期争抢 | per-thread 双 ref 去重 + 延迟触发 + `rpc_disabled` 同源 gate；`prewarm_resident` 幂等单测；`cargo test` pi 模块 |
| 三 | 错降档伤质量 | 「无法判定不降」原则 + 降档分支单测全覆盖（降 / 不降 / 手动设档保护） |

每阶段完成：跑该层自检（前端 vitest 相关用例 + tsc；后端 cargo check/test + `rustfmt --check` 触达文件）→ review diff → 独立提交。
