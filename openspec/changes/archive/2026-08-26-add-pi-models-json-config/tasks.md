# Tasks: add-pi-models-json-config

## 1. Backend

- [x] 1.1 新建 `src-tauri/src/engine/pi_models_config.rs`：路径解析（home override → `PI_CODING_AGENT_DIR` → `~/.pi/agent/models.json`）
- [x] 1.2 `pi_models_config_read`：原文 + 摘要列表 + parseError 容错 + 空文件时返回默认模板
- [x] 1.3 宽松校验函数：JSONC 可解析 / `providers` 为对象 / `models` 为数组且项含字符串 `id`
- [x] 1.4 `pi_models_config_write`：校验通过 → 同目录 tmp + rename 原子写入，Unix 0600；失败不触碰原文件
- [x] 1.5 注册 Tauri commands（对齐 `pi_auth_*` 注册点）
- [x] 1.6 单测：校验矩阵、原子写入、权限位、校验失败原文件不变、路径优先级、JSONC 注释与未知字段保留
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib pi_models_config`

## 2. Frontend

- [x] 2.1 `src/services/tauri/piModelsConfig.ts`：类型 + `piModelsConfigRead` / `piModelsConfigWrite`
- [x] 2.2 `PiProviderAuthSection.tsx` 第三组「自定义供应商」：只读列表 + 空态 + parseError 横幅
- [x] 2.3 「编辑配置」展开 textarea 编辑器：空文件预填模板、保存 / 取消 / 行内错误、保存后刷新
- [x] 2.4 i18n zh + en（`settings.vendor.piAuth.*`）
- [x] 2.5 样式：`settings.vendor-pi-auth.css` 增 textarea 等类，复用现有卡片 / 按钮体系
- [x] 2.6 前端测试：invoke mock 覆盖 read（正常 / parseError / 不存在）与 write（成功 / 校验拒绝）

## 3. OpenSpec

- [x] 3.1 创建 change `add-pi-models-json-config`（proposal / design / tasks / specs）
- [x] 3.2 `openspec validate add-pi-models-json-config --strict --no-interactive` 通过
- [x] 3.3 手测：配一个 Grok 中转（openai-responses）→ 保存 → pi `/model` 可见可选；故意写坏 JSON → 保存被拒且原文件不变【2026-08-27 收口以 headless 等价验证代替 GUI 目测，waiver 记录于 verification.md：① 临时 `PI_CODING_AGENT_DIR` 写入 openai-responses Grok 中转（`providers` 包裹 schema）→ `pi --list-models --no-extensions`（pi@0.84.3）列出 `mossx-grok-relay grok-4-relay`；② 坏 JSON 拒写由 `write_pi_models_config` 先校验后原子替换保证（`pi_models_config.rs`「on ANY failure the existing file stays byte-identical」），`validation_rejects_hard_errors` 单测覆盖；GUI 编辑器为已测 Tauri command 的薄壳】
