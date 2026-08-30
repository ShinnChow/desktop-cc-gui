# pi-background-task-experience Specification

## Purpose
TBD - created by archiving change pi-background-task-experience. Update Purpose after archive.
## Requirements
### Requirement: 后台任务工具调用 SHALL 产出 backgroundTask canonical item

pi engine 事件转换 MUST 识别后台任务工具调用（`bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*`），从 tool result receipt 提取 `taskId` / `name` / `outputPath`，产出 canonical `backgroundTask` item；receipt 解析失败时 MUST 降级为普通工具卡，不得阻塞消息流。

#### Scenario: bg_run receipt 正常解析

- **WHEN** pi 会话中模型调用 `bg_run` 且 tool result 为合法 receipt JSON
- **THEN** 时间线 MUST 出现对应 `backgroundTask` item，携带 taskId 与任务名

#### Scenario: receipt 解析失败降级

- **WHEN** 工具结果不是合法 receipt（扩展版本变化或格式不符）
- **THEN** 该调用 MUST 按普通工具卡渲染，消息流不得中断

### Requirement: 任务卡运行中 SHALL 是活体，终态 SHALL 原地折叠

`backgroundTask` 卡片在未终态时 MUST 展示运行中状态（elapsed 计时、输出 tail 预览、心跳文案，信号可得时）；到达终态时 MUST 原地折叠为 fold 行（状态 pill + 名称 + 耗时/退出码），用户可重新展开查看明细。历史重载时 MUST 直接以折叠态回放。

#### Scenario: 完成自动折叠

- **WHEN** 后台任务到达完成终态
- **THEN** 活体卡 MUST 原地替换为折叠行，显示耗时与 exit code，不再保持展开面积

#### Scenario: 历史回放折叠态

- **WHEN** 重新打开包含已终态后台任务的 pi 会话
- **THEN** 任务卡 MUST 以折叠态出现，不经历展开动画

### Requirement: 唤醒通知 SHALL 被消费，不得渲染为裸用户消息

`<background-task-notification>` 通知 MUST 被 `agentTaskNotification` 解析器识别并消费：按 taskId 驱动对应任务卡原地折叠、写入终态摘要；该通知 MUST NOT 渲染为用户 bubble，MUST NOT 作为 turn 边界的用户提问，MUST NOT 单列时间线行。解析器边界 MUST 保持硬化（空结果 / 双重转义 / 普通 XML 散文不误吞）。

#### Scenario: 通知驱动折叠并接续

- **WHEN** 扩展注入 `<background-task-notification>`（status: completed）触发 followUp turn
- **THEN** 对应任务卡 MUST 原地折叠，时间线上不得出现该通知的用户气泡，后续 assistant 消息正常接续

#### Scenario: 普通 XML 散文不误吞

- **WHEN** 用户或模型正文出现形似 `<background-task-notification>` 的普通文本（转义 / 残缺 / 散文引用）
- **THEN** 解析器 MUST NOT 误判为通知

### Requirement: 存在未终态后台任务时 composer 工具条 SHALL 显示后台任务 pill

composer run-status 工具条 MUST 在本会话存在后台任务时显示「后台任务」pill：有运行中任务时带 live dot 并显示运行中计数；turn settle 后 pill MUST 持续存在直到任务全部终态；点击 pill MUST 就地展开 panel，列出任务分组（运行中/已完成/失败）与日志入口。无后台任务时 MUST NOT 占位。

#### Scenario: settle 后 pill 常驻

- **WHEN** turn 因 `agent_settled` 结束且存在未终态后台任务
- **THEN** pill MUST 保持显示「N 个运行中」，会话不得呈现无活动的空闲假象

#### Scenario: 全部终态后归于平静

- **WHEN** 所有后台任务到达终态
- **THEN** pill MUST 停止脉冲并显示完成计数；按既有 strip 可见性规则决定是否保留

### Requirement: 通知丢失 SHALL 被 registry watch 兜底标记（P2）

当 registry watch 可用时，系统 MUST 监听 `.pi/tasks/session-<pid>/` metadata 与宿主进程存活；metadata 停更且进程退出且未收到完成通知时，对应任务 MUST 标记为「异常终止」，不得长期停留「运行中」。pid 目录与当前 resident 不匹配时 MUST 降级为仅通知驱动。

#### Scenario: 杀进程无通知

- **WHEN** 后台任务进程被外部终止且扩展未发出完成通知
- **THEN** 任务卡 MUST 标记「异常终止（未收到完成通知）」，pill 计数相应收敛

#### Scenario: registry 不可匹配降级

- **WHEN** 会话绑定的 resident pid 与 registry 目录不匹配（如 resume 旧会话）
- **THEN** 卡片 MUST 回退为仅通知驱动，不得显示假心跳

### Requirement: 性能红线 SHALL 守住

任务卡与 pill 的状态刷新 MUST 为事件驱动或组件本地 state；MUST NOT 将高频 setState（elapsed tick / tail 追加）接入根 hook 链或根 store；MUST NOT 引入秒级轮询。

#### Scenario: 长任务运行期间根渲染不受累

