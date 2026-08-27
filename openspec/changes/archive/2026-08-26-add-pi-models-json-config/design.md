# Design: add-pi-models-json-config

## Context

pi 的供应商配置分两层（已核实 pi v0.84.1 源码 `dist/core/model-config.js` 的 `ModelsConfigSchema`）：

- `~/.pi/agent/auth.json` —— 只存凭证（已由 `pi_auth.rs` 覆盖）。
- `~/.pi/agent/models.json` —— 定义供应商：`providers: Record<string, ProviderConfig>`，provider 字段为
  `name / baseUrl / apiKey / api / oauth / headers / compat / authHeader / models / modelOverrides`；
  model 字段为 `id / name / api / baseUrl / reasoning / thinkingLevelMap / input / cost / contextWindow / maxTokens / samplingParams / headers / compat`。

现有「供应商认证」UI 两组（订阅授权 / API Key）均只操作 `auth.json`。本 change 补第三类。

## Decisions

### D1: 整段文本编辑，不做表单

用户决策：配置用**大段文本覆盖**，给默认示例。models.json 是个人配置，配错由 pi 运行时报错兜底，用户自行删除或重写。因此 UI 不做逐字段表单，一个等宽 `<textarea>` 承载整个文件文本。

**理由**：字段全集（含 `compat` 十几个开关、`thinkingLevelMap`、`cost.tiers`）表单化成本高且随 pi 版本漂移；文本编辑天然全字段覆盖、零跟随成本。

### D2: 宽松校验，而非严格 schema 对齐

保存时仅校验：

1. JSONC 可解析（strip 注释后 `serde_json::from_str` 成功）；
2. 顶层为对象且 `providers` 存在时为对象；
3. 每个 provider 的 `models` 存在时为数组，且数组项含字符串 `id`。

未知字段**不拒绝、不丢弃**——写回的就是用户提交的原始文本本身（不是序列化往返），注释与未知字段天然保留。

**理由**：严格对齐 pi schema 需要跟随 pi 升级（新字段会被拒）；宽松校验只挡「存了没法用」的硬错误，符合「个人配置、报错自修」的定位。

### D3: 写回原文，不做 parse→serialize 往返

`pi_models_config_write` 校验通过后把**用户提交的原始字符串**原子写入。注释、字段顺序、未知字段全部保留。摘要列表由 `pi_models_config_read` 解析生成，仅用于只读展示。

### D4: 默认示例模板

文件不存在或内容为空（或仅空白）时，read 返回 `template` 字段供前端预填：

```jsonc
{
  "providers": {
    "my-relay": {
      "baseUrl": "https://your-relay.com/v1",
      // api 类型：openai-completions | openai-responses | anthropic-messages | google-generative-ai
      "api": "openai-responses",
      // 推荐引用环境变量；也支持明文 key 或 !command（如 !op read 'op://vault/item'）
      "apiKey": "$MY_RELAY_API_KEY",
      "models": [
        {
          "id": "grok-4.6",
          "name": "Grok 4.6 (中转)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 500000,
          "maxTokens": 500000
        }
      ]
    }
  }
}
```

模板只是前端编辑器初值；用户不保存则不落盘，`models.json` 保持不存在（pi 无此文件时行为不变）。

### D5: 与 pi_auth.rs 对齐的工程约束

- 路径解析复用同一优先级：engine-config home override → `PI_CODING_AGENT_DIR` → `~/.pi/agent`，文件名 `models.json`。
- 写入原子化：同目录 `.tmp` + rename；Unix 0600。
- 失败关闭：任何校验 / IO 错误返回给前端，原文件字节不变。
- 本模块**不涉及凭证 mask**：`models.json` 中 `apiKey` 属用户自有明文/引用，原文回显合法（与 auth.json 的安全边界不同，在模块头注释中声明）。

### D6: 摘要解析容错

`pi_models_config_read` 在 JSON 损坏时仍返回 `{ path, exists, text }`，`providers` 为空数组并附 `parseError` 字符串——前端顶部展示错误横幅 + 原文，让用户能就地修复，而不是整个区块打不开。

### D7: 刷新策略

与现有组一致：挂载读一次、保存成功后刷新、窗口 `focus` 时刷新。不轮询。

## IPC 契约

```ts
// pi_models_config_read
interface PiModelsConfigReadResult {
  file: { path: string; exists: boolean };
  text: string | null;          // 文件原文（含注释）；不存在为 null
  template: string;             // 默认示例（前端在 text 为空时预填）
  providers: PiCustomProviderSummary[];
  parseError: string | null;    // JSON 损坏时的可读错误
}
interface PiCustomProviderSummary {
  id: string;
  name: string | null;
  baseUrl: string | null;
  api: string | null;
  modelCount: number;
  hasApiKey: boolean;           // 仅布尔，不回传 key 值之外的语义判断也不需要
}

// pi_models_config_write
async function piModelsConfigWrite(text: string): Promise<void>
// 校验失败 / IO 失败 → reject 可读错误，原文件不变
```

## 前端结构

`PiProviderAuthSection` 内第三组，复用现有 class 命名体系：

```
pi-auth-subhead「自定义供应商」  hint: 写入 ~/.pi/agent/models.json · 中转站 / 自定义模型
└─ vendor-group-card
   ├─ 只读 provider 行（pi-auth-row，Globe fallback 图标，无品牌图标逻辑）
   ├─ 空态行：「尚未定义自定义供应商」
   ├─ parseError 横幅（若有）
   ├─ [编辑配置] 按钮 → 展开 pi-auth-editor（textarea + 保存/取消 + 行内错误）
   └─ foot：文件路径 + 0600 badge
```

- 新文件：`src/services/tauri/piModelsConfig.ts`（invoke 封装）。
- i18n key 挂 `settings.vendor.piAuth.*`（`customTitle / customHint / customEmpty / editConfig / saveInvalid 等`），zh + en 双语。
- 样式复用 `settings.vendor-pi-auth.css`，新增 `.pi-auth-textarea` 等少量类。

## 测试

- Rust 单测（`pi_models_config.rs` 内 `#[cfg(test)]` 或入 `commands_tests.rs` 体系）：
  - 宽松校验：合法 / 缺 providers / providers 非对象 / models 非数组 / model 缺 id / JSONC 注释 / 未知字段保留
  - 原子写入与 0600；校验失败时原文件字节不变
  - 路径解析三优先级
- 前端：沿用现有测试布局，补 read/write 的 invoke mock 用例。
