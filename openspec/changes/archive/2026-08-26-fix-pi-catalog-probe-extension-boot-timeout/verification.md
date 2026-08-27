# verification · fix-pi-catalog-probe-extension-boot-timeout

> 2026-08-27 收口补充（L1 归档批次）。8/8 task 已完成；本文件补齐 evidence 与 spec delta（收口时按 OpenSpec 纪律补写，见 Waiver 说明）。

## Evidence

- 实现落地：commit `29dc592ed`（fix(engine): PI catalog 探测跳过 extension boot 并放宽预算至 15s 根除 auto-only 降级）；用户实证环境 pi@0.84.3 多扩展下 RPC 探测 10.68s → 0.99s、`--list-models` 9.28s → 1.02s，模型 19/19 与元数据一致。
- 代码事实源：`src-tauri/src/engine/status.rs` 的 `PI_CATALOG_PROBE_RPC_ARGS`（`--no-session --no-extensions`）、`PI_CATALOG_PROBE_TIMEOUT = 15s`、`get_pi_models` 三层回退链；真实会话 resident（`src-tauri/src/engine/pi_rpc.rs` spawn）不带 `--no-extensions`。
- 单测锚点：`pi_catalog_probe_rpc_args_skip_session_and_extension_boot`（args 与 15s 预算钉死）。

## Waiver

- proposal 阶段未写 spec delta（视为 probe 参数/budget 的工程修复）；收口时补写 ADDED requirement 至 `provider-model-catalog-refresh` 并随 archive 同步主 spec，避免契约只活在 proposal 的「Fixed Design」节里。
- ADR 校准回写 Gate：不命中基石文档「更新触发器」，无需校准行。
