# Tasks: fix-claude-slash-command-title-truncation-omission

## 1. Rust 修复（TDD）

- [x] 红：`writers.rs` 内嵌 tests 新增 `claude_slash_command_session_survives_truncated_title_omission`——jsonl 首条用户消息为 `/brainstorming` 信封（固定前缀 > 80 字符 + 非空 args），断言 `claude_index_row_from_file` 返回 `Some` 且 title 为 args 内容；同测断言裸命令 `/resume`（无 args）依旧 `None`。
- [x] 绿：`peek_claude_first_user_preview()` 在 `truncate_title` 前调用 `crate::engine::claude_history_entries::extract_command_prompt_text()` 还原 prompt（附注释说明截断破坏标签结构会被 `should_omit_claude_index_row` 误判）。

## 1b. 边界加固：mid-text 引用标签不提取（2026-08-27 追加）

- [x] 红：`claude_history_inline_tests.rs` 新增 `command_prompt_text_leaves_mid_text_command_tag_quotes_alone`——普通消息正文引用 `<command-args>deploy prod</command-args>`（开发者贴 transcript 排查场景），断言标题保持原文；前导空白后的真信封仍提取。
- [x] 绿：`extract_command_prompt_text()` 触发条件从 `contains("<command-")` 收紧为 `trim_start().starts_with("<command-")`（与 `is_claude_control_or_synthetic_user_text` 的信封前缀谓词对齐）。`writers.rs` peek 路径与 `claude_history.rs` 标题路径两处调用同时受益。

## 2. 验证

- [x] `cargo test --lib session_index::writers` 全绿（15/15，含新增 1 个）。
- [x] `cargo test --lib command_prompt_text` 2/2；`claude_history` 套件 61 passed（HEAD worktree 对照 9 个存量失败逐条一致，零新增红）；`session_index` 全量 83/83。
- [x] `rustfmt --edition 2021 --check src-tauri/src/session_index/writers.rs` 保持 clean。
- [x] `openspec validate fix-claude-slash-command-title-truncation-omission --strict` 通过。

## 3. 收尾

- [x] `openspec/changes/README.md` 索引行（只挂本 change 自己的行）。
- [ ] 用户侧存量恢复验证口径：删 `session_index_backfill` / `session_index_sources` 行触发重扫，或等 importer 90s tick——本修复后 upsert 不再被吞。
