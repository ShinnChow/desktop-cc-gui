# Design: fix-pi-rpc-external-turn-steer-adoption

## 决策

**1. orphan run 的形态：合成 turn id + dropped-rx waiter + `orphan` 标记。**

pi 自唤醒 turn（bg 任务完成通知注入）不经过 ccgui 发送路径，没有真实 turn_id 与 waiter。为它建 `PiRpcRun` 时：

- main turn id 合成：`pi-external-{millis}-{seq}`（静态 `AtomicU64` 序列 + 毫秒时间戳，单调唯一，可日志辨认）；
- waiter 的 rx 直接 drop——`settle_rpc_run` 向它 send 失败静默跳过；
- `orphan: bool` 标记其来源，不靠 id 前缀猜。

daemon forwarder 对 PI 做专属门控：只有带后台任务通知或仍在 pending 集合中的 `pi-external-*` turn 才可进入当前会话，并保留其 native turn ID；陌生外部 turn 仍丢弃，避免跨会话污染。

**2. 原生 turn 边界：attach 只排队，不跨 turn 收养。**

PI 的一个 RPC agent run 可能包含多个原生 turn。外部唤醒 turn 使用合成 ID；用户在其间 steer 时，真实 turn ID 进入 pending 队列，等下一个 `turn_start` 再绑定。这样可以保证：

- 外部 turn 的已流出正文只属于合成 turn，不会复制到用户 turn；
- 新 turn 从自己的 `turn_start` 开始，delta、`message_end` snapshot、`turn_end` 和 waiter 使用同一个 ID；
- 每个 turn 独立清空文本/路由状态，避免第二轮锚到第一轮。

**3. 发送判据放宽到 `is_streaming`：为什么 `run.is_some()` 不够。**

`is_streaming` 由 pi_rpc reader 任务在解析 stdout 行时直接维护（`agent_start` 置 true / `agent_settled` 与 EOF 置 false），**不走 broadcast channel，不受 pump lag 影响**，是「pi 是否在处理」的权威近端信号。发送判据、发送前置检查（align/reconcile 跳过）、`align_rpc_session` 拒绝条件、`rpc_has_active_run_for` 统一放宽为 `run.is_some() || client.is_streaming()`，四处共用一个语义：streaming 即活跃。

判据抽纯函数 `plan_rpc_send_mode(run_active, streaming)` 便于单测。

**4. busy 兜底重试用 `steer` 而非 `streamingBehavior: "followUp"`。**

pi 的 `prompt` 支持 `streamingBehavior: "followUp"` 排队为下一 turn，但排队 turn 的 `agent_start` 到来时本地没有与之对应的 run/waiter 注册机制，本次发送的 rx 无法结算（要等 10min 看门狗）。`steer` 融合进当前 turn，waiter attach 到（orphan 或既有）run 随其结算，与既有 same-run 语义完全一致，且被 pi 拒绝的 `prompt` 在 preflight 阶段失败、消息未入队，重投无重复。

匹配串取 pi 错误文案的稳定子串 `already processing`（纯函数 `is_rpc_busy_error`）；非 busy 错误（auth、模型缺失等）维持原样报错，绝不重试。

**5. 残余反向竞态（判 steer 时 pi 恰好转空闲）不新增处理。**

该窗口在既有 `run.is_some()` 判据下同样存在（agent_settled 与判定之间的 lag），本次放宽不实质扩大。pi 空闲时 `steer` 仅入队不报错，本地 run 由看门狗既有分支「!streaming + run 有产出 → 按完成结算」兜底，用户 turn 正常完成而非挂死。pi 侧滞留的队列消息语义与交互模式一致，属可接受残留。

**6. 实测校准（2026-08-30，pi 0.84.4 `--mode rpc` 探针）：run 内多原生 turn 是常态，前台 follow-up 必须与外部 turn 分流。**

探针回放「两个后台任务 + 两次唤醒」场景，真实事件流为：

