# Change: fix-pi-catalog-default-from-settings

## Why

2026-08-28 用户实测（0.9.4）：切到无账本 PI 会话（如「你家」`pi:01a04321`）时，composer 绑定并显示 `anthropic/claude-fable-5`，而该会话从未用过 claude。

根因在 Rust catalog parse 层：`parse_pi_models_output` 与 `parse_pi_available_models` 都以 `parsed.first_mut().default = true` 把**枚举第一个条目**标为 default。pi CLI 的模型枚举按 provider 字母序排列（anthropic < deepseek < kimi < …），所以「PI catalog 默认模型」恒等于 `anthropic/<该 provider 第一个模型>`——本机即 `anthropic/claude-fable-5`。pi settings 里真实的默认（`~/.pi/agent/settings.json` 的 `defaultProvider: "kimi-coding"` / `defaultModel: "k3"`）完全没有参与。

前端侧所有无账本会话的显示兜底（`getDefaultModelId` / `pickDefaultModel` → `models.find(isDefault)`）都会命中这个错误 default：显示 `anthropic / claude-fable-5`，且用户一旦在会话内点选模型/档位，`anthropic/claude-fable-5` 会被 `persistComposerSelectionForThread` 永久写进该 pi 会话账本；发送时 `nativeSessionTarget.model` 也把 claude 模型上送给 pi（用户未认证 anthropic，必然失败或走 fallback）。已排除 D4-Live / D6 闸2 的在途修复域——那两个修复的是 draft carry 跨引擎写账本，本缺陷是「无账本会话的 catalog default 兜底」选错模型，独立路径。

这是引擎目录的**共同特性**缺口：kimi（`config.toml` 的 `default_model`）、grok（`config.toml` 的 `models.default`）、gemini（ccgui 配置 / `GEMINI_MODEL`）都已在 parse 层接各自 CLI 的默认模型来源，pi 是唯一没有接 settings 的引擎。

## What Changes

- **Backend（`src-tauri/src/engine/status.rs`）**
  - 新增 `read_pi_default_model_selection(home_dir)`：读 `<agent>/settings.json` 的 `defaultProvider` / `defaultModel`，容错（文件缺失 / JSON 损坏 / 非字符串 / 空串 → `None`）。
  - 新增通用 `promote_default_model(models, default_id)`：清除全部 `default` 标记 → 命中 `id` 的条目标 default 并移到队首（与 grok / kimi 既有约定一致）；无命中返回 `false` 且**原列表零变化**（兼容回退）。
  - `get_pi_models` 三条取数路径（RPC `get_available_models` / `--list-models` 两跳 / generated fallback）汇合后统一应用：候选 id 依次尝试 `{defaultProvider}/{defaultModel}` → 裸 `{defaultModel}`；未命中 / 未配置 → 维持 parse 层现状（first 条目 default）。
  - parse 函数本体**不改**：first-entry default 保留为「settings 缺失时的兜底语义」，既有单测不漂移。
- **Frontend**：零改动。default 解析完全走 `ModelOption` 的 `isDefault` 标记，Rust 侧修正后显示 / 发送 / 账本写入链路自动收敛到 pi 真实默认。
- **存量脏数据**：已被写进账本的 `anthropic/*` 条目不在本 change 清洗（前端账本 normalize 属独立行为变更，另行立项）；本 change 落地后新增 / 无账本会话不再产生污染。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | 仅 `src-tauri/src/engine/status.rs`：2 个新函数 + `get_pi_models` 汇合点接线 + 单测 |
| Frontend | 零改动（显示链消费 `isDefault`，自动收敛） |
| 兼容性 | settings.json 缺失 / 损坏 / defaultProvider·defaultModel 为空 / catalog 无命中 → 行为与现状逐字节一致；`EngineStatus.default_model` 由 first-entry 改为 settings default（无前端消费方，仅诊断字段） |
| 其他引擎 | kimi / grok / gemini 既有默认解析逻辑不动；`promote_default_model` 为通用 helper，后续引擎接入可复用 |
| 缓存 | engine status cache 为进程内存量，重启 app 后首次探测即得新 default；无需迁移 |

## Acceptance

1. 本机（pi settings `kimi-coding`/`k3`）切到无账本 pi 会话：composer 显示 `kimi-coding / k3`（或 models.json 自定义默认），不再是 `anthropic / claude-fable-5`。
2. `defaultProvider`/`defaultModel` 指向 catalog 存在的条目时，该条目 `isDefault` 且位于 catalog 首位；原 first 条目不再带 default 标记。
3. settings.json 缺失 / JSON 损坏 / 字段为空 / 指向不存在的模型：catalog 与现状完全一致（first 条目 default），无报错、无诊断噪音。
4. Rust 单测覆盖：settings 解析矩阵（正常 / 缺文件 / 损坏 / 空串 / 仅 defaultModel）、promote 语义（命中 / 未命中零变化 / 清旧标记）、候选 id 回退顺序；`cargo test` 全绿、`rustfmt --check` 通过。

## Capabilities

- **ADDED**（挂 `provider-model-catalog-refresh`）：`PI Catalog Default Model MUST Resolve From PI Settings`——pi catalog 的 default 标记 MUST 以 pi settings 为权威源，settings 不可用时 MUST 回退枚举首条目。
