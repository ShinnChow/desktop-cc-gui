# Tasks: fix-diagnostics-forensics-hardening

## 1. F1 componentFrames 匿名帧 + lineCount（TDD）

- [ ] 1.1 红测试：`rendererDiagnostics.attribution.test.ts`——`at <anonymous>` 帧解析为 `"anonymous"`（dev 带 file:line:col 与生产裸格式两种 fixture）；ErrorBoundary 上报含 `componentStackLineCount`。
- [ ] 1.2 实现：正则兜底尖括号帧 + ErrorBoundary 增补 lineCount 字段。

## 2. F2 worst-K 归因存活 + epoch（TDD）

- [ ] 2.1 红测试：`diagnosticsRecorders.test.ts`——worst-K 持久化条目 `hotspots` 为字符串数组（含 category/totalMs）；`at` 为 epoch（>1e12 判定）。
- [ ] 2.2 实现：`frameDropMonitor` 落盘前扁平化 + `Date.now()`。

## 3. F3 错误源模块证据（TDD）

- [ ] 3.1 红测试：`window/error` payload 含 `sourceModule`/`sourceLine`/`sourceCol`（取自 event.filename basename + lineno/colno），经持久化 sanitize 存活、`filename` 仍 redacted；worker 崩溃诊断同字段。
- [ ] 3.2 实现：`rendererDiagnostics.ts` 安装段 + `workerAdapter` 指纹扩展。

## 4. F4 提案补任务（文档）

- [ ] 4.1 `fix-session-load-bridge-freeze` tasks/proposal 补「pi 固定链路成本」调查项（3 条 items 1563ms 实测依据）。

## 收口

- [ ] 5.1 全量验证（相关面 vitest + typecheck）+ 分批 commit；`openspec validate --strict`；索引更新。
- [ ] 5.2 下一轮真机日志验证 sourceModule 直接定位 1wt84ny 抛错模块（回填本 tasks）。
