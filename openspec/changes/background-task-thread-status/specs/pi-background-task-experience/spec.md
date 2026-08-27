# pi-background-task-experience Delta: background-task-thread-status

## ADDED Requirements

### Requirement: 存在运行中后台任务时会话行 SHALL 显示独立第四态

当某会话存在未终态后台任务（running 计数 > 0）且该会话不在模型生成中（`isProcessing` / `isReviewing` 均为 false）时，sidebar 会话行状态点 MUST 显示 `bg-running` 态（紫色呼吸），MUST NOT 复用蓝色 `processing` 态（语义混淆：模型生成 vs 后台任务等待），MUST NOT 保持 `ready` / `unread` 静态态（丢失「未完成」信号）。状态优先级 MUST 为 reviewing > processing > bg-running > unread > ready。`prefers-reduced-motion` 下 MUST 降级为静态紫点。

#### Scenario: bg_run 后切走会话紫灯亮起

- **WHEN** pi 会话经 `bg_run` 拉起后台任务（receipt 到达，status=running）且 turn 已 settle（`isProcessing=false`）
- **THEN** 该会话行状态点 MUST 渲染 `.thread-status.bg-running`（紫色呼吸）
- **AND** MUST NOT 渲染 `.thread-status.ready` 或 `.thread-status.unread`

#### Scenario: 模型生成中优先蓝灯

- **WHEN** 会话同时处于 `isProcessing=true` 且后台任务 running 计数 > 0
- **THEN** 状态点 MUST 保持 `processing`（蓝呼吸），MUST NOT 切为 `bg-running`

### Requirement: 运行计数 SHALL 以徽标形式上会话行

后台任务 running 计数 MUST 以徽标渲染在会话行状态点旁，且显示条件独立于状态点颜色分流（蓝灯与徽标可并存）。计数 MUST 源自 `backgroundTaskStore` 的 running 过滤语义（status 非 completed / failed / killed，排除 receipt 前占位记录），MUST NOT 引入新的轮询。

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
