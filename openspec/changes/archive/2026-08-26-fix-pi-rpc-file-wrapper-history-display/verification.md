# verification · fix-pi-rpc-file-wrapper-history-display

> 2026-08-27 收口补充（L1 归档批次）。8/8 task 已完成。

## Evidence

- 实现事实源：commit `06c5e7545`（fix(pi): 历史回放剥离 RPC 时代 `<file path>` 附件包装并按图片/非图片分流）；`src-tauri/src/engine/pi_history.rs`（附件包装剥离、图片 block → data URL / temp file 分流、`[图片]`/`[附件]` 标题标记）。
- 单测：`pi_history.rs` 10 + 3 title 测试（RPC 时代图片 / file wrapper 回放锚定）。
- 不命中基石文档「更新触发器」，无需 ADR 校准行。

## Waiver

- 无。
