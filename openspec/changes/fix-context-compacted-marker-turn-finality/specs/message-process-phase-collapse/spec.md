## MODIFIED Requirements

### Requirement: Minimal Transcript Mode MUST Fold Completed Turns Into A Single Turn Chip

当用户通过设置开启极简展示（Minimal Transcript Mode，flag 默认关）时，对话幕布 MUST 把每个**已完成 turn** 中「user 消息之后、最终回答锚点 prose 之前」的全部 items（reasoning / tool / explore 过程 + 中间叙述 prose）折叠为**单个 turn 级 chip**，折叠态 MUST hard-unmount 全部隐藏行，chip MUST 锚定渲染在该 turn 最终回答 prose 正上方。
最终回答锚点 MUST 取该 turn 最后一条 `isFinal === true` 的 assistant prose；无 isFinal 时 MUST 取最后一条可见 assistant prose。最终回答 prose 本身 MUST NOT 被折叠。`context-event` 留痕 item MUST NOT 参与锚点竞选：锚点回溯与「最后一条可见 assistant prose」兜底 MUST 均跳过该 kind。
本模式 MUST 为 opt-in：flag 关闭时幕布 MUST 保持既有 per-phase 折叠行为，逐行不变。

**流式活跃 turn**（`isThinking === true` 的尾部 turn）MUST 同样参与整段折叠：已落定的过程与中间叙述 prose MUST 实时折叠为**单个 live turn chip**，幕布上 MUST 只保留「live chip + 当前生长中的 prose + 尾部滚动窗口」。live chip 的 phaseKey MUST 为 `liveturn:${precedingUserMessageId ?? "start"}`，在整个 turn 周期内保持稳定；生长中的 prose 本身 MUST NOT 被折叠。live turn 的 trailing 滚动窗口阈值 MUST 为 4（极简专用常数），可见尾部 MUST 保持 3 条；默认模式阈值 5 MUST NOT 受影响。
turn 完成瞬间 live chip MUST 切换为 `turn:${finalAnchor.id}` chip；若用户在流式中展开过 live chip，展开态 MUST 迁移，MUST NOT 在完成瞬间突然折回。

**展开态**：用户展开 turn chip（`turn:` 或 `liveturn:`）时，该 turn 内部 MUST 按与默认模式一致的 per-phase 折叠形态渲染：每段 prose 之前的过程行 MUST 折成 prose 级 chip（默认折叠、可独立展开/折回），trailing 滚动窗口 MUST 回落默认模式阈值 5；中间叙述 prose MUST 保持可见。展开期间外层 turn chip MUST 保持渲染，作为折回单 chip 形态的入口，MUST NOT 消失或位移到段外。

#### Scenario: Completed turn folds process and interstitial prose into one chip

- **WHEN** 极简展示开启，且某已完成 turn 的 timeline 为
  `user → reasoning/tools → assistant(叙述 A) → reasoning/tools → assistant(final)`
- **THEN** MUST 只生成一个 turn 级 chip，锚定在 `assistant(final)` 上方
- **AND** 全部过程行与叙述 A MUST hard-unmount
- **AND** `assistant(final)` 正文 MUST 保持可见
- **AND** chip 统计 MUST 计入被隐藏的叙述段数（proseCount）

#### Scenario: Compaction marker never becomes the turn anchor and stays visible

- **WHEN** 极简展示开启，且某已完成 turn 的 timeline 为
  `user → reasoning/tools → assistant(final, isFinal) → context-event(compacted 留痕)`
- **THEN** turn chip 锚点 MUST 为 `assistant(final)`，MUST NOT 为 `context-event` 留痕
- **AND** `assistant(final)` 正文 MUST 保持可见、MUST NOT 被折进 chip
- **AND** `context-event` 留痕 MUST 保留在 `timelineItems` 中（不进 `hiddenItemIds`、不被 unmount），MUST 以独立系统行渲染在 chip 与最终回答之后
- **AND** chip 的 proseCount 统计 MUST NOT 计入该留痕

#### Scenario: Turn whose only prose follows a marker still anchors correctly

- **WHEN** 极简展示开启，且某已完成 turn 不含任何 `isFinal === true` 的 assistant prose，timeline 为
  `user → assistant(叙述 A) → assistant(final 回答，未标 final) → context-event 留痕`
- **THEN** 锚点兜底 MUST 取 `assistant(final 回答)`（最后一条可见 assistant prose，跳过留痕）
- **AND** MUST NOT 取 `context-event` 留痕作为锚点或可见正文

#### Scenario: Expanding a turn chip renders inner process with default-mode per-phase folding