```
agent_start → turn_start → assistant#1(text+bg工具) → turn_end
→ turn_start → assistant#2 → turn_end → agent_end → agent_settled
→ [唤醒] agent_start → turn_start → message_start/end(role=custom, 通知)
→ assistant#3 → turn_end → agent_end → agent_settled → [唤醒] …
```

三个关键事实：

- **每个工具往返都是一个新原生 turn**——普通多轮工具对话（读文件→总结）同样是 run 内多 turn 结构，不是后台任务特有；
- 唤醒是**全新 agent run**（`pi.sendMessage({deliverAs:'followUp', triggerTurn:true})` 在空闲时走 `_runAgentPrompt`），通知以 `message_start/message_end role=custom` 出现（既有 `parse_pi_custom_message_line` 已覆盖）；
- run 内**没有 steering 时 `turn_start` 不会携带任何真实 turn id**——本地必须自行分配。

由此产生的两条铁律：

- **前台 follow-up turn 用派生 id `{primary}:t{n}`**，daemon 无条件放行。若一律用 `pi-external-*` 合成 id 再靠「有后台任务 pending」放行，普通对话的第二段回复会被外部门控静默丢弃——实时幕布缺尾、历史重载才完整（正是用户实证的失配症状）。
- **forwarder 的断开必须等 `agent_settled` 生命周期标记**（pump 在 `agent_settled` 时发 `Raw{kind:"agent_settled"}`，`TurnStarted` 到达时复位）。第一个原生 turn 的 `TurnCompleted` 之后 run 内通常还有后续 turn，按 terminal 即断会丢尾；而后台唤醒的下一个 run 会复位标记，不会提前断开。

派生 id 由 `bind_next_native_turn_id` 统一分配：pending 队列的真实 steer id 优先 → orphan run 用 `pi-external-*` → 前台 run 用 `{main}:t{n}`。daemon 侧 `is_pi_foreground_native_turn`（primary 本体 + `{primary}:` 前缀）与 `is_pi_agent_settled_marker` 均为纯函数并有单测。

## 备选方案（否决）

- **daemon/前端改动：纯外部 turn 实时直播上屏**。否决。需要 daemon forwarder 订阅合成 turn id 并映射到会话活跃 thread，跨层 contract 变更 + 前端气泡归属设计，scope 爆炸；外部 turn 结果历史刷新后可见，无信息丢失，等真实需求再做。（2026-08-30 实测校准后部分反转：后台唤醒对应的 `pi-external-*` turn 已按门控实时投影，见决策 6；陌生外部 turn 仍丢弃。）
- **`streamingBehavior: "followUp"` 重试**。否决。见决策 4——排队 turn 无 waiter 对应机制，本 send 无法结算。
- **busy 错误后排队等待 `agent_settled` 再重发 prompt**。否决。引入挂起状态机（取消/超时/中断都要管），而 steer 语义对用户「插话」场景本来就是正确产品行为。
- **把 orphan 正文收养到首个用户 turn**。否决。会把外部通知正文与用户 turn 混在一起，实时和历史的 turn 锚点必然漂移。
- **run 内 follow-up turn 一律用 `pi-external-*` 合成 id**。否决（2026-08-30 实测后否决）。普通多轮对话没有后台任务 pending，外部门控会丢弃第二段回复；前台 follow-up 必须用 `{primary}:t{n}` 派生 id 与外部 turn 分流，见决策 6。

## 风险

- **外部正文串线**：若 pending turn 复用 orphan 的正文，实时和历史会出现重复或错位；当前按 native turn 边界清空并以 `message_end` snapshot 为权威文本。
- **外部事件污染**：PI forwarder 只放行与后台任务状态相关的外部 turn 与本 run 的前台派生 turn，陌生 `pi-external-*` 仍被丢弃。
- **`is_streaming` stale-true**：仅在 reader 停止维护时发生（进程退出路径 EOF 已置 false），无新增风险。
- **forwarder 生命周期依赖 settled 标记**：pi 进程崩溃不发 `agent_settled` 时 forwarder 存活至 broadcast 关闭（EOF 路径 sender drop 会解除 recv），最坏残留一个空闲 task，无 UI 影响。
