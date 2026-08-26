# pi-rpc-session-runtime Specification

## Purpose
TBD - created by archiving change enhance-pi-native-rpc-session. Update Purpose after archive.
## Requirements
### Requirement: PI 会话 MUST 以 RPC 长驻进程为主路径

系统 MUST 为每个 native PI 会话维护一个 `pi --mode rpc` resident process（per workspace × session），并在进程退出后于下一次发送时惰性重建。

#### Scenario: 首次发送惰性 spawn

- **WHEN** native PI thread 发起首次发送且无存活 RPC 进程
- **THEN** 系统 MUST spawn `pi --mode rpc`（带 `--session-id <id>`（如有）、home/custom args）
- **AND** spawn 后 MUST 以 `get_state` 完成握手再受理 prompt

#### Scenario: 进程死亡后重建

- **WHEN** RPC 进程已退出（try_wait 检测到退出态）
- **THEN** 下一次发送 MUST 丢弃旧句柄并重新 spawn
- **AND** 当前受影响 turn MUST 以 TurnError 结算，不静默成功

#### Scenario: RPC 不可用时回退 print-json

- **WHEN** RPC spawn 或握手失败
- **THEN** 系统 MUST log warn 并回退既有 `pi --print --mode json` spawn-per-turn 路径
- **AND** 用户发送 MUST NOT 因此失败

### Requirement: RPC framing MUST 遵循 strict JSONL

系统 MUST 仅以 `\n` 作为记录分隔符解析 RPC stdout，并容忍 `\r\n`（strip 尾部 `\r`）。

#### Scenario: U+2028/U+2029 不分割记录

- **WHEN** stdout 内容包含 U+2028 或 U+2029
- **THEN** 系统 MUST NOT 将其视为记录边界

#### Scenario: response 按 id 关联

- **WHEN** 收到 `type=="response"` 且含 `id`
- **THEN** 系统 MUST 结算对应该 id 的 pending request
- **AND** 超时（30s；`compact` 因对整段会话做 LLM summarization，用独立 500s 预算——通用预算下 UI 会误报超时而 pi 侧仍跑完，造成状态分裂）或迟到的响应 MUST 被丢弃且不 panic
- **AND** pending request MUST 在写 stdin 之前注册（response 走独立 stdout pump，先写后注册存在到达窗口，未注册的 response 会被丢弃导致调用方干等超时；写失败 MUST 回滚 pending）

### Requirement: Extension UI request MUST auto-cancel

在 mossx headless 宿主中，RPC 进程的 extension UI 交互请求 MUST 一律以 `cancelled` 应答。

#### Scenario: select/confirm/input/editor 请求

- **WHEN** stdout 出现 extension UI request
- **THEN** 系统 MUST 立即写入 `{"type":"extension_ui_response","id":<同 id>,"cancelled":true}`
- **AND** MUST NOT 桥接 mossx elicitation UI（v1 边界）

### Requirement: Resident MUST 按会话隔离（真并行）

系统 MUST 为每个 native PI session 维护独立的 `pi --mode rpc` resident process（map key = 有效 session id；无 id 的新发送用 scratch/turn 独占进程）。同一 workspace 的多条 PI 会话 MUST 能同时 streaming。禁止用一只进程靠 `switch_session` 串行所有标签。

#### Scenario: 两条 PI 会话同时发送

- **WHEN** 同一 workspace 中会话 A 正在 streaming，用户向会话 B（或新会话）发送
- **THEN** 系统 MUST 为 B 使用（或惰性 spawn）独立 resident 并受理 prompt
- **AND** MUST NOT 返回「另一 PI 会话的 turn 仍在进行中」
- **AND** A 的 run / 事件流 MUST 不受影响

#### Scenario: 同会话二次发送仍走 steer

- **WHEN** 同一 session id 上已有未 settle 的 run
- **THEN** 系统 MUST 在该 resident 上发送 `steer`（same-run 融合）
- **AND** MUST NOT 再 spawn 第二只进程

#### Scenario: 新会话不得复用上一场进程

- **WHEN** 发送未带有效 session id（新会话 / pending）
- **THEN** 系统 MUST spawn 新的 scratch resident，MUST NOT 回落到 workspace 级 tracked session id

#### Scenario: 树/统计/compact/fork 命令按会话取 resident

- **WHEN** 执行 `pi_get_session_tree` / `pi_get_session_stats` / `pi_compact` / `pi_fork` / `pi_get_fork_messages`
- **THEN** 命令 MUST 携带调用方 thread 的 session id 并使用该 session 的 resident
- **AND** MUST NOT 打开树/统计时 spawn 一只无 session 的共享进程给后续发送复用

