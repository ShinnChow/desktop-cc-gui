# Tasks: fix-claude-slash-command-title-truncation-omission

## 1. Rust 修复（TDD）

- [x] 红：`writers.rs` 内嵌 tests 新增 `claude_slash_command_session_survives_truncated_title_omission`——jsonl 首条用户消息为 `/brainstorming` 信封（固定前缀 > 80 字符 + 非空 args），断言 `claude_index_row_from_file` 返回 `Some` 且 title 为 args 内容；同测断言裸命令 `/resume`（无 args）依旧 `None`。
- [x] 绿：`peek_claude_first_user_preview()` 在 `truncate_title` 前调用 `crate::engine::claude_history_entries::extract_command_prompt_text()` 还原 prompt（附注释说明截断破坏标签结构会被 `should_omit_claude_index_row` 误判）。

## 2. 验证

- [x] `cargo test --lib session_index::writers` 全绿（15/15，含新增 1 个）。
- [x] `rustfmt --edition 2021 --check src-tauri/src/session_index/writers.rs` 保持 clean。
- [x] `openspec validate fix-claude-slash-command-title-truncation-omission --strict` 通过。

## 3. 收尾

- [x] `openspec/changes/README.md` 索引行（只挂本 change 自己的行）。
- [ ] 用户侧存量恢复验证口径：删 `session_index_backfill` / `session_index_sources` 行触发重扫，或等 importer 90s tick——本修复后 upsert 不再被吞。
