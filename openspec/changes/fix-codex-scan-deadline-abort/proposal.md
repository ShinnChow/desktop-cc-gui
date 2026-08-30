# Proposal: fix-codex-scan-deadline-abort

## Why

Windows 生产 0.9.3 实测（2026-08-27 用户 diagnostics.json）：`thread/list codex catalog timeout` 30s 超时 129 次/49min、扫描 100% 打满超时。后端 `list_codex_session_summary_list_for_workspace_with_mode` 用 `timeout(LOCAL_SESSION_SCAN_TIMEOUT=60s, spawn_blocking(...))` 包裹扫描——**timeout 只放弃 JoinHandle，扫描线程继续 open/read 到自然结束**（ThreadPreview ≤256KB/文件 × ≤200 候选/根 × 多 sessions root + `session_index.jsonl` 全量解析）；Windows Defender 实时扫描把单文件 open 放大数十 ms，一次已被前端放弃的扫描可继续拖数分钟，与下一次扫描叠加成 IO 风暴，同进程 WebView 被拖死（用户感知「codex 扫文件爆卡」）。

前端退避（fix-thread-list-timeout-backoff，b68931401）已把重试频率从 ~60s 拉长到指数退避，但**单次扫描的失控读盘**仍需内层截止兜底。

## What Changes

- `src-tauri/src/local_usage.rs`：
  - `scan_codex_session_summaries_bounded_with_mode` / `parse_codex_candidates_into_summaries` 增加 `scan_deadline: Option<Instant>` 参数；
  - 两条列表热点路径（workspace list / global list，即前端 catalog 与 sidebar 列表背后的路径）传 `Instant::now() + CODEX_LIST_SCAN_DEADLINE(32s)`——对齐前端 catalog 30s timeout + 2s 余量；
  - parse 循环每个候选检查一次 deadline，超期返回 `Err(CODEX_SCAN_DEADLINE_EXCEEDED)`，线程真正停止读盘；Err 语义与现有外层 timeout Err 一致（不落 fresh、不 commit partial）。
- 其余调用方（session-index writer `scan_codex_session_summaries_for_index` / Full 模式 / day-dir backfill）显式传 `None`，行为不变。
- collect 阶段维持既有 bounded caps（≤200 候选/根）不动。

## Impact

- 受影响 spec：`backend-scan-cache`（ADDED requirement）
- 风险：deadline 触发的 Err 与外层 60s timeout 同语义，前端已有 last-good + 冷却 + 指数退避降级链；无新状态面。
- Affected code：`src-tauri/src/local_usage.rs`、`src-tauri/src/local_usage/tests.rs`
- Out of scope：claude 磁盘列表同类治理、native titles 跨调用缓存、mtime 门控（后续单独开 change）。