#### Scenario: 活跃 run 禁止 fork/compact（仅挡本会话）

- **WHEN** 目标 session 存在未 settle 的 agent run 且调用 `pi_fork` / `pi_compact`
- **THEN** 系统 MUST 拒绝并返回「turn 仍在进行中」（fork 会切该进程的会话文件；pi `compact()` 内部第一步是 `abort()`）
- **AND** 其它 PI 会话的 resident MUST 不受影响
- **AND** 守卫 MUST 只读取该 session 的 run（对齐会先清掉本 resident 丢失 settle 的僵尸 run）

### Requirement: Resident 模型 MUST 与发送请求模型对齐

RPC resident 的模型只在 spawn 时经 `--model` 设定一次；进程复用期间（含 tree/stats/fork 命令不带 model 裸 spawn 出的 resident）系统 MUST 在每次新 run 启动前将 resident 模型与本次发送请求的 model 对账，禁止以漂移后的模型静默作答。

#### Scenario: spawn 携带请求模型

- **WHEN** 惰性 spawn resident 且请求携带显式 model
- **THEN** spawn MUST 传 `--model <model>`；握手后 resident 模型即请求模型，后续对账为 no-op

#### Scenario: 新 run 启动前对账

- **WHEN** 新 run 启动前 resident 已存活，且请求 model 为 `provider/modelId` 并与 resident 当前 model（get_state 缓存）不一致
- **THEN** 系统 MUST 先 `set_model(provider, modelId)` 成功后再 prompt
- **AND** `set_model` 成功后 MUST 刷新缓存 state（与 fork/switch_session/new_session 同纪律）

#### Scenario: set_model 失败回退 print-json

- **WHEN** `set_model` 返回失败
- **THEN** 该 turn MUST 回退 `pi --print --mode json` 路径（spawn-per-turn 且每次携带 `--model`）
- **AND** MUST NOT 以漂移后的 resident 模型静默作答

#### Scenario: 裸 model id 无法精确对账

- **WHEN** 请求 model 无 provider 前缀且与 resident 当前 model id 不同
- **THEN** 系统 MUST log warn 并保留 resident 模型（`set_model` 需要显式 provider，裸 id 不可安全解析）

#### Scenario: 活跃 run steer 不中途换模型

- **WHEN** steer 附加到进行中的 run 且请求 model 与 resident 不一致
- **THEN** 系统 MUST 保留 run 启动时的模型并 log warn，MUST NOT 在 run 中途 `set_model`

### Requirement: 发送语义 MUST 区分 idle prompt 与 streaming steer

系统 MUST 按 RPC 会话的 streaming 状态选择 `prompt` 或 `steer` 命令，并以 typed 事件而非进程生命周期判定 turn 终态。

#### Scenario: idle 时发送

- **WHEN** RPC 会话 `isStreaming == false`
- **THEN** 系统 MUST 发送 `prompt` 命令
- **AND** turn 终态 MUST 以 typed `agent_settled` 为准，进程退出只算 cleanup

#### Scenario: streaming 时融合发送

- **WHEN** RPC 会话 `isStreaming == true` 且 delivery decision 为 same-run steer
- **THEN** 系统 MUST 发送 `steer` 命令
- **AND** steered user message MUST 由前端乐观气泡上幕布（`wasProcessing && steerEnabled` 既有链路）
- **AND** 后端 MUST NOT 重复投影 user echo（避免双气泡）

#### Scenario: 中断

- **WHEN** 用户中断当前 turn
- **THEN** 系统 MUST 发送 `abort` 命令
- **AND** 2s 内未 settle MUST kill 进程兜底
- **AND** 无活跃 run 时 MUST NOT abort 或等待 grace（空闲中断零延迟）

#### Scenario: turn 超时一次结算

- **WHEN** RPC turn 超过 10min 未 settle
- **THEN** 系统 MUST 摘下 run 并以同一错误结算全部 waiter（main + attached steer），随后 abort
- **AND** 同一 turn MUST NOT 收到第二次终态（迟到 `agent_settled` 或 stale-settle 自愈面对空 run 直接跳过；已结算路径 MUST NOT 被外层重发 TurnError）

### Requirement: 深会话树响应 MUST 摊平且瘦身

线性长会话的 get_tree 嵌套树可达数千层 / 数十 MB（粘贴截图的 base64 图片）。系统 MUST 在过 IPC 前把树摊平为浅层 entries 并瘦身，禁止嵌套树直接跨进程边界。

#### Scenario: 嵌套深度不撞递归限制也不爆栈

