# Change: fix-diagnostics-forensics-hardening

## Why

`enhance-perf-diagnostics-evidence` 落地后的第一轮真机日志（2026-08-28 15:19–18:01，27 次切换 / 28 个热点窗口）验证了证据链生效，同时暴露三个取证缺陷与一条无法离线破案的悬案——本 change 补齐证据并修复已知问题：

1. **`componentFrames` 全空（7/7 次 error-boundary 崩溃定位失效）**。真机 payload `componentStack: "[redacted]"`（非空）但 `componentFrames: []`。侦查结论（jsdom + React 19.2.7 真实渲染验证）：现行正则对 dev（`at Name (file:line:col)`）与生产（`at Name`）格式**均能解析**；真机 0 帧的唯一剩余解释是**匿名组件帧**——React 对无 displayName 组件输出 `at <anonymous>`，正则 `[A-Za-z0-9_$]+` 不匹配 `<` 开头 token，整棵匿名组件树全帧被丢。缺一个「stack 行数」证据字段导致此前无法区分「stack 为空」与「格式不匹配」。
2. **`perf.frame-drop-worst` 落盘丢归因**。worst-K 条目的 `hotspots` 位于 payload 第 4 层，被 `MAX_DIAGNOSTIC_PAYLOAD_DEPTH = 4` 截成 `["[truncated]"]`——磁盘版只剩 deltaMs，掉帧瞬间的热点归因丢失（「重启不丢」承诺打折）；且 `at` 字段误用 `performance.now()` 相对值，无法对钟点时间。
3. **worker 崩溃指纹 `1wt84ny`（45 字符 / Error / pos 64:23）离线不可破案**。两轮 hash 候选轰炸（含 45+ 条候选消息 + 真实 compile 管线对 10 类重内容轰炸）全部未命中；错误来自 worker 环境特有路径（vite dev 模块加载或依赖差异），主线程无法复现。当前 `filename` 字段被整条 redact，**抛错模块这一关键定位信息完全缺失**——补 `sourceModule`（basename）/`sourceLine`/`sourceCol` 结构化字段后，下一轮日志可直接定位模块，不再依赖用户提供 console 文本。

## What Changes

- **F1 componentFrames 匿名帧兜底 + 行数证据**：解析正则增加 `<anonymous>`/`<wrapper>` 等尖括号匿名帧（记为 `"anonymous"`）；`react/error-boundary*` payload 增补 `componentStackLineCount`（数字计数，过 sanitize），使「stack 为空」与「格式不匹配」可区分。
- **F2 worst-K 归因存活 + 钟点时间**：`perf.frame-drop-worst` 条目的 `hotspots` 落盘前**扁平化为字符串数组**（`"react-commit=317ms(max 214 update)x229"` 形态，位于第 3 层，深度限制内存活）；`at` 改用 epoch（`Date.now()`）可直接对钟点。
- **F3 错误源模块证据**：`window/error` 与 `fast-markdown-worker/failed` payload 增补 `sourceModule`（`event.filename` 的 basename，模块 URL 无用户内容）/ `sourceLine` / `sourceCol`——下一轮日志直接读出「哪个模块哪一行抛的 1wt84ny」。
- **F4（文档）**：`fix-session-load-bridge-freeze` 提案补「pi 固定链路成本」调查任务（真机实测 3 条消息的 pi 会话切换也需 1563ms——体量无关的固定成本，嫌疑 `resolve_session_file` 全目录扫描；raw-string 只救大头）。

## Capabilities

### Modified Capabilities

- `client-storage-performance`（Diagnostics Retention 域）：
  - MODIFIED requirement「Error Diagnostics MUST Carry Structured Attribution Fields」——增补 componentStackLineCount 与错误源模块字段（sourceModule/sourceLine/sourceCol）；
  - MODIFIED requirement「Frame Drop Evidence MUST Survive Restart」——worst-K 条目的热点归因 MUST 在持久化 sanitize 深度限制内存活（扁平化字符串形态），时间戳 MUST 为 epoch。

## Non-Goals

- **不放松 sanitize 深度限制本体**（4 层策略防深递归 payload，属安全边界）。
- **不在线上追查 1wt84ny 消息本体**（离线候选已穷尽；sourceModule 字段落地后由下一轮真机日志定位）。
- **不修 pi 固定链路成本**（F4 只补提案调查任务；实施归 fix-session-load-bridge-freeze）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `services/rendererDiagnostics.ts`（帧解析 + source 字段 + helper）、`services/perfBaseline/frameDropMonitor.ts`（worst-K 扁平化 + epoch）、`components/ErrorBoundary.tsx`（lineCount 字段） |
| 隐私 | sourceModule 为模块文件名 basename（代码标识符，无用户内容）；componentStackLineCount 为纯数字；不进分享白名单 |
| 验证方式 | TDD 先红后绿：React 19 真实格式 fixture（含 `<anonymous>` 帧）+ worst-K 深度存活断言 + sanitize 存活断言 |

## Acceptance

- **A1（F1）**：含 `at <anonymous>` 帧的 componentStack 解析出 `["anonymous", ...]` 而非空数组；error-boundary payload 含 `componentStackLineCount`。
- **A2（F2)**：落盘后的 `perf.frame-drop-worst` 条目含可读的热点字符串数组（非 `[truncated]`）；`at` 为 epoch 毫秒（可直接换算钟点）。
- **A3（F3）**：`window/error` 与 worker 崩溃诊断 payload 含 `sourceModule`/`sourceLine`/`sourceCol`，且经持久化 sanitize 后存活、`filename` 本体仍 redacted。
- **A4（F4）**：`fix-session-load-bridge-freeze` tasks 含 pi 固定链路成本调查项。
- **A5（回归）**：rendererDiagnostics / perfBaseline / ErrorBoundary 相关面全绿；typecheck 0；分享报告文本不含新字段依赖。
