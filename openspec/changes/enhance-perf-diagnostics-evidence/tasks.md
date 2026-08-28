# Tasks: enhance-perf-diagnostics-evidence

按批次 TDD（先红后绿），每批次独立 commit。

## Batch 1 崩溃取证结构化（F1/F2）

- [x] 1.1 红测试：`rendererDiagnostics.test.ts`（或 ErrorBoundary 相关测试）——`react/error-boundary` 落盘 payload 含 `errorName`/`messageHash`/`messageLength`/`componentFrames`，且 `error`/`componentStack` 仍 `[redacted]`；componentStack 多帧解析为组件名数组（≤12 帧）。
- [x] 1.2 实现：`ErrorBoundary.tsx` 三处上报增补结构化字段；componentStack → `componentFrames` 解析函数（放 rendererDiagnostics 导出，复用 clip）。
- [x] 1.3 红测试：`window/error` payload 含 `errorName`/`messageHash`/`messageLength` 且 `message` 仍 `[redacted]`；`unhandledrejection` 含 `reasonName`/`reasonHash`/`reasonLength`。
- [x] 1.4 实现：`rendererDiagnostics.ts` 安装段两处监听增补字段（`formatUnknown` 保持不动，新增指纹 helper）。
- [x] 1.5 Batch 1 验证：rendererDiagnostics 全量绿 + typecheck；commit `feat(diagnostics): 崩溃取证结构化——errorName/指纹/组件帧安全命名落盘`。

## Batch 2 新 recorder（F3/F4/F5）

- [x] 2.1 红测试：`frameDropMonitor` 相关测试——top-10 内新掉帧触发 `perf.frame-drop-worst`（60s 节流、降序、含 hotspots）；top-10 外不触发。
- [x] 2.2 实现：`frameDropMonitor.ts` worst-K 环 + 节流持久。
- [x] 2.3 红测试：`useThreadActions.test.tsx`——resume 完成后出现 `perf.thread-switch`（durationMs/itemCount/displayedCount/mode/engineSource/threadIdHash）。
- [x] 2.4 实现：`useThreadActionsResumeThread.ts` hydrate 段计时落盘（loader 发起→组合 action 后）。
- [x] 2.5 红测试：新 `hotspotSummaryRecorder` 测试——有样本 60s 内落 `perf.hotspot-summary`；无样本不写。
- [x] 2.6 实现：`services/perfBaseline/hotspotSummaryRecorder.ts`（60s 定时、受采集开关 gating、非空才写）+ 启动接线。
- [x] 2.7 Batch 2 验证：perfBaseline + threads 相关面全绿 + typecheck；commit `feat(diagnostics): worst-K 掉帧持久环、切会话计时证据与 hotspot 周期汇总`。

## 收口

- [x] 3.1 `openspec validate enhance-perf-diagnostics-evidence --strict --no-interactive` 通过；`openspec/changes/README.md` 索引更新。（Batch 1 commit 0aa8515e8：5+5 测绿；Batch 2 commit：F3/F5 5 测 + F4 1 测绿，useThreadActions 3 失败为 stash 基线复核过的存量）
- [ ] 3.2 真机复验（随 fix-session-switch-jank-red-lines 4.5 一并）：复现卡顿后检查 diagnostics.json 出现三类新证据且分享报告不含新 label。
