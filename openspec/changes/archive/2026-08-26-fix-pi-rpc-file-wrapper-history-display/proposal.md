## Why

PI RPC 时代（0.9.3 主线）mossx 在 `expand_rpc_prompt_attachments` 自注入 `<file path="...">正文</file>` 文本附件包装并持久化进 pi session JSONL，但历史回放剥离器 `split_pi_file_attachments_for_display` 只认 print-json 时代 pi CLI 的 `<file name="..."` 属性名。结果：带 `@文件` 的 RPC 会话回放时，整段文件正文（单文件可达 128KB）原样泄漏进消息气泡；侧栏标题通道 `read_session_summary` 同受此害（2026-08-25 用户截图报告）。

发送侧与回放侧各写了一半协议（`path=` vs `name=`），且没有任何测试跨「注入 → 持久化 → 回放」全链路，单测全绿拦不住。

## 目标与边界

- 回放剥离器同时识别 `<file name="` 与 `<file path="` 两种包装，print-json 时代行为零回归。
- 剥离出的**非图片**附件路径（RPC 文本附件）MUST NOT 进 `images`（前端 `MessageMediaBlocks` 无扩展名过滤，会渲染成裂图 chip，且 either/or 逻辑会顶掉同条消息 content-block 里的真实图片）；以 `@路径` 形式回到可见正文，保留用户可感知的附件引用。
- 图片 wrapper 路径继续进 `images` 并抑制 content-block base64 二次投影（既有 spec 语义不变）。
- 侧栏标题通道随剥离器修复自动受益，无需改动。

## What Changes

- `cli_image_input.rs`：`split_pi_file_attachments_for_display` 属性名宽容化（新增 `find_file_wrapper_open` 定位 `<file name="`/`<file path="`，两者等长前缀）；新增 `is_image_attachment_path` 共享判定。
- `pi_history.rs`：`split_pi_user_content_for_display` 对 wrapper 路径按图片/非图片分流——图片进 `images`，非图片以 `@路径` 回到正文；仅当存在图片 wrapper 时才抑制 content-block 投影。
- OpenSpec spec delta：`pi-rpc-session-runtime` 新增 Requirement。
- 测试：cli_image_input 三个 `path=` 单测；pi_history 一个 RPC 时代端到端 load 测试 + 一个标题剥离测试。

## 非目标

- 不改 RPC 注入格式本身（`<file path>` 继续作为发送侧协议）。
- 不修 RPC 图片大图 spill 临时文件跨会话可访问性（「Image 1」裂图属独立链路，另行评估）。
- 不动 print-json 时代已锁定的 images 语义（图片 wrapper 路径优先进 images）。

## 方案取舍

| 选项 | 说明 | 取舍 |
| ------ | ------ | ------ |
| A 只让剥离器认 `path=`，路径照旧全进 images | CHANGELOG.md 会渲染成裂图 chip 且顶掉真实图片 | 否 |
| **B 剥离 + 图片/非图片分流，非图片回正文（选定）** | 正文干净、图片不丢、附件引用可见 | 是 |
| C 非图片附件路径直接丢弃 | 纯附件消息会从历史消失（空 text + 空 images 被 skip） | 否 |

## Capabilities

### Modified Capabilities

- `pi-rpc-session-runtime`: 历史回放 MUST 剥离两种附件包装属性名；非图片附件路径 MUST NOT 进 images。
