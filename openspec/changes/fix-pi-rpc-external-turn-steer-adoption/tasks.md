# Tasks: fix-pi-rpc-external-turn-steer-adoption

## 1. `PiRpcRun` orphan 形态与原生 turn 结算

- [x] `PiRpcRun` 加 `orphan: bool`（`new` 置 false）；新增 `PiRpcRun::new_orphan()`（合成 id `pi-external-{millis}-{seq}`，静态 `AtomicU64` 序列，dropped-rx waiter，`orphan: true`）。
- [x] `settle_rpc_run`：按 `main_turn_id` / `active_turn_id` 区分结算目标，禁止把外部正文复制到 pending 用户 turn。

## 2. pump：agent_start 建 orphan run

- [x] `spawn_rpc_projection` 事件循环：取 run 之前，`event_type == "agent_start" && guard.is_none()` 时建 orphan run 承接事件流；其余事件 run=None 维持丢弃。

## 3. send：判据放宽 + attach 原生 turn 绑定 + busy 重试

- [x] 纯函数：`plan_rpc_send_mode(run_active: bool, streaming: bool) -> RpcSendMode`、`is_rpc_busy_error(&str) -> bool`（匹配 `already processing`）。
- [x] 发送前置检查（`try_send_message_rpc` 首个分支）判据 `run.is_some()` → `run.is_some() || client.is_streaming()`：streaming 时跳过 `align_rpc_session` / `reconcile_rpc_model`（防 mid-turn 切会话 / set_model）。
- [x] steer/prompt 判据同样放宽（op_lock 内重算，`plan_rpc_send_mode`）。
- [x] 抽 `attach_turn_to_rpc_run(resident, turn_id, tx)`：run 缺失补 orphan run；真实 turn ID 入 pending 队列，等待下一个原生 `turn_start` 绑定；不回放或收养外部正文。
- [x] prompt 失败 `is_rpc_busy_error` → log warn + `client.steer` 重投一次 + 走 `attach_turn_to_rpc_run`；其余 prompt 错误维持原样。

## 4. 守卫同步

- [x] `align_rpc_session` 拒绝切会话条件加 `|| client.is_streaming()`。
- [x] `rpc_has_active_run_for` 加 `|| resident.client.is_streaming()`。

## 5. 单测（`cargo test --lib engine::pi`）

- [x] `plan_rpc_send_mode`：run/streaming 四象限（仅两者皆 false → Prompt，其余 Steer）。
- [x] `is_rpc_busy_error`：pi 原文案命中；auth/模型错误不命中。
- [x] orphan run：合成 id 唯一且非空；pending 用户 turn 不改写 orphan 主 ID。
- [x] `commit_rpc_turn`：`message_end` authoritative snapshot 覆盖 delta 前缀，并按原生 turn ID 结算 waiter。

## 6. OpenSpec 与验证

- [x] spec delta：`pi-rpc-session-runtime` MODIFIED「发送语义 MUST 区分 idle prompt 与 streaming steer」（新增 orphan 承接 / 原生 turn 绑定 / busy 转 steer / streaming 禁止切换与对账 scenario）。
- [x] `cargo test --lib engine::pi` 全绿（68/68，62 存量 + 6 新）；`cargo check --no-default-features` 过；`cargo fmt --check` 过。
- [x] `openspec validate fix-pi-rpc-external-turn-steer-adoption` 通过。

## 7. 外部唤醒 turn 实时投影（daemon + 前端，2026-08-30 补录）

- [x] pump 层多原生 turn 边界：`turn_start` / `turn_end` 解析、`active_turn_id` 跟踪、`commit_rpc_turn` 按原生 turn 结算（`message_end` authoritative snapshot 覆盖 delta 前缀）。
- [x] daemon PI forwarder 门控：`pi-external-*` 仅在携带后台通知 / 有待回收后台任务 / 已知唤醒 turn 时放行；事件保留 native turn ID 并全量附加 `turnId`；后台任务 pending 集合（tool ID ↔ task ID 别名）驱动 forwarder 存活至全部回收。
- [x] 前端 realtime ledger 验收测试：主 turn 结算后，`pi-external-*` turn 的 delta/正文必须继续落盘（`useThreadItemEvents.test.ts`「pi external wakeup turns keep the live tail aligned with history」），锁死「实时幕布缺尾部」回归。
- [x] 后台任务卡退出 process-phase 折叠（`messagesViewModel.ts`），完成回执锚定在卡片旁。

