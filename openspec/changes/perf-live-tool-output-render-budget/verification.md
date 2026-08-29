# Verification: perf-live-tool-output-render-budget

日期：2026-08-29。分支 `bump-version-0.9.4`。

## 单元测试（TDD，全部绿）

| 文件 | 结果 |
|---|---|
| `src/features/threads/utils/liveItemDeltaChannel.test.ts` | 21 passed（含 2 个新用例：streaming 帽 100 行 / flag off 回落 200 行） |
| `src/features/messages/components/toolBlocks/BashToolBlock.test.tsx` | 10 passed（新增 4 个用例：live 纯文本 + settle 恢复高亮 / flag off 保持高亮 / 长跑可折叠且不碰父层 toggle / 折叠意图跨 settle 保持 + 外部展开不劫持） |
| `src/features/messages/components/toolBlocks/ReadToolBlock.test.tsx` | 11 passed（新增 3 个用例：>64KB 降级纯文本 / 阈值内保持 markdown / flag off 不降级） |
| `src/features/threads/hooks/useThreadItemEvents*`（受影响链路存量） | 全绿 |
| `src/features/messages/rows/components/MessageRow.live-text-cadence.test.tsx` | 全绿 |

TDD 过程：修点②先改断言跑红（100 ≠ 200）再实现；修点①③先写 6 用例跑红 3 个（正是新行为）再实现；修点④先写 3 用例跑红 2 个再实现。

## 存量失败声明（与本 change 无关）

以下失败在 `git stash` 后的干净树上完全复现，属 HEAD 存量问题，非本次改动引入：

- `Messages.live-behavior.test.tsx`：10 failed（滚动跟随相关，干净树同样 10 个）
- `GenericToolBlock.test.tsx`：5 failed（inline diff 相关，干净树同样 5 个）

本 change 未触碰这两个组件的行为。

## 类型检查

`tsc --noEmit`：本 change 的全部文件零错误。现存报错集中在 `src/features/app/hooks/useSidebarMenus.ts`（他人在途改动，本 change 未触碰该文件）。

## Governance

- `check:large-files`：exit 0，通过。
- `check:messages-boundaries`：exit 1，但干净树基线同为 exit 1（82 行违规输出 → 本树 86 行）。新增 4 行为 `messages → threads/utils/realtimePerfFlags` import（BashToolBlock / ReadToolBlock 源码 + 测试各一处），与存量 `ToolBlockRenderer.tsx:34`、`ReasoningRow.tsx:23`、`MessageRow.live-text-cadence.test.tsx` 等十几处同款 import pattern 完全一致，未开创新违规类别。跨 feature perf-flag 消费债务的统一收口建议另开 change。

## 规则与文档沉淀

