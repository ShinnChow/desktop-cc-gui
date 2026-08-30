# Delta: client-storage-performance

## ADDED Requirements

### Requirement: Snapshot 类派生 key 写入 MUST 内容签名跳过

由 renderer 内存态整体派生的 client store key（当前为 `threads.sidebarSnapshot`）SHALL 在持久化前做内容签名比对：序列化内容与上次成功写入（含磁盘现值初始化）一致时 MUST 跳过 `client_store_write` / `client_store_patch`，且 MUST NOT 为比对目的重复执行全量深度 normalize。签名计算 MUST 排除时间戳类噪声字段（如 `updatedAt`）。

#### Scenario: 无关 dispatch 触发的全量快照 effect 零成本返回

- **WHEN** `useThreads` 的 `threadsByWorkspace` 因无关状态变化被换成新引用，但其序列化内容与上次保存一致
- **THEN** `saveSidebarSnapshotAllThreads` MUST 在进入快照 normalize 前整体早退
- **AND** `writeClientStoreValue` MUST NOT 被调用

#### Scenario: 内容变化时正常持久化

- **WHEN** 任一 workspace 的线程列表内容实际变化（增删改行）
- **THEN** 快照按既有语义写入 `threads.sidebarSnapshot`
- **AND** 下一次同内容调用被签名跳过

### Requirement: client store key 体积预算与存量治理

大体积派生 key SHALL 受写入路径的体积治理约束，防止无界增长放大同步 stringify 与磁盘写：

- `composer.sharedQueuedFollowUps.v1`：单条排队消息持久化的图片 base64 合计 SHALL 不超过 512KB，超限图片在持久化前剥离并记录诊断；写入时 SHALL prune 已失效队列（workspace 或 thread 不存在）；该 key MUST NOT 以 immediate 通道写入。
- `app.detachedSpecHubSession`：持久化载荷 SHALL 仅含指针字段（workspaceId / workspaceName / artifactType / changeId / specSourcePath / updatedAt），MUST NOT 持久化 `files` / `directories` 等可由磁盘重扫的派生树；恢复时按 changeId 重扫，读取侧 MUST 容忍旧格式存量并自然收敛。
- `threads.turnFinalMeta`：线程数上限 SHALL 收敛为 200（最旧线程先剪），单线程条目上限维持 200。

#### Scenario: 超限图片排队消息重载后瘦身

- **WHEN** 用户在排队消息中附带合计 base64 体积超过 512KB 的图片且该队列被持久化
- **THEN** 落盘的队列不含超限图片，本轮发送不受影响
- **AND** 诊断记录剥离事件（hash 级指纹，不含图片内容）

#### Scenario: 失效队列不再驻留

- **WHEN** 某队列所属的 workspace 或 thread 已不存在，且 envelope 发生任意写入
- **THEN** 该队列 key 从 envelope 中移除

#### Scenario: spec hub 会话恢复不依赖持久化树

- **WHEN** detached spec-hub 窗口按持久化指针恢复会话
- **THEN** 文件树由 change 目录重扫重建
- **AND** 旧格式存量（含 files/directories）读取不报错且在下次写入时收敛为指针形状

## MODIFIED Requirements

### Requirement: 高频写入源节流

`liveAssistantShadowTranscript` 的流式 delta SHALL 在内存聚合并按不低于 1s 的间隔 flush 到 client store；settle SHALL 立即 flush。新增 `threadSessionLog` 条目的 payload 序列化体积 SHALL 有上限，超限时截断。

immediate（绕过 debounce 的同步落盘）写入通道 SHALL 仅用于用户显式动作的直接回响；后台派生数据的持久化（sessionRadar 的 recentCompleted / readState / dismissed、sharedQueuedFollowUps envelope）MUST 走默认 debounce 合并通道，MUST NOT 以 `immediate: true` 绕过 300ms 写合并。

#### Scenario: streaming delta 不逐条落盘

- **WHEN** Claude streaming 期间高频 delta 到达
- **THEN** 内存 store 即时更新，client store 写入按节流间隔合并

#### Scenario: settle 立即持久化

- **WHEN** transcript settle（turn 完成）
- **THEN** 立即 flush 到 client store，不等待节流窗口

#### Scenario: radar 与排队消息持久化走 debounce

- **WHEN** 切换会话或流式更新触发 sessionRadar 持久化 effect 与排队消息写盘
- **THEN** 写入 MUST 进入 clientStorage 默认 300ms 合并通道
- **AND** 300ms 窗口内多次写合并为一次 patch，不再与流式 IPC 争抢同步落盘
