# Design: fix-pi-rpc-file-wrapper-history-display

## 背景

发送侧与回放侧的附件包装协议在两个时代分裂：

| 时代 | 注入方 | 包装格式 | 持久化位置 |
| ------ | -------- | ---------- | ----------- |
| print-json | pi CLI file processor | `<file name="/abs/..">` | session JSONL user text block |
| RPC（0.9.3 主线） | mossx `expand_rpc_prompt_attachments`（pi.rs:572） | `<file path="/abs/..">正文</file>` | 同上 |

回放剥离器 `split_pi_file_attachments_for_display` 只认 `name=`，RPC 时代包装整块泄漏。

## 决策

### D1：剥离器属性名宽容化，不改注入格式

`find_file_wrapper_open` 扫描 `<file` 后接 `name="` 或 `path="`。两者前缀等长（12 字节），后续 `quote_end` / `open_tag_end` / `inner_start` 绝对偏移换算逻辑原样复用（含 2026-08-24 中文路径 panic 回归纪律）。注入侧 `<file path>` 不动——它是 pi RPC prompt 的既定协议，改动会牵连发送链路。

### D2：非图片 wrapper 路径以 `@路径` 回正文，不进 images

前端 `MessageMediaBlocks` 对 `images[]` 逐项渲染 `<img>`，无扩展名过滤。若 `.md` 路径进 images：

1. 渲染成裂图 chip；
2. `split_pi_user_content_for_display` 的 either/or 逻辑（`if !wrapper_images.is_empty() { return }`）会顶掉同条消息 content-block 里的真实图片（截图消息正是「图片 + 文本附件」混合）。

`@路径` 回正文的理由：`extract_at_file_references` 在注入时把用户输入的 `@文件` token 从正文移除并追加 wrapper；回放时把路径还原为 `@路径` 文本是最贴近用户原始输入的投影，且保证「纯附件消息」不会因空 text + 空 images 被 `load_pi_session` skip 掉。

### D3：图片 wrapper 语义不变

图片 wrapper 路径（`<file name="*.png">`，print-json 时代）继续进 images 并抑制 content-block base64 二次投影（`pi-rpc-session-runtime` 既有 Scenario「RPC 历史回看 MUST 还原用户附图」的锁定语义）。

### D4：侧栏标题通道零改动

`read_session_summary` 与 `load_pi_session` 共用同一剥离器；标题只取文本，非图片路径是否回正文不影响标题正确性（纯附件消息标题继续走 `attachment_title_marker` 的 `[附件]` 兜底）。

## 风险

- `@路径` 回正文改变了 print-json 时代「图片+文本混合 wrapper」消息的可见文本（以前非图片路径进 images 渲染裂图，现在回正文）——属于既有破窗的修复，可接受。
- `<file path=` 出现在用户正文非附件语境（用户手打 XML）会被误剥：与既有 `name=` 行为同级风险，接受。
