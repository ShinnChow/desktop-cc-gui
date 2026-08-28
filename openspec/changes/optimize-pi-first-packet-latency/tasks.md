# optimize-pi-first-packet-latency tasks

> 执行顺序 = 阶段一（D2）→ 阶段二（D1）→ 阶段三（D4）。每阶段：实现 → 自检 → review → 独立提交，通过后进下一阶段。
> 事实源：`docs/analysis/2026-08-28-pi-rpc-first-packet-latency.md`（2026-08-28 校准版）。
> Format Discipline：只格式化本批触达文件；`.rs` 触达文件提交前过 `rustfmt --edition 2021 --check`。

## Phase 1 — D2 静默期反馈补齐

- [x] 1.1 前置核验：`resolveConversationAssemblyMigrationGate("pi")` 状态确认（gate 未启用则 profile 早退分支会覆盖 `heartbeatWaitingHint`，需在 design 假设上落实现）——结论：gate 仅覆盖 claude/gemini，pi 走正常分支，假设成立
- [x] 1.2 `useMessagesRuntimeState.ts`：`waitingForFirstTextLabel` 引擎名单扩入 `"pi"`
- [x] 1.3 `presentationProfile.ts`：`pi` profile 分支返回 `heartbeatWaitingHint: true`（其余字段沿用默认值）
- [x] 1.4 i18n 核验：`messages.waitingForFirstText` / `messages.nonStreamingHint` 在 10 locale 全覆盖，无需新增
- [x] 1.5 单测：`resolvePresentationProfile("pi").heartbeatWaitingHint === true`；既有引擎（opencode/codex/默认）profile 零回归；`waitingForFirstTextLabel` 对 pi 的选取分支（含 `waitingForFirstChunk` false 时回落正常 label）
- [x] 1.6 自检 + review + 提交：相关 vitest 14/14 + tsc 零错误；`Messages.live-behavior` 10 个滚动用例失败经 stash 对照确认为存量问题（与本批无关）；diff 仅含本批 hunk（+92/-4），我的新增行 prettier-clean，存量格式违规未裹挟；macOS 目视待验收，Win/Linux 后续补

## Phase 2 — D1 resident 预热

- [x] 2.1 `pi.rs`：`prewarm_resident`（调 `ensure_resident`，幂等早退；`rpc_disabled_blocks_spawn` 同源检查；session_id 推导与 send 路径同源）——设计收窄：**仅接受带 session id 的恢复会话**（`pi:<id>`）；pending 会话 send scratch 每 turn 唯一，预热无法命中只会白起进程，跳过
- [x] 2.2 `engine/commands.rs`：`engine_prewarm(workspace_id, engine, session_id, provider_profile_id)`——pi 臂真实预热、其余引擎与 remote 模式 no-op `Ok(false)`；session 推导复用 send 路径同款（`resolve_engine_provider_profile_id` + `resolve_pi_provider_launch_profile` + `get_or_create_pi_session_for_runtime`）
- [x] 2.3 `command_registry.rs` 注册 `engine_prewarm`（对齐 `crate::engine::engine_send_message` 形态；daemon 不注册，与 codex prewarm 同为 client-only）+ `appServer.ts` `enginePrewarm` wrapper（失败静默返回 null，双轨契约）
- [x] 2.4 前端触发：`usePiResidentPrewarm` hook 挂载于 `useThreads`——pi 会话激活延迟 1.5s fire-and-forget；per-thread completed/in-flight 双 ref 去重；unmount 取消；失败仅 debug 遥测
- [x] 2.5 （可裁剪）composer focus 触发：**本批不做**——线程激活已覆盖「打开会话→阅读→发送」主窗口；composer focus 与现有 hook 耦合度高，收益边际，留待需要时独立补
- [x] 2.6 单测：`prewarm_resident` 非法 id 拒绝（不到 spawn）+ 闩冷却期拒绝（不搅动闩状态）；「连发 3 次仅 1 resident」依赖 `ensure_resident` 既有早退语义（真实 spawn 计数属集成测试面，不进单测）；hook 5 用例（延迟触发/去重/pending 与非 pi 跳过/unmount 取消/session id 解析）
- [x] 2.7 自检 + review + 提交：`cargo check` 双 target 绿 + pi 模块 82 测试全过 + `rustfmt --check` 三文件 clean；前端 vitest 5/5 + tsc 零错误；`useThreads.engine-source` 1 个失败经 stash 对照确认为存量问题

## Phase 3 — D4 思考档按需降档

- [x] 3.1 前置探明：composer effort 为 `null` 即「用户未触碰档位」（显式选择才落非空值），无需新增 touched 状态；「无 assistant 历史」以「无 pi session id（新会话）」作保守代理——恢复会话一律不降
- [x] 3.2 发送时刻降档判定：`piThinkingDowngrade.ts` 纯函数（engine == pi + effort 为空 + prompt ≤ 24 字符 + 新会话）→ 本 turn 以 `low` 发送；`useThreadMessaging` 发送边界接线，执行目标快照与 wire 参数同值；不写回持久化偏好
- [x] 3.3 单测：降 / 不降（显式 high/medium 保护、长 prompt、恢复会话、非 pi 引擎、空白 effort 归一）6 用例全覆盖
- [x] 3.4 自检 + review + 提交：piThinkingDowngrade 6/6 + effort 相邻套件 20/20 + tsc 零错误；`useThreadMessaging.context-injection` 8 个失败经 stash 对照确认为存量问题

## 收口

- [x] 4.1 `openspec validate optimize-pi-first-packet-latency --strict --no-interactive` 通过（proposal/design/tasks 定稿后复核）
- [ ] 4.2 三平台目视验收记录（macOS 实测；Win/Linux 按窗口安排补记）——**待真机验收后勾选**
- [x] 4.3 ADR 校准回写：命中 engine registry / resident lifecycle 触发器，已回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`「最近校准」2026-08-28 节 + 头部标注（commit `ac604bb68`）
- [x] 4.4 changes/README.md 索引更新（active 72）；verify/sync 待 4.2 真机验收后执行
