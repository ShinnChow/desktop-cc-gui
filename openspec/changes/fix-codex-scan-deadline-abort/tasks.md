# Tasks: fix-codex-scan-deadline-abort

- [x] 1.1 立项：proposal + backend-scan-cache spec delta，`openspec validate --strict` 通过
- [x] 1.2 TDD：新增测试 `bounded_scan_expired_deadline_aborts_before_parsing_candidates`（expired → Err 且不开文件；future → 行为不变）
- [x] 1.3 实现：`scan_deadline: Option<Instant>` 参数贯通 `bounded_with_mode` / `parse_codex_candidates_into_summaries`；workspace/global 两条列表热点路径传 `Instant::now() + 32s`；其余调用方显式 `None`
- [x] 1.4 验证：`cargo test --lib local_usage::` 全绿（含 deadline 新测）、既有 2 处测试调用点补 `None` 后语义不变、rustfmt 本 hunk clean（1846/1994 为存量脏区）
- [x] 1.5 提交（仅本 change 文件），README 登记
