# Proposal: perf-live-tool-output-render-budget

## Why

实测(2026-08-29,codex app-server 0.150.1 本地三轮模拟 + 代码链路核对)确认:工具输出 live 流式期间的渲染成本与「已显示行数 × 刷新频率」成正比,且用户没有降载与自救手段,在 Windows WebView2 上被放大成用户反馈的「扫描文件目录爆卡」:

1. `BashToolBlock` live 期每 48ms 对尾部 200 行逐行跑 Prism tokenize。扫描类输出行行不同,`highlightLine` 的 LRU cache 全 miss,每轮纯 JS 2~4ms(Mac 实测),DOM reflow 在 WebView2 上再放大数倍。
2. live published 快照行数帽(200 行)与 settle 后显示帽相同,没有利用「live 期用户只盯尾部」的视觉事实做降载。
3. `showBody = isExpanded || (isRunning && showLiveOutput) || isLongRunning || isError` 中 `isLongRunning`(durationMs ≥ 1200ms)是硬条件:长命令(目录扫描实测单条 2~10s)强制展开 live 输出,用户点折叠也关不掉,爆卡时无法自救。
4. `ReadToolBlock` 对「长得像 markdown」的读取输出走 `<Markdown>` 同步渲染,没有大小上限,大文件全文会整段进 markdown 编译。

以上全部位于幕布共通层(`toolBlocks/**` + `threads/utils/liveItemDeltaChannel.ts`),不涉及任何 engine adapter——所有引擎(Claude / Codex / Gemini / OpenCode / …)的工具输出渲染天然共同遵守同一套预算。

## What Changes

- **修点①(live 高亮降级)**:工具块 live(`processing`)期输出行跳过 Prism 逐行高亮,改纯文本转义渲染;status 离开 `processing`(settle)后一次性恢复带高亮渲染。
- **修点②(live 行数帽降档)**:`liveItemDeltaChannel` 的 toolOutput published 快照行数帽拆两档——live 期 100 行、settle 后 200 行(settle 渲染帽不变)。
- **修点③(用户折叠意图优先)**:`BashToolBlock` 新增内部 `liveCollapsed` 状态:live 自动展开期间用户点击 header 先折叠 live 输出(不再无条件强制展开),再次点击恢复;`isRunning` 结束后自动复位,外部 `isExpanded` 语义不受影响。
- **修点④(read markdown 预算)**:`ReadToolBlock` 的 markdown 渲染判定加 64KB 上限,超限降级为纯文本输出容器。

所有修点挂 `realtimePerfFlags` 回退开关(默认开),与 `liveDeltaExternalization` 同模式。

## Impact

- Affected code(全部为幕布共通层,零 engine adapter 改动):
  - `src/features/messages/components/toolBlocks/BashToolBlock.tsx`(修点①③)
  - `src/features/threads/utils/liveItemDeltaChannel.ts`(修点②)
  - `src/features/messages/components/toolBlocks/ReadToolBlock.tsx`(修点④)
- Affected spec: 新增 capability `live-tool-output-render-budget`(ADDED Requirements)。
- 不改动:`ToolBlockRenderer` 分发逻辑、`boundToolOutput` 字节预算、`SnapshotThrottle`、任何 engine adapter、任何 store 结构。
- 验收基线:2026-08-29 `/tmp/codex-readfile-repro/` 三轮事件流存档 + 本 change TDD 测试与 Mac dev:scan 观测。
