# Change: fix-claude-slash-command-title-truncation-omission

## Why

用户反馈（2026-08-27，0.9.3，desktop-cc-gui 项目）：workspace 的 Claude 会话列表恒为 0 条，点「重新加载」也刷不出来（其他客户端正常）。用户侧 AI 排查 + 仓库代码核实，根因在 `src-tauri/src/session_index/writers.rs` 的 title 截断与控制面剔除的执行顺序：

1. 该项目两个 claude jsonl 会话的首条用户消息都是 `/brainstorming` slash command 信封：`<command-message>brainstorming</command-message>\n<command-name>/brainstorming</command-name>\n<command-args>…真实内容…</command-args>`，固定前缀约 90 字符。
2. `peek_claude_first_user_preview()` 在 **完整文本** 上判过 `is_claude_control_or_synthetic_user_text`（args 非空 → 正确放行），随后 `truncate_title(preview, 80)` 把 title 截断——**80 字符内截不到 `<command-args>` 标签对**。
3. `should_omit_claude_index_row()` → `is_claude_control_plane_title()` 对这个**被截断的 title** 再判一次：`starts_with("<command-")` 且 `has_non_empty_command_args` 找不到完整标签对 → 误判为「空参数裸命令」（控制面文本）→ 整条会话从索引剔除，**连 upsert 都不执行**。
4. 放大条件：`~/.claude/history.jsonl` 无 cwd 匹配记录 → `title_from_history` 恒空 → 必然走 jsonl 预览分支，无回退路径。

本质：同一段文本被「完整态」和「截断态」各判一次，截断破坏了 `<command-args>` 标签结构导致二次判定结论相反。与在途 change `fix-sidebar-reload-force-index-sync`（前端重载强制 rescan）互补：那个解决「扫描不跑」，本 change 解决「跑了也被过滤器吃掉」。

## What Changes

- **F1 slash-command 预览先还原 prompt 再截断（writers.rs）**：`peek_claude_first_user_preview()` 在 `truncate_title` 之前，先用现成的 `crate::engine::claude_history_entries::extract_command_prompt_text()`（前端 `extractCommandMessagePromptText` / `claude_history.rs` history 路径同一语义）把 command 信封还原为 prompt 文本：优先 `<command-args>` 内容，回退 `command-message` / `command-name`。效果：① 截断后 title 不再以 `<command-` 开头，`should_omit_claude_index_row` 二次判定不再误伤；② title 直接展示用户真实 prompt，不再是一坨 XML 标签（UX 顺带修复）。
- **F2 回归测试（writers.rs 内嵌 tests）**：首条消息为超 80 字符前缀 command 信封的 jsonl → `claude_index_row_from_file` 返回 `Some` 且 title 为 args 内容；同测内断言裸命令（无 args）维持剔除语义不变。

## Capabilities

### Modified Capabilities

- `claude-session-sidebar-state-parity`：ADDED requirement——Session Index 写入侧 MUST 先还原 slash-command prompt 再截断 title，控制面剔除判定 MUST NOT 作用在被截断破坏标签结构的 title 上。

### Non-Goals

- 不改 `is_claude_control_or_synthetic_user_text` / `has_non_empty_command_args` 判定语义本身（对完整文本是正确的）。
- 不重构 `should_omit_claude_index_row` 的双重判定结构（风险大；用「提取后 title 不再以标签开头」达成两次判定结论一致）。
- 不动 `empty_prune.rs` 与 `peek_claude_transcript_kind`（均用完整文本判定，无此 bug）。
- 不动 history title 路径（`claude_history.rs:980` 已用 `extract_command_prompt_text`）。
- 不动 `is_mossx_program_control_text` 的 protocol_raw 分支（只看 `MOSSX_` 前 6 字符，截断不破坏）。
- 不合并前端 `fix-sidebar-reload-force-index-sync`（不同层，互补关系）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Rust | `src-tauri/src/session_index/writers.rs`（1 个函数 + 复用既有 helper，零新增依赖） |
| 测试 | writers.rs 内嵌 tests 新增 1 个用例（两断言面） |
| 行为变化 | slash-command 首条消息的会话从「整条剔除」变为「正常入索引，title = prompt 内容」——这正是修复目标 |
| 兼容性 | 无 schema / IPC 变更；被误删的存量会话在下次 rescan/importer tick 后自然回索引 |

## Acceptance

1. 首条用户消息为带非空 `<command-args>` 的 slash command 信封（固定前缀 > 80 字符）的 claude jsonl，`claude_index_row_from_file` MUST 返回 row 且 title 为 args 内容（超预算截断）。
2. 裸命令（无 args）会话维持既有剔除语义（不入索引）。
3. `cargo test --lib session_index::` 全绿；`rustfmt --edition 2021 --check` 对 writers.rs 保持 clean（HEAD 即 clean）。
4. `openspec validate fix-claude-slash-command-title-truncation-omission --strict` 通过。
