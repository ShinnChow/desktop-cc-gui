# live-tool-output-render-budget 规格 Delta

## ADDED Requirements

### Requirement: Live Tool Output MUST Render Without Per-Line Syntax Highlighting

幕布共通层(所有引擎的工具块)在工具项处于 `processing`(live 流式)期间,输出行渲染 MUST 跳过逐行语法高亮(Prism tokenize),使用自动转义的纯文本渲染;`status` 离开 `processing`(settle)后 MUST 恢复带高亮渲染。错误行标记、表格行原样分支、空行占位语义 MUST 保持不变。

#### Scenario: live 期输出不含高亮标记

- **WHEN** 一个 `commandExecution` 工具项 `status === "processing"` 且输出持续流入
- **THEN** 输出行 MUST NOT 包含 Prism token class 标记
- **AND** 每 48ms flush 的渲染成本 MUST NOT 包含逐行 tokenize。

#### Scenario: settle 后恢复高亮

- **WHEN** 该工具项 `status` 变为 `completed` 或 `failed`
- **THEN** 输出行渲染 MUST 恢复逐行语法高亮,且语义与修复前一致。

#### Scenario: 回退开关

- **WHEN** `liveToolRenderBudget` flag 被关闭
- **THEN** live 期渲染行为 MUST 回到逐行高亮。

### Requirement: Live Published Snapshot Line Cap MUST Be Lower Than Settled Cap

`liveItemDeltaChannel` 的 toolOutput lane published 快照 MUST 按渲染阶段取两级行数帽:live(订阅方处于流式)期 100 行,settle 后 200 行。字节级尾帽(`COMMAND_EXECUTION_OUTPUT_HEAD`)语义 MUST 保持不变。

#### Scenario: live 快照行数帽

- **WHEN** 一个 toolOutput lane 的累计文本超过 100 行且订阅方处于流式状态
- **THEN** published 快照 MUST 只包含最后 100 行。

#### Scenario: 回退开关

- **WHEN** `liveToolOutputStreamingTail` flag 被关闭
- **THEN** published 快照行数帽 MUST 回到 200 行。

### Requirement: User Collapse Intent MUST Override Live Auto-Expand

工具块因 live 流式(`isRunning && showLiveOutput`)或长跑/settled 长命令(`durationMs ≥ 1200ms`)自动展开时,用户点击折叠 MUST 生效(进入用户折叠态,只显示 header 与状态点),且折叠意图 MUST 保持到用户再次点击(不被 settle 自动弹开);再次点击 MUST 恢复自动展开。外部受控的 `isExpanded === true` 时展开行为 MUST 不受影响,错误硬展开(`isError`)的点击仍走父层 `onToggle`。用户折叠态 MUST NOT 污染父层展开状态机(`onToggle` 协议不变)。

#### Scenario: long-running 命令可被用户折叠

- **WHEN** 一个 `durationMs ≥ 1200` 的命令项处于 live 自动展开
- **AND** 用户点击 header
- **THEN** body MUST 折叠且父层 `onToggle` MUST NOT 被调用。

#### Scenario: 再次点击恢复

- **WHEN** 用户折叠态下用户再次点击 header
- **THEN** live 自动展开 MUST 恢复。

#### Scenario: 折叠意图跨 settle 保持

- **WHEN** 用户折叠态下工具项 `status` 离开 `processing`
- **THEN** body MUST 保持折叠,不被长跑条件自动弹开。

#### Scenario: 回退开关

- **WHEN** `liveToolRenderBudget` flag 被关闭
- **THEN** 自动展开条件 MUST 恢复为硬条件,用户点击回归父层 `onToggle`。

### Requirement: Heavy Read Output MUST Degrade From Markdown Rendering

幕布共通层的 read 类工具块对「判定为 markdown 形态」的输出执行 markdown 渲染前 MUST 检查输出大小:输出超过 64KB 时 MUST 降级为纯文本输出容器,不做 markdown 编译;不超过阈值时维持 markdown 渲染。

#### Scenario: 超大 markdown 形态读取输出降级

- **WHEN** 一个 read 工具项的输出超过 64KB 且路径/形态判定为 markdown
- **THEN** 输出 MUST 走纯文本渲染容器,MUST NOT 进入 `<Markdown>` 编译。

#### Scenario: 回退开关

- **WHEN** `liveToolRenderBudget` flag 被关闭
- **THEN** markdown 渲染判定 MUST 不应用大小上限。
