# verification · add-pi-models-json-config

> 2026-08-27 收口补充（L1 归档批次）。15/15 task 已完成；3.3 以 headless 等价验证收口。

## Evidence

- 实现：`src-tauri/src/engine/pi_models_config.rs`（JSONC 剥注释、loose validation、`providers` 包裹 schema、0600 原子写）；前端 `PiProviderAuthSection` raw-text 编辑器 + invoke mock 测试（read 正常/parseError/不存在、write 成功/校验拒绝）。
- **3.3 headless 等价验证（2026-08-27，pi@0.84.3）**：
  1. Grok 中转可见可选：临时 `PI_CODING_AGENT_DIR`（`mktemp` 目录，未触碰用户真实 `~/.pi`）写入 `openai-responses` API 的 Grok 中转 provider（`providers` 包裹 schema + dummy key）→ `pi --list-models --no-extensions` 输出 `mossx-grok-relay grok-4-relay 131.1K 8.2K yes no`——models.json 自定义 provider 进入 pi 模型选择面（`/model` 同源数据）。
  2. 坏 JSON 拒写且原文件不变：`write_pi_models_config` 先 `validate_models_config_text` 再 tmp+rename 原子替换（源码注释「on ANY failure the existing file stays byte-identical」）；`validation_rejects_hard_errors` 单测覆盖 `{ not json` / 非 object providers / models 非数组 / 缺 id 等硬错误。

## Waiver

- 3.3 的「GUI 保存按钮目测」未人工执行：编辑器是已测 Tauri command（`pi_models_config_write`）的薄壳，行为由上述代码构造 + 单测 + headless pi 侧验证覆盖。documented waiver，不阻塞 archive。
- 顺带发现（已核实非缺陷）：pi 0.84.3 models.json 必须用 `{"providers": {...}}` 包裹——客户端校验/模板本就按包裹 schema 实现，无漂移。
- ADR 校准回写 Gate：不命中基石文档「更新触发器」，无需校准行。