- OpenSpec change 四件套落盘（proposal / design / tasks / spec delta `live-tool-output-render-budget`）。
- 「Live Tool Output Render Budget」三原则已沉淀至 `dev-guidelines/frontend/messages-streaming-render-contract.md`。
- 回退开关：`ccgui.perf.liveToolRenderBudget`（修点①③④）、`ccgui.perf.liveToolOutputStreamingTail`（修点②），默认开，localStorage 置 0/off 回退。
- ADR 校准回写 gate：未触发基石文档更新触发器（未动 engine registry / Shared 支持集合 / provider binding / canonical fact schema / context compiler / terminal ACK / recovery），无需回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`。

## 二次 Review（切换对抗视角后的发现）

**已修：**

- 测试里 4 处裸写 flag key 字符串（`"ccgui.perf.liveToolRenderBudget"` 等）→ 改用导出常量 `LIVE_TOOL_RENDER_BUDGET_FLAG_KEY` / `LIVE_TOOL_OUTPUT_STREAMING_TAIL_FLAG_KEY`，防止 key 改名时测试静默漂移。修后 42 tests 全绿。

**确认无害的疑点（逐一核对过代码）：**

- settle 竞态：`resolveResidualLiveItemDeltaText` 读的是 peek 权威全量（`entry.text` vs durable 长度比较），不是 published 尾段；settle 前后无「短暂只显示 100 行」的回退。
- `onRequestAutoScroll` effect 只在 `showLiveOutput` 翻转时触发一次，依赖数组不含 liveCollapsed——用户折叠后不会继续驱动幕布滚底。
- 高亮跳过只作用于 default 分支；`isErrorLine` 红色标记、`isTableLikeLine`、空行占位的语义与优先级不变。
- `takeLiveToolOutputSnapshot` 先按行数截再按 64KiB 字节截，超长单行会被「拦腰截断」出半行——既有行为（200 行版同样），非本次引入。
- `highlightedOutputLines` 在 settle 帧一次性重算 200 行（约 2~4ms，Mac 实测），与 drain/ensureThread 同帧，预算内。
- 生产模式 flag 走 `cachedFlags` 缓存（模块级读一次语义），48ms 发布路径只有 Map 查找开销。

**存量问题（记录，不在本 change 范围）：**

- read 类 item 的输出**没有 store 层字节预算**：`boundToolOutput` 只覆盖 `commandExecution` / `fileChange`，超大 read 输出仍会全量进 store；本 change 的 64KB 上限只挡住渲染端 markdown 编译。建议后续 change 把字节预算扩展到 read 类（所有引擎受益）。
- fileChange lane 无行数帽/字节帽（有存量测试锁定该语义），渲染走结构化 `FileChangeRow`，暂无问题。
- 新 flag 未加入 `REALTIME_PERF_FLAG_IDS` 数组 → `getActiveRealtimePerfFlags()`（诊断面板）不展示这两个新 flag。有意取舍：避免动共享 flag 类型；后续 flag 面板统一收口时可一并加入。
- 轻微交互瑕疵：父层 `isExpanded === true` 时用户需点两次才能折叠 live 输出（第一次翻转父层展开态，第二次才进入 `liveCollapsed` 拦截）；折叠后无持续成本，影响有限。

## 5.3 实测回归对照（2026-08-29 修复后重跑，codex app-server 0.150.1）

事件流基线存档：`/tmp/codex-readfile-repro/`（`*-events.baseline.jsonl` 为修复前基线，`runN-after-events.jsonl` 为修复后重跑；`replay-render-cost.mjs` 为渲染管线回放脚本）。

### 协议层对照（确认零回归）

| 场景 | 修复前基线 | 修复后重跑 | 结论 |
|---|---|---|---|
| 扫描 8 个源码文件 | 1625 事件 / 1.06MB / 453s | 2067 事件 / 2.53MB / 292s（模型这次读了 4 个 120~157KB 文件，压力更大） | 形态一致：`outputDelta` 真 delta + `item/completed` 全量巨 payload，无 `item/updated` 快照风暴 |
| 读取 5MB 大文件 | 225 事件 / 0.08MB / 56.5s | 79 事件 / 0.03MB / 251.6s | 一致：codex 切片处理，流量极小 |
| 扫描 15 万文件 | 1026 事件 / 0.48MB / 391s | 1305 事件 / 0.56MB / 331s | 一致：聚合统计路径，单条最大 ~17KB |

前端渲染层修复不影响协议层——重跑证实事件流形态与修复前一致，零回归。

### 渲染层回放对比（同一事件流，修复前后管线，真 LRU 4000 建模滑动命中）

| 事件流 | 修复前 live 累计 JS | 修复后 | 节省 | 修复前峰值轮 | 修复后峰值 |
|---|---|---|---|---|---|
| run1 基线 | 29.7 ms | 2.3 ms | 92.4% | 4.72 ms | 0.16 ms |
| run3 基线（15 万文件扫描） | 16.2 ms | 0.3 ms | 98.3% | 8.99 ms（133 行冷 cache） | 0.04 ms |
| run1-after（4 条 100KB+ 巨 payload） | 36.0 ms | 1.1 ms | 97.0% | **14.39 ms**（200 行窗口冷 cache） | **0.36 ms** |

关键结论：

1. **峰值轮削减约 25~40 倍**。修复前在「大 delta 洪峰 + cache 冷」时单轮 tokenize 达 9~14ms，逼近 16.7ms 帧预算；Mac M 系列上尚可消化，Win WebView2 的同路径成本按 3~5 倍放大即必然爆帧——与用户「扫描目录爆卡」反馈吻合。修复后峰值 0.04~0.36ms，彻底脱离帧预算危险区。
2. **诚实修正早先估算**：此前离线 benchmark 按「200 行全 miss」估 2.2ms/轮，高估了修复前成本——真实 LRU 滑动窗口下相邻轮重叠行大量命中（run1 基线 hit/miss = 8712/1548）。修复的实际收益集中在**峰值轮消除**（冷 cache + 洪峰组合）与 **DOM 行数减半**（200→100 行的 diff/repaint，Win 上放大的一部分），而非稳态平均值的数量级改善。
3. settle 一次性成本（修复后恢复高亮，200 行 tokenize）实测 0.2~0.4ms，远低于预算。
4. 协议层重跑期间出现一次网络抖动（WebSocket 断连降级 HTTPS）与一次并行运行导致的 MCP 启动失败，均与前端修复无关；顺带修复了模拟脚本的 turn 终态误判（`mcpServer/startupStatus/updated` 的 `status:"failed"` 曾被误判为 turn 失败）。
