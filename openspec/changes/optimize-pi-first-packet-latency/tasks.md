# optimize-pi-first-packet-latency tasks

> 执行顺序 = 阶段一（D2）→ 阶段二（D1）→ 阶段三（D4）。每阶段：实现 → 自检 → review → 独立提交，通过后进下一阶段。
> 事实源：`docs/analysis/2026-08-28-pi-rpc-first-packet-latency.md`（2026-08-28 校准版）。
> Format Discipline：只格式化本批触达文件；`.rs` 触达文件提交前过 `rustfmt --edition 2021 --check`。

## Phase 1 — D2 静默期反馈补齐

- [ ] 1.1 前置核验：`resolveConversationAssemblyMigrationGate("pi")` 状态确认（gate 未启用则 profile 早退分支会覆盖 `heartbeatWaitingHint`，需在 design 假设上落实现）
- [ ] 1.2 `useMessagesRuntimeState.ts`：`waitingForFirstTextLabel` 引擎名单扩入 `"pi"`
- [ ] 1.3 `presentationProfile.ts`：`pi` profile 分支返回 `heartbeatWaitingHint: true`（其余字段沿用默认值）
- [ ] 1.4 i18n 核验：`messages.waitingForFirstText` / `messages.nonStreamingHint` 在 10 locale 的覆盖现状（zh 已确认存在；缺失 locale 走现有 fallback 行为，不新增 key 结构）
- [ ] 1.5 单测：`resolvePresentationProfile("pi").heartbeatWaitingHint === true`；既有引擎（opencode/codex/默认）profile 零回归；`waitingForFirstTextLabel` 对 pi 的选取分支（含 `waitingForFirstChunk` false 时回落正常 label）
- [ ] 1.6 自检 + review + 提交：相关 vitest 用例 + tsc；目视验收口径记录（macOS 必做，Win/Linux 后续补）

## Phase 2 — D1 resident 预热

- [ ] 2.1 `pi.rs`：`prewarm_resident`（调 `ensure_resident`，幂等早退；`rpc_disabled_blocks_spawn` 同源检查；session_id 推导与 send 路径同源）
- [ ] 2.2 `engine/manager.rs` + `engine/commands.rs`：`engine_prewarm(thread_id)` 分发臂——pi 臂真实预热、其余引擎 no-op `Ok(false)`
- [ ] 2.3 `command_registry.rs` 注册 `engine_prewarm`（⚠ 人工核对注册面）+ `services/tauri` invoke wrapper
- [ ] 2.4 前端触发：pi 会话激活（active thread 变更且 engine == pi）→ 延迟 `setTimeout` fire-and-forget `engine_prewarm`；per-threadId completed/in-flight 双 ref 去重；失败仅 debug 遥测（形态对齐 `useWorkspaces.ts` codex 先例）
- [ ] 2.5 （可裁剪）composer focus 触发补强：与现有 hook 耦合度过高则本批不做，记录决策
- [ ] 2.6 单测：`prewarm_resident` 幂等（连发 3 次仅 1 resident）；`rpc_disabled` 期间拒绝；非 pi 引擎 no-op；前端触发 hook 去重逻辑
- [ ] 2.7 自检 + review + 提交：`cargo check` + `cargo test` pi 模块 + `rustfmt --check` 触达文件；前端相关 vitest + tsc

## Phase 3 — D4 思考档按需降档

- [ ] 3.1 前置探明：pi 思考档的「默认档 vs 用户手动设档」可判定性（composer thinking selector 变更事件 / thread 设置状态）；不可判定则本阶段降级为「仅新会话首条 + 默认档字段直读」，仍守「无法判定不降」
- [ ] 3.2 发送时刻降档判定：engine == pi + 当前档 == 默认档 + prompt ≤ N 字符（初值 24）+ 无 assistant 历史 → 本 turn 以 `low` 发送；不写回持久化偏好
- [ ] 3.3 单测：降 / 不降（手动设档保护、长 prompt、有历史、非 pi 引擎）分支全覆盖
- [ ] 3.4 自检 + review + 提交：触达层自检同上

## 收口

- [ ] 4.1 `openspec validate optimize-pi-first-packet-latency --strict --no-interactive` 通过
- [ ] 4.2 三平台目视验收记录（macOS 实测；Win/Linux 按窗口安排补记）
- [ ] 4.3 ADR 校准回写评估：D1 触及 resident lifecycle（engine registry 调整面），核对 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 更新触发器，命中则回写「最近校准」与「零、当前实现校准」表
- [ ] 4.4 changes/README.md 索引更新 + sync 流程
