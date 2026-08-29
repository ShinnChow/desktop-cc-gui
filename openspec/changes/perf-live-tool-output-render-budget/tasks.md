# Tasks: perf-live-tool-output-render-budget

## 1. 修点② live 行数帽降档(liveItemDeltaChannel)

- [x] 1.1 TDD:`liveItemDeltaChannel.test.ts` 新增用例——`takeLiveToolOutputSnapshot` 在 streaming 帽下最多发布 100 行(`LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING`),存量 200 行帽断言按新语义更新。
- [x] 1.2 实现:`liveItemDeltaChannel.ts` 新增 `LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING = 100`,`takeLiveToolOutputSnapshot` 改用之;保留 `LIVE_TOOL_OUTPUT_DISPLAY_LINES` 导出与 settle 语义注释。
- [x] 1.3 flag:`liveToolOutputStreamingTail`(默认开)控制降档,关时回落 200 行。

## 2. 修点① live 高亮降级(BashToolBlock)

- [x] 2.1 TDD:`BashToolBlock.test.tsx` 新增用例——`processing` + output 时输出行不含 Prism token class;rerender 为 `completed` 后含 token class;flag 关闭时 live 期仍高亮。
- [x] 2.2 实现:`highlightedOutputLines` 按 `isRunning` 分支,live 期 default 分支走 React 纯文本 children;`isErrorLine` / `isTableLikeLine` / 空行分支不变。

## 3. 修点③ 用户折叠意图优先(BashToolBlock)

- [x] 3.1 TDD:`BashToolBlock.test.tsx` 新增用例——long-running(`durationMs ≥ 1200`)默认展开;点击 header 后 body 折叠且不触发父层 `onToggle`;再次点击恢复;`isRunning` 结束后 `liveCollapsed` 复位(点击回归父层 toggle);外部 `isExpanded=true` 时行为不变。
- [x] 3.2 实现:新增 `liveCollapsed` state + `handleToggle` 分流;`showBody` 改为 `isExpanded || (liveAutoExpand && !liveCollapsed)`。
- [x] 3.3 flag:`liveToolRenderBudget` 覆盖本修点(关时维持旧硬展开语义)。

## 4. 修点④ read markdown 预算(ReadToolBlock)

- [x] 4.1 TDD:`ReadToolBlock.test.tsx` 新增用例——markdown 路径 + 输出 > 64KB 时不渲染 `.read-tool-markdown` 走纯文本容器;≤ 64KB 维持 markdown;flag 关闭时维持 markdown。
- [x] 4.2 实现:`renderAsMarkdown` 增加 `READ_OUTPUT_MARKDOWN_BUDGET (64KB)` 前置条件,常量导出供测试。

## 5. 验证与收口

- [x] 5.1 跑 `vitest` 相关文件(BashToolBlock / ReadToolBlock / liveItemDeltaChannel / ToolBlockRenderer 关联测试)。
- [x] 5.2 跑 `check:messages-boundaries` 与 `check:large-files`(确保新文件不超限)。
- [ ] 5.3 Mac `dev:scan` 用 2026-08-29 扫描提示词复现对比,long task / 输入延迟记录进 `verification.md`。
- [x] 5.4 把「live 渲染三原则」沉淀进 `dev-guidelines/frontend/`(quality-guidelines 或独立小节),engine onboarding 核对矩阵引用。
- [ ] 5.5 openspec verify / archive 流程(按 workspace governance)。
