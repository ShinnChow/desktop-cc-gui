# Design: fix-pi-catalog-default-from-settings

## 事实源（2026-08-28 排查锁定）

| 事实 | 证据 |
| ---- | ---- |
| 无账本 pi 会话切入显示 `anthropic/claude-fable-5` | 用户截图 + `~/.ccgui/client/composer.json` 无 `selectedModelByThread.67b90817-…:pi:01a04321-…` 条目 |
| pi catalog default = 枚举首条目 | `status.rs` `parse_pi_models_output`（`first_mut().default = true`）与 `parse_pi_available_models`（同款） |
| 枚举首条目 = `anthropic claude-fable-5` | 本机实测 `pi --list-models --no-extensions`：provider 字母序，anthropic 第一行 |
| pi 真实默认 = `kimi-coding/k3` | `~/.pi/agent/settings.json`：`defaultProvider: "kimi-coding"`、`defaultModel: "k3"` |
| 前端消费面 = `isDefault` 标记 | `modelSelection.ts` `getDefaultModelId`：`models.find(isDefault)?.id ?? models[0]?.id`；`EngineStatus.default_model` 无前端消费方 |
| 共同特性先例 | kimi `read_kimi_models_from_config`（`default_model`）/ grok（`models.default`）/ gemini（ccgui 配置 + `GEMINI_MODEL`）均在 parse/取数层接各自 CLI 配置源，且都「标 default + 移到队首」 |

## 方案

### 取数汇合点单点接线

`get_pi_models(bin, path_env)` 是三条取数路径的唯一汇合点（RPC → list-models 两跳 → generated fallback）。promote 在此统一应用，RPC / 回退 / 兜底三条路径一次覆盖，parse 函数保持纯函数（只做 stdout/JSON → ModelInfo 映射），既有 parse 单测零漂移。

```rust
fn get_pi_models(bin, path_env) -> (Vec<ModelInfo>, Option<String>) {
    // …既有三路径取数不动…
    promote_pi_default_from_settings(&mut models);
    (models, config_diagnostic)
}
```

`promote_pi_default_from_settings` 内部：
1. `get_pi_home_dir()` → `read_pi_default_model_selection()` 读 `<agent>/settings.json`；
2. 候选 id 顺序：`{defaultProvider}/{defaultModel}` → 裸 `{defaultModel}`（覆盖 models.json 无 provider 前缀的自定义条目）；
3. `promote_default_model(models, candidate)` 命中即止；全部未命中 / settings 不可用 → 不动列表（first-entry default 兜底语义保持）。

### 通用 helper（共同特性落点）

```rust
fn promote_default_model(models: &mut [ModelInfo], default_id: &str) -> bool
```

语义对齐 grok / kimi 既有实现：清全部 `default` → 命中条目标 default → 移到 index 0。返回是否命中，调用方决定回退。本 change 只在 pi 接线；kimi / grok / gemini 的内联实现不在本 change 重构（零行为变更优先，后续引擎接入复用 helper）。

### settings 解析容错

`read_pi_default_model_selection` 用 `serde_json` 读 `settings.json`（纯 JSON，无 JSONC 注释问题——`models.json` 才有）。任何失败（NotFound / 解析错 / 字段缺失 / 非字符串 / trim 后空）返回 `None`，禁止向诊断通道注入噪音（catalog 探测 `config_diagnostic` 保持既有语义）。

### 不做的事（Out of scope）

- **不改 parse 函数签名 / first-entry 兜底语义**：settings 缺失的旧环境（含 Windows 便携安装）行为不变。
- **不清洗存量账本脏数据**（grok/shared 账本里的 `claude-fable-5`、pi 账本里的 `anthropic/*`）：前端账本 normalize 是独立行为变更，需单独 change。
- **不动 `resolve_engine_models_cache_first`**：cache 为进程内存量，重启即得新 default；不引入 cache 版本号。
- **不动 D6 闸2 成员资格闸**：pi catalog 含全部 anthropic 模型是 pi 聚合 CLI 的事实，成员资格放行是正确语义；本缺陷与之无关。

## 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| settings default 指向未认证 provider（用户改了 settings 但没认证） | 与 pi CLI 自身行为一致——pi 运行时同样按 settings default 发起；显示/发送语义对齐 CLI，不发明新规则 |
| catalog 重排（default 移到队首）影响分组下拉顺序 | 与 kimi / grok 既有行为一致（default 置顶）；pi picker 本就按 catalog 顺序渲染，default 在前是预期 |
| `PI_CODING_AGENT_DIR` 重定向环境 | `get_pi_home_dir()` 已处理该 env，settings 路径与探测同一 home 源，无错位 |
