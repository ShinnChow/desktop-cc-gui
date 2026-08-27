# Delta: claude-session-sidebar-state-parity

## ADDED Requirements

### Requirement: Claude Session Index MUST Not Drop Slash-Command Sessions Via Truncated Titles

Session index 写入侧从 Claude jsonl 首条用户消息派生 title 预览时，MUST 先把 slash-command 信封还原为 prompt 文本（`<command-args>` 内容优先，回退 `command-message` / `command-name`）再做长度截断；控制面/合成文本的剔除判定 MUST 作用在标签结构完整的文本上，MUST NOT 作用在因截断而丢失 `<command-args>` 标签对的 title 上。

#### Scenario: slash-command session survives index upsert

- **WHEN** claude jsonl 首条用户消息是带非空 `<command-args>` 的 slash command 信封，且固定前缀（`<command-message>` + `<command-name>`）长度超过 title 截断预算
- **AND** `~/.claude/history.jsonl` 未提供该会话 cwd 匹配的 title（无 history 回退）
- **THEN** session index MUST upsert 该会话行（不得整条剔除）
- **AND** title MUST 展示 args 内的用户 prompt 文本（超预算时截断），MUST NOT 展示原始 XML 信封

#### Scenario: bare command sessions stay omitted

- **WHEN** claude jsonl 首条用户消息是无参数裸命令（如 `<command-name>/resume</command-name>`，无 `<command-args>` 内容）
- **THEN** 该会话 MUST 维持既有剔除语义，不进入 session index

#### Scenario: history-sourced titles keep existing pipeline

- **WHEN** `~/.claude/history.jsonl` 为该会话提供 cwd 匹配的 title
- **THEN** 既有 history title 路径（含其 command prompt 提取）MUST 保持不变
