# pi-background-task-experience · 设计

## 1. 数据流总览

```text
pi RPC 事件流 ──► pi.rs 事件转换 ──► canonical item: backgroundTask ──► Messages 时间线（A1 活体卡）
                                              │
扩展 followUp 注入 <background-task-notification> ──► agentTaskNotification 解析（A2）
                                              │        ├─► 按 taskId 驱动 A1 原地折叠
                                              │        └─► 触发 followUp turn（pi 原生行为，不拦截）
.pi/tasks/session-<pid>/<taskId>.json ──► 前端 registry watcher（B，P2：复用 read_workspace_file + process_is_alive）──► applyBackgroundTaskUpdate(source:registry) ──► 卡片/pill 状态
```

A1/A2 先行时卡片状态由通知驱动；B（P2）上线后切换为 registry 驱动 + 通知兜底，两者共存不冲突。

**实现校准（2026-08-26 spike + 代码实证）**：通知有两条到达路径。① mid-run：模型收尾 turn 长于任务时，通知走 followUp 队列在**同 run 内**出现（无中间 agent_settled），事件经当前 forwarder 正常到达前端。② post-settle：任务长于收尾 turn 时先 settle，通知触发 pi 自唤醒 turn——pi.rs 建 **orphan run** 承接，其事件 turn_id 为合成 id，被 per-turn forwarder 过滤**天然丢弃**（pi.rs `PiRpcRun::new_orphan` 注释明确此语义）；且 orphan settle 后 run 被 take，缓冲文本也随之消失（收养回放只对 settle 前被收养的 run 生效）。因此 post-settle 路径下通知事件今天根本到不了前端——这不是本 change 引入的缺口，是现状（跟进 turn 的 assistant 文本同样不可见，只能靠历史重载或下次发送时收养回放）。P1 覆盖：mid-run live 折叠 + 历史重载折叠回放 + 收养时随 run 回放；post-settle 的**实时**折叠依赖 session 级通道，与 B（P2 registry watcher 挂在 commands 层、有 AppHandle）天然同路，P2 一并解决。

## 2. 关键设计决策

### D1 通知消费，不单列时间线行

A1 卡是活载体，唤醒通知再渲染一张折叠卡是重复信息（设计稿评审实证）。通知被消费为：驱动折叠 + 写终态摘要。turn 接续由后续 assistant 消息天然承载。这与 Claude 链路不同——Claude 的后台工具卡不是活卡，wakeup fold 是其唯一终态表达，所以 Claude 保留单列行，pi 不保留。

### D2 终态原地折叠

对齐 0.9.0「Auto-fold completed terminal groups：live groups collapse when the last card finishes; history replay starts folded」。活体卡只在运行中展开（elapsed / tail / 心跳），终态换成 `message-agent-task-fold` 行（真实 DOM 复用），chevron 可重展开看 kv 与日志入口。历史重载直接折叠态回放。

### D3 等待态与聚合视图合并为 run-status pill

复用 `composer-run-status`（「子代理 2/2」同款）而非新增状态条 / drawer / 模态框：

- pill：「后台任务 · N 个运行中」，running 带 live dot；turn settle 后持续存在直到全部终态；全部完成后显示「全部 N 个已完成」、live dot 熄灭。
- panel：点击 pill 就地展开（真实 `composer-run-status-panel` 槽位），任务分组列表 + 展开日志。
- 收益：等待态（A3）与任务中心（C）一个构件；零新布局占用；语义与「子代理/已编辑」pill 一致。

pill 数据源：会话级 backgroundTask 状态表（taskId → status/elapsed/lastOutputAt），由 A1/A2/B 三路事件共同维护。

### D4 registry watch 断链兜底（P2）

- 数据源：`<cwd>/.pi/tasks/session-<pid>-<pid>/<taskId>.json` + 同目录输出日志。
- pid 匹配：目录按 pi resident pid 分段，与当前会话绑定的 resident 匹配；匹配不到（会话恢复自另一 pid）时降级为「仅通知驱动」并在卡片上弱化心跳（不显示「最后输出 N 秒前」）。
- 断链判定：metadata 停更阈值 + 进程探测（pid alive）+ 未收到通知 → 「异常终止」。
- 输出日志 tail 按需读取，不整文件推送（延续 tool-output byte budget 原则）。

