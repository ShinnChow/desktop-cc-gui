## 1. 后端修复

- [x] 1.1 [P0] `cli_image_input.rs`：`split_pi_file_attachments_for_display` 同时识别 `<file name="` / `<file path="`（新增 `find_file_wrapper_open`；保留多字节路径绝对偏移换算纪律）；新增 `pub(crate) fn is_image_attachment_path`。
- [x] 1.2 [P0] `pi_history.rs`：`split_pi_user_content_for_display` wrapper 路径分流（图片 → images；非图片 → `@路径` 回正文；仅图片 wrapper 存在时抑制 content-block 投影）。

## 2. 测试

- [x] 2.1 [P0] cli_image_input：`path=` 剥离、name/path 混合、path 多字节不 panic。
- [x] 2.2 [P0] pi_history：RPC 时代端到端（text + `<file path>` wrapper + image content block → 正文干净、图片保留、md 路径以 `@` 回正文且不进 images）；`read_session_summary` 标题剥离 `path=` 包装。

## 3. 验证

- [x] 3.1 [P0] focused cargo test（cli_image_input + pi_history）。
- [x] 3.2 [P0] `rustfmt --edition 2021 --check` 仅改动文件。
- [x] 3.3 [P0] OpenSpec validate。
- [x] 3.4 [P1] 用户目视验收：重开截图中的会话，确认正文干净、图片 chip 正常、`@CHANGELOG.md` 引用可见。