- **WHEN** 会话条目数使树嵌套超过 serde_json 默认 128 层递归限制（~130 条的线性会话即触发）
- **THEN** RPC pump MUST 按行嵌套深度分流解析：浅行走默认解析器（护栏保留）；深行挪到大栈线程解析（禁止在 2MB tokio worker 上直接放开递归限制——递归下降解析器实测 ~1008 层即 SIGABRT 爆栈）
- **AND** 深层 `Value` MUST NOT 离开大栈线程（其递归 drop 同样爆栈）：get_tree 响应在大栈线程内摊平为浅层 `entries` 后才跨线程传递
- **AND** `pi_get_session_tree` MUST 返回浅层 `entries`（parentId 表达结构，前端重建森林），MUST NOT 返回嵌套树（Tauri IPC 序列化同样受递归限制）

#### Scenario: 载荷瘦身

- **WHEN** 树响应包含 base64 图片块或超长文本（工具输出/长正文）
- **THEN** 后端 MUST 剥除图片数据字段并把文本截断为单行预览上限（500 字符，char 安全）
- **AND** 磁盘解析的 derivedLanes / rootEntries 同样截断（红线 21 只读，不改 vendor 文件）

### Requirement: 图片输入 MUST 走 base64 images 字段

RPC 路径下系统 MUST 以 `images` 字段（base64 ImageContent）传输图片，禁止复用 print 模式的 `@file` argv 传输。

#### Scenario: RPC 路径携带图片

- **WHEN** 发送参数包含图片文件
- **THEN** 系统 MUST 读取文件并编码为 `images: [{type:"image",data,mimeType}]`
- **AND** MUST NOT 使用 print 模式的 `@file` argv 传输

#### Scenario: RPC 历史回看 MUST 还原用户附图

- **WHEN** `load_pi_session` 读到 user message 的 content 含 `{type:"image", data, mimeType}`（或 `source.data`）且没有 `<file name>` 包装
- **THEN** 投影 MUST 把该块变成可展示的 `images`（data URL 或 path）
- **AND** 用户可见正文 MUST 仍是 text block（例如「这是啥」）
- **AND** 若同一条还带 `@file` 时代的 `<file name="/abs/..">` 包装，MUST 继续只用路径，不得把 inlined base64 再投影一份
- **AND** 纯图片、无 text 的 RPC user 行 MUST 保留，不得当空消息丢掉

### Requirement: ACK 分级 MUST 不假装

系统 MUST 区分 command acceptance 与 turn settlement：response.success 仅代表受理，终态只能来自 typed 事件流。

#### Scenario: command response 不是 turn 终态

- **WHEN** `prompt`/`steer` 的 response 返回 `success: true`
- **THEN** 系统 MUST 仅将其视为 accepted/queued
- **AND** turn 结算 MUST 等待 `agent_settled` 或 typed error 事件

### Requirement: 历史回放 MUST 剥离两种时代的文件附件包装

系统 MUST 在 PI 历史回放（消息正文与侧栏标题）同时剥离 `<file name="...">`（print-json 时代 pi CLI 注入）与 `<file path="...">`（RPC 时代 mossx 注入）两种附件包装，禁止把包装标签或其内联正文当用户消息展示。

#### Scenario: RPC 时代 path= 包装正文剥离

- **WHEN** `load_pi_session` 读到 user text block 含 `<file path="/abs/CHANGELOG.md">正文</file>`
- **THEN** 可见正文 MUST NOT 包含 `<file` 标签或附件内联正文
- **AND** 非图片附件路径 MUST 以 `@/abs/CHANGELOG.md` 形式回到可见正文（保留附件引用）
- **AND** 该路径 MUST NOT 进入 `images`（前端无扩展名过滤，会渲染裂图 chip）

#### Scenario: 文本附件与图片 content block 混合消息

- **WHEN** 同一条 RPC user message 同时含 `<file path="...md">` 包装与 `{type:"image", data}` content block
- **THEN** 包装 MUST 被剥离且图片 block MUST 仍投影为可展示 `images`
- **AND** 非图片 wrapper 路径 MUST NOT 顶掉 content-block 图片投影

#### Scenario: 图片 wrapper 语义保持

- **WHEN** user text block 含图片路径的 `<file name="...png">` 包装（print-json 时代）
- **THEN** 图片路径 MUST 继续进入 `images`，且同条 message 的 content-block base64 MUST NOT 二次投影（既有语义不变）

#### Scenario: 侧栏标题剥离 path= 包装

- **WHEN** `read_session_summary` 提取的首条用户消息含 `<file path="...">` 包装
- **THEN** 标题 MUST 剥离包装只留用户文本
- **AND** 纯附件消息标题 MUST 回退 `[附件]` 标记