- **WHEN** 后台任务运行且 elapsed 每秒跳动、tail 持续追加
- **THEN** AppShell 根渲染路径 MUST NOT 因此出现每事件级 setState

### Requirement: 存在运行中后台任务时会话行 SHALL 显示独立第四态（右侧 meta 区）

当某会话存在未终态后台任务（running 计数 > 0）且该会话不在模型生成中（`isProcessing` / `isReviewing` 均为 false）时，sidebar 会话行**右侧 meta 区**运行状态点（`thread-runtime-dot`）MUST 显示 `bg-running` 态（紫色呼吸），MUST NOT 复用蓝色 `processing` 态（语义混淆：模型生成 vs 后台任务等待），MUST NOT 丢失「未完成」信号。左侧 `thread-status` 点 MUST 保持原有四态分流（reviewing / processing / unread / ready）不变，MUST NOT 新增 `bg-running` 态。右侧运行状态点优先级 MUST 为 reviewing > processing > bg-running > completed(unread)。`prefers-reduced-motion` 下 MUST 降级为静态紫点。

#### Scenario: bg_run 后切走会话右侧紫灯亮起

- **WHEN** pi 会话经 `bg_run` 拉起后台任务（receipt 到达，status=running）且 turn 已 settle（`isProcessing=false`）
- **THEN** 该会话行右侧 MUST 渲染 `.thread-runtime-dot--bg-running`（紫色呼吸）
- **AND** 左侧 `.thread-status` MUST 按原四态分流（此时为 `ready`），MUST NOT 渲染 `bg-running`

#### Scenario: 模型生成中优先蓝灯

- **WHEN** 会话同时处于 `isProcessing=true` 且后台任务 running 计数 > 0
- **THEN** 右侧运行状态点 MUST 保持 `processing`（蓝呼吸），MUST NOT 切为 `bg-running`
- **AND** 计数徽标 MUST 仍然渲染（蓝灯+徽标并存）

### Requirement: 运行计数 SHALL 以徽标形式上会话行右侧

后台任务 running 计数 MUST 以徽标渲染在会话行右侧 meta 区（紧贴运行状态点），且显示条件独立于运行状态点颜色分流（蓝灯与徽标可并存）。计数 MUST 源自 `backgroundTaskStore` 的 running 过滤语义（status 非 completed / failed / killed，排除 receipt 前占位记录），MUST NOT 引入新的轮询。

#### Scenario: 多任务计数可见

- **WHEN** 会话有 2 个 running 后台任务
- **THEN** 会话行 MUST 显示计数为 2 的徽标

#### Scenario: 占位记录不计入

- **WHEN** 仅收到 item/started（receipt 未到，记录为 `tool:` 占位）
- **THEN** running 计数 MUST 为 0，紫灯与徽标均不出现

### Requirement: 全部后台任务转终态 SHALL 收口为未读信号

某会话 running 计数从 > 0 跨到 0 时：若该会话非当前活跃线程，MUST 同步置 `hasUnread = true`（未读点提示结果可回看）；若为当前活跃线程，MUST NOT 置未读。终态判定涵盖 completed / failed / killed（失败同样需要用户回看）。重复 dispatch 同值 MUST 无副作用（不二次触发未读）。

#### Scenario: 非活跃会话全部完成出未读点

- **WHEN** 用户在会话 B 时，会话 A 的最后一个后台任务转 completed
- **THEN** 会话 A 紫灯熄灭，且行上 MUST 出现 unread 未读点

#### Scenario: 活跃会话完成只熄灯

- **WHEN** 当前打开的会话内最后一个后台任务转终态
- **THEN** 紫灯熄灭且 MUST NOT 标记 unread

### Requirement: 会话雷达活跃度 SHALL 并入后台任务运行态

会话雷达的 `threadIsProcessing` 判定 MUST 在 `isProcessing` 之外并入「后台任务 running 计数 > 0」，使仅后台任务在跑的会话被计为活跃。

#### Scenario: 仅后台任务在跑的会话计为活跃

- **WHEN** 会话 `isProcessing=false` 但 `backgroundTaskRunningCount=1`
- **THEN** 该会话在雷达 compose 输出中的 `threadIsProcessing` MUST 为 true

### Requirement: 状态同步 SHALL 事件驱动且引用稳定

后台任务计数向 `threadStatusById` 的同步 MUST 经由对 `backgroundTaskStore` 的订阅（单订阅 diff，仅变化线程 dispatch），MUST NOT 轮询、MUST NOT 逐调用点侵入 loader / watcher。reducer 在计数与派生 `hasUnread` 均无变化时 MUST 返回原 state 引用；sidebar 投影（`useSidebarThreadStatusProjection` / `threadRowStatusStore`）MUST 把第四位纳入引用稳定化比较，MUST NOT 因无关字段变化击穿行级 memo。

#### Scenario: 无关线程更新不触发多余 dispatch

- **WHEN** 会话 B 的后台任务状态变化，会话 A 无任务
- **THEN** sync MUST 只对会话 B dispatch，会话 A 的投影引用 MUST 保持不变

#### Scenario: 计数不变不换引用

- **WHEN** store 版本号变化但某会话 running 计数不变
- **THEN** 该会话 `threadStatusById` 条目引用 MUST 保持稳定

