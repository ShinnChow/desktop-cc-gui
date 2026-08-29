# Design: perf-live-tool-output-render-budget

## 事实基线(2026-08-29 实测)

- `liveItemDeltaChannel` 的 toolOutput lane 已有「published 快照只发尾 200 行」机制(`takeLiveToolOutputSnapshot`,2246aa900),live 期 `BashToolBlock` 拿到的 `item.output` 已是有界尾段(经 `ToolBlockRenderer` 的 `liveOutputOverride` 覆盖)。**全量 split 256KB 不是现存成本**——现存成本是:
  - 每 48ms 一轮的 200 行逐行 Prism tokenize(`highlightedOutputLines`),扫描类输出 cache 全 miss;
  - 200 行 DOM diff + reflow/repaint + 滚动强制置底;
  - `isLongRunning` 硬条件导致用户无法折叠自救。
- 协议层(codex 0.150.1 三轮模拟:8 源码文件 / 5MB 大文件 / 15 万文件目录扫描)总流量 0.08~1.06MB,无 `item/updated` 快照风暴——引擎侧不是本 change 范围。

## 方案与取舍

### 修点① live 高亮降级(settle 后升级)

- `BashToolBlock` 的 `highlightedOutputLines` 改为按 `isRunning` 分支:live 期 default 分支用 React children 纯文本渲染(自动转义,无 `dangerouslySetInnerHTML`),settle 后恢复 `highlightLine`。
- 取舍:live 期放弃语法色(CLI 终端本来就是降级色,settle 后一次性 200 行 tokenize ≈ 2ms 可接受);不采用「分批 idle 高亮」,避免引入调度复杂度——实测一次性成本在预算内。
- `isErrorLine` / `isTableLikeLine` / 空行分支语义不变。

### 修点② 两档行数帽

- `LIVE_TOOL_OUTPUT_DISPLAY_LINES`(200)保留为 settle 语义帽并继续导出(向后兼容,消费方:测试与注释对齐);新增 `LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING = 100`,`takeLiveToolOutputSnapshot` 改用 streaming 帽。
- live published 快照只在 `isToolStreaming` 时被订阅消费(`ToolBlockRenderer`),所以「快照帽=100」精确等于「live 期渲染 100 行」;settle 渲染走 store output(`MAX_OUTPUT_LINES = 200`)不受影响。

### 修点③ 用户折叠意图优先

- 新增内部 state `liveCollapsed`,不与父层 `isExpanded`(按 itemId 维护)纠缠:
  - live 自动展开(`(isRunning && showLiveOutput) || isLongRunning`)且外部未展开时,点击 header = 置 `liveCollapsed`(body 折叠,header 保留状态点);
  - 再次点击 = 清 `liveCollapsed`(恢复自动展开);
  - 折叠意图**跨 settle 保持**(settle 后不因长跑条件弹回展开,用户再点恢复),`isError` 硬展开的点击仍走父层 `onToggle`;
  - 外部 `isExpanded === true` 时 `showBody` 恒 true,行为不变。
- 取舍:不改 `onToggle` 父层协议(不碰 `ToolBlockRenderer` 展开状态机),最小侵入。

### 修点④ read markdown 预算

- `ReadToolBlock.renderAsMarkdown` 增加 `renderedOutput.length <= READ_OUTPUT_MARKDOWN_BUDGET (64KB)` 前置条件;超限走现有纯文本分支(300px 滚动容器),与 `GenericToolBlock` 的 `hydrationWeight.isHeavyOutput` 思路对齐。

### 回退开关

- 新增 flag(默认开):`liveToolRenderBudget`(①③④共用)、`liveToolOutputStreamingTail`(②)。挂在既有 `realtimePerfFlags.ts`,模块加载读一次,翻转需刷新(与 `liveDeltaExternalization` 同语义)。

## 共通遵守的保证

- 全部改动落在幕布共通层,任何引擎的工具输出渲染都经过同一条链;新增引擎/新增工具块类型继承同一预算。
- 收口时把「live 渲染三原则」(published 行数帽 / live 降级渲染、settle 升级 / 用户折叠意图最高优先)沉淀进 `dev-guidelines/frontend/`(本 change tasks 内)。

## 风险

- ①:视觉上 live 期无语法色——可接受,flag 可回退。
- ③:与既有测试假设冲突(如「长命令默认展开」断言)——TDD 先行,存量断言按新语义更新并在 tasks 中列出。
- ②:live 期从 200→100 行,极端依赖回看多行输出的场景可见范围变小——用户可点击展开 settted 全量,可接受。
- ADR 校准回写 gate:本 change 不触发 engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal ACK / recovery 等基石触发器,预计无需回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`。