## 8. 实测校准（2026-08-30 探针，pi 0.84.4 `--mode rpc`）

> 探针回放「双后台任务 + 两次唤醒」抓取真实 NDJSON（`/tmp/pi-rpc-probe/events.log`），
> 证实 run 内多原生 turn 是常态结构，据此补两条铁律：

- [x] `bind_next_native_turn_id`：非 orphan run 的 follow-up 原生 turn 派生前台 id `{main}:t{n}`（pending steer 真实 id 优先；orphan 仍 `pi-external-*`）；daemon `is_pi_foreground_native_turn` 无条件放行——否则普通多轮工具对话的第二段回复被外部门控丢弃（「实时缺尾、历史完整」的真正根因之一）。
- [x] pump 在 `agent_settled` 发 `Raw{kind:"agent_settled"}` 生命周期标记（`is_pi_agent_settled_marker`）；forwarder break 绑定「标记已到 + 后台任务回收完毕 + `TurnStarted` 复位」，替代「terminal 即断」。
- [x] 通知以 `message_start/message_end role=custom` 到达（非 `custom_message` 事件）——既有 `parse_pi_custom_message_line` 已覆盖，实测无需改动。
- [x] Rust 单测：派生 id 分配 / pending 优先 / orphan 外部 id / 探针 run1 双 turn 逐 turn 结算（`engine::pi` 98/98）；前台 turn 门控 + settled 标记识别（daemon 15/15）。
- [x] 前端集成测试更新为实测序列（primary → `{primary}:t1` → `pi-external-1/2` 四段正文全部实时落盘）。

## 9. 真机复验回归（2026-08-30 06:40–07:15，dev 客户端）

> 复验暴露三个叠加问题，前两个已修复，第三个为本 change 的结构性根因：

- [x] **dev 客户端连到孤儿旧 daemon**（端口 4733 被 8/27 `/tmp/daemon-test-data` 测试残留占用，`daemon_bootstrap` 「端口可达即收编」无身份校验）。已清理孤儿进程；后续补 daemon 身份握手（构建指纹门）防再犯。
- [x] **同会话第二次发送丢尾**：`client.prompt()` 返回与 pump 收到 `agent_start` 是同毫秒竞态。pump 抢先时误建 orphan 承接本 run，随后真实 run 覆盖槽位、`seen_turn_start` 丢失——第二个原生 turn 被折叠回 primary id，被前端已终态账本丢弃。修复：prompt 写入**前**预创建 real run；busy 竞态槽位非空沿用 attach；prompt 被拒时摘下预创建 run 按失败结算。
- [x] **结构性根因：pi forwarder 存在两份拷贝且不同步**。dev 模式引擎跑在 app 进程内（pi resident 的父进程是 cc-gui），事件转发走 `engine/commands.rs` 里的老拷贝——硬过滤 `turn_id != primary` + `is_terminal 即 break`，本 change 对 `daemon_state.rs` 的全部修复在 dev 下**从未执行**（07:15 复验：实时只剩首段、卡片靠 registry 兜底翻态，与此拷贝行为完全吻合）。修复：
  - 四个纯函数（wakeup 门控 / settled 标记 / 前台原生 turn / 后台通知判定）下沉到 `engine/pi.rs` 共享，daemon 与 app 共用同一实现；
  - app 侧 forwarder（`engine/commands.rs`）全量移植 daemon 的门控/后台任务追踪/turnId 注入/逐 turn 路由重置/settled 绑定断开逻辑，并在文件头注明两份拷贝必须同步演进。
- [x] 顺带修复：唤醒 run 自身多原生 turn 时 `pending_external_wakeup` 不得在首个外部 turn 终态复位——改在 `agent_settled` 标记处复位。

## 10. 发版

- [ ] 重启 dev 客户端后复验：同一会话连续两轮「双后台任务」，两轮实时幕布均须与历史一致（含最终报告）。daemon（安装版）路径下一并复验。
