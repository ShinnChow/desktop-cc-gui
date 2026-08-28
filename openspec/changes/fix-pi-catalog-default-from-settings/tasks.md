# Tasks: fix-pi-catalog-default-from-settings

## 1. Backend（`src-tauri/src/engine/status.rs`）

- [x] 1.1 新增 `read_pi_default_model_selection(home_dir: Option<&Path>) -> Option<(Option<String>, String)>`：读 `<agent>/settings.json`，返回 `(defaultProvider, defaultModel)`；缺文件 / JSON 损坏 / 非字符串 / trim 空串 → `None`
- [x] 1.2 新增通用 `promote_default_model(models: &mut Vec<ModelInfo>, default_id: &str) -> bool`：清全部 `default` → 命中 `id` 标 default 并移到 index 0；未命中返回 `false` 且列表零变化
- [x] 1.3 `get_pi_models` 汇合点接线 `promote_pi_default_from_settings`：候选 id 依次 `{provider}/{model}` → 裸 `{model}`（`pi_default_candidate_ids` 纯函数）；parse 函数与三条取数路径本体不动
- [x] 1.4 单测：settings 解析矩阵（正常 / 缺文件 / 损坏 / 空串 / 仅 defaultModel / 非字符串）；promote 语义（命中置顶清旧标记 / 未命中零变化）；候选 id 回退顺序（含空白 provider 防御）
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib pi_default`（6/6）+ `engine::status` 全量 47/47

## 2. 验证与收口

- [x] 2.1 `cargo test --manifest-path src-tauri/Cargo.toml --lib`：改动域全绿；全量 15 失败经 stash 基线复核均为存量（claude_history / runtime / session_management / dsh supervisor），与本 change 无关
- [x] 2.2 `rustfmt --edition 2021 --check src-tauri/src/engine/status.rs` 通过（diff 仅本 change 改动区域）
- [ ] 2.3 真机验收：重启打包 app → 切到无账本 pi 会话（如「你家」）→ composer 显示 `kimi-coding / k3` 而非 `anthropic / claude-fable-5`；打开 pi 模型选择器 default 勾选位正确
- [x] 2.4 `openspec validate fix-pi-catalog-default-from-settings --strict --no-interactive` 通过；archive 前 sync `provider-model-catalog-refresh` 主 spec
