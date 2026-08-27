# Tasks

## 1. Rust 探测层修复

- [x] 1.1 `fetch_pi_models_via_rpc`：custom args 加 `--no-extensions`（`--no-session --no-extensions`），附 why 注释（extension boot ~10s 撞爆预算）
- [x] 1.2 `get_pi_models` list-models 分支：抽 probe helper，先带 `--no-extensions`，失败无 flag 重试一次，两次皆败才 generated fallback；保留原诊断字符串语义
- [x] 1.3 单测：args 构造 helper 断言（flag 存在性），不改既有 parse 测试
- [x] 1.4 新增 `PI_CATALOG_PROBE_TIMEOUT = 15s` 圈住 PI catalog 探测两跳（RPC 请求 + `--list-models`）；version 探测与其他引擎维持全局 `DETECTION_TIMEOUT(10s)`；单测锚点同步钉死 15s 预算（用户验收后追加：10s 红线放宽为 15s 兜底，其他不变）

## 2. 验证

- [x] 2.1 `cargo test --lib`（pi 相关 213 passed；`pi_auth::list_missing_file_is_all_none` 为 HEAD 上即失败的环境依赖存量问题，与本改动无关，已用 stash 对照确认）
- [x] 2.2 `rustfmt --edition 2021 --check src-tauri/src/engine/status.rs` CLEAN（仅本 hunk 区域）
- [x] 2.3 本机实测（pi 0.84.3 + 全量扩展）：RPC `--no-session --no-extensions --mode rpc` 0.99s / 19 models 全带 reasoning + thinkingLevelMap；`--list-models --no-extensions` 0.65s / 20 行（原 10.68s / 9.28s）
- [x] 2.4 用户目视验收通过（2026-08-26）：模型列表恢复、思考强度选择器恢复