### D5 Render Perf 红线对照

- elapsed / 心跳 / tail 滚动全部组件本地 state（卡片内 `setInterval` / 事件订阅），禁止进根 hook 链 / 根 store。
- pill 状态更新由任务事件驱动；禁止秒级轮询根链。
- 会话级状态表挂在 messages feature store 层，非 AppShell bag；若确需进 shell 层，必须先登记 `APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS`（AppShell Gate）。

## 3. 实施前 spike 结论（2026-08-26 已验证）

验证方法：/tmp 下起 `pi --mode rpc --session-id spike-bg-task-0001` resident，prompt 驱动模型调一次 `bg_run sleep 3`，全量 dump stdout 事件流 + 会话 jsonl + registry 目录（原始样本当时存于 `/tmp/pi-bg-spike/events.jsonl`）。

1. **customType 透出 ✅ 走事件层**：RPC 事件流中通知以 `message_start` / `message_end` 出现，`message.role === "custom"`、`message.customType === "background-task-notification"`，且 `message.details` 携带**结构化 BgTaskSnapshot 全量**（id / name / command / status / outputPath / cwd / startTime / endTime / exitCode / pid / bytesWritten）。A2 优先事件层解析（details 结构化，免 XML 正则）；`content`（XML 文本）作兜底。另证实 `tool_execution_end` 的 `result.details.task` 同样是结构化 snapshot（status=running、pid、outputPath），A1 receipt 解析优先读 details，文本 receipt 兜底。时序注意：通知到达时若 agent 仍在 streaming（模型收尾 turn 长于任务），走 followUp 队列**同 run 内**出现（无中间 agent_settled）；任务长于收尾 turn 时先 settle、再触发 orphan run（pi.rs 已有 orphan run 承接逻辑）。两种形态都要接。
2. **历史重载形态 ✅ 可重建**：jsonl 持久化为 `custom_message` 条目，`customType` + `content`（XML 原文）+ `details`（结构化 snapshot）全保留，带 id/parentId/timestamp。历史链路可直接用 details 重建折叠态；`pi_history.rs` 目前不识别 `custom_message` 条目类型，需新增映射。
3. **registry 目录语义 ✅ 两段皆 pid**：实测目录 `<cwd>/.pi/tasks/session-<residentPid>-<residentPid>/`——扩展读 `ctx.sessionId` 在 RPC 模式下为 undefined（pi ExtensionContext 只暴露 `sessionManager.getSessionId()`，无顶层 sessionId 字段），永远走 `session-${pid}` fallback，故两段都是 resident pid。codemoss spawn resident 时已知其 pid，可精确匹配 `session-<pid>-<pid>/`；resume / pid 失配时按 taskId glob `.pi/tasks/session-*-*/<taskId>.json` 兜底。metadata `<taskId>.json` 字段与 details snapshot 同构（status / exitCode / endTime / bytesWritten / notified），输出日志 `<taskId>.output` 为纯文本，watcher 设计可直接消费。

## 4. 降级矩阵

| 条件 | 行为 |
| ------ | ------ |
| receipt 解析失败 | 降级为普通工具卡，不阻塞消息流 |
| 扩展未安装 / 标签格式变化 | 通知按普通用户消息渲染（=现状），无回归 |
| registry 目录缺失 / pid 不匹配 | 仅通知驱动，卡片无心跳信号 |
| B 未上线（P1 期间） | 终态由通知驱动；通知丢失则卡片停留运行中（已知局限，P2 消除） |

## 5. 测试策略

- 契约单测：`agentTaskNotification` 解析器双标签 + 边界（空结果 / 双重转义 / 普通 XML 散文不误吞，延续 0.3.12 硬化口径）。
- pi.rs 转换单测：bg 工具名单命中 / receipt 解析 / 降级路径。
- 组件测试：卡片运行→折叠状态机、pill 出现/消失/计数、断链标记。
- 手测：真机 pi 会话跑长命令，走完整链路 + 杀进程断链路。