- **WHEN** 用户点击某个已折叠的 turn chip（completed `turn:` 或 live `liveturn:`）
- **THEN** 外层 turn chip MUST 保持渲染并标记为展开
- **AND** turn 内每段 prose 之前的过程行 MUST 折成与默认模式一致的 per-phase chip（默认折叠）
- **AND** 中间叙述 prose MUST 全部保持可见，尾部滚动窗口 MUST 使用默认模式阈值 5
- **AND** 内层 per-phase chip MUST 可独立展开查看原始过程行
- **AND** 再次点击外层 chip MUST 折回单 chip 形态

#### Scenario: Active streaming turn folds settled content into a live turn chip

- **WHEN** 极简展示开启，尾部 turn 仍在进行（`isThinking === true`），且当前生长中的 prose 之前已存在过程行或中间叙述
- **THEN** 已落定的过程行与中间叙述 MUST hard-unmount，折叠为单个 live turn chip，锚定在生长中 prose 正上方
- **AND** chip phaseKey MUST 为 `liveturn:<preceding user message id>` 且随流式推进保持稳定
- **AND** 生长中的 prose MUST 保持可见，chip 统计 MUST 随流式增长实时刷新（含 proseCount）
- **AND** 更早的已完成 turn MUST 仍按 turn 级折叠

#### Scenario: Live turn keeps a rolling visible tail before any prose lands

- **WHEN** 极简展示开启，活跃 turn 尚无可见 assistant prose（纯工具/思考跑动中）
- **THEN** 过程 entry 数不超过 4 时 MUST 全部保持可见、不产 chip
- **AND** 超过 4 时 MUST 隐藏至仅剩尾部 3 条可见，live chip MUST 自锚于第一个可见尾部 entry 之前
- **AND** 默认模式（flag 关）的 trailing 阈值 MUST 保持 5 不变

#### Scenario: Expanded live chip stays expanded when the turn completes

- **WHEN** 用户在流式中展开了 live turn chip，随后该 turn 完成（`isThinking` 转 false）
- **THEN** 完成后的 `turn:` chip MUST 继承展开态，turn 内部 MUST 继续按 per-phase 折叠形态渲染，MUST NOT 突然折回
- **AND** 未展开过的 live chip 在完成后 MUST 保持折叠

#### Scenario: Turn without interstitial content produces no chip

- **WHEN** 极简展示开启，且某 turn 仅含单条 assistant prose（无过程、无中间叙述），无论已完成或流式生长中
- **THEN** MUST NOT 生成空 chip，该 prose MUST 正常显示

#### Scenario: Turn without any prose is never folded

- **WHEN** 极简展示开启，且某**已完成** turn 不含任何可见 assistant prose（纯工具或错误收尾）
- **THEN** MUST NOT 折叠该 turn 的任何 item，MUST NOT 生成 chip
- **AND** 仅含 `context-event` 留痕而无 assistant prose 的 turn 同样 MUST NOT 产 chip，留痕 MUST 保持可见

#### Scenario: Mode toggle is isolated and immediate

- **WHEN** 用户在设置中切换极简展示开关
- **THEN** 幕布 MUST 当场按新模式重算折叠，无需重启
- **AND** 关闭开关后 MUST 完整恢复既有 per-phase 折叠渲染

## ADDED Requirements

### Requirement: Context Event Marker MUST NOT Participate In Prose Finality Or Folding

引擎侧上下文事件留痕（`kind: "context-event"`，如压缩完成）MUST 以独立 item kind 表达，MUST NOT 伪装为 assistant message。turn 结算打 finality（`markLatestAssistantMessageFinal`）时 MUST 跳过该 kind，`isFinal` MUST 落在真实 assistant prose 上。该 kind MUST NOT 计入任何「assistant 可见 prose」聚合（极简折叠 prose 判定、per-phase 折叠统计、按 assistant 文本聚合的导出链路）。默认模式与极简模式 MUST 以同形态渲染该留痕：独立系统行（居中弱化），MUST NOT 渲染为 assistant 气泡。

#### Scenario: Turn settlement attaches finality to the real answer

- **WHEN** turn 结算触发 `markLatestAssistantMessageFinal`，且线程尾部为 `… → assistant(回答) → context-event 留痕`（留痕先于 settle 事件入库）
- **THEN** `isFinal === true` MUST 落在 `assistant(回答)` 上
- **AND** `context-event` 留痕 MUST NOT 获得 `isFinal` / `finalCompletedAt` / `finalDurationMs`

#### Scenario: Marker renders as a standalone system row in both modes

- **WHEN** 幕布（默认模式或极简模式）渲染含 `context-event(compacted)` 留痕的时间线
- **THEN** 留痕 MUST 渲染为独立系统行（居中弱化分隔形态），携带 reason 文案与可选 token 前后值
- **AND** 留痕 MUST NOT 渲染为 assistant 气泡、MUST NOT 被折叠进任何 chip
