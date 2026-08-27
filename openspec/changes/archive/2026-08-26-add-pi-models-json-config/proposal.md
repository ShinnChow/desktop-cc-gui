# Change: add-pi-models-json-config

## Why

「供应商认证」区块（`PiProviderAuthSection`）目前只覆盖 pi 的两类凭证来源：订阅授权（OAuth → `auth.json`）与内置供应商 API Key（→ `auth.json`）。pi 的第三类配置——**自定义供应商 / 中转站**（`~/.pi/agent/models.json`，定义 `baseUrl`、`api` 类型、模型列表、`apiKey`）——完全没有 UI 入口，用户只能手写文件。典型场景：把 Grok 等模型接到自家中转站（含 Responses 接口形态），当前只能离开 App 手动编辑 JSON。

## What Changes

- 「供应商认证」新增第三组「自定义供应商」：
  - 只读列表：展示 `models.json` 中已定义的 provider（名称 · baseUrl · api 类型 · 模型数）。
  - 「编辑配置」展开**整段文本编辑器**（等宽 `<textarea>`），内容即整个 `models.json`，支持 JSONC 注释。
  - 文件不存在 / 内容为空时预填**默认示例模板**（中转站 + Grok，走 `openai-responses`）。
- 后端新增 `pi_models_config.rs`：
  - `pi_models_config_read`：返回文件路径、是否存在、原文文本、解析出的 provider 摘要列表。
  - `pi_models_config_write`：**宽松结构校验**通过后原子写入（同目录 tmp + rename，0600）。
- 失败关闭：语法错误 / 结构不合法 → 报错回前端，**绝不覆盖原文件**；未知字段原样保留（pi 新版本字段不拦截）。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Backend | 新增 `src-tauri/src/engine/pi_models_config.rs`；注册 2 个 Tauri commands |
| Frontend | `PiProviderAuthSection.tsx` 增加第三组；`services/tauri/piModelsConfig.ts`；i18n zh/en；样式入 `settings.vendor-pi-auth.css` |
| IPC | 新增 `pi_models_config_read` / `pi_models_config_write` |
| Out of scope | 表单化逐字段编辑；`compat` / `cost` / `thinkingLevelMap` 等高级字段的结构化 UI；models-store.json；校验 pi 运行时真实可用性（用户配错由 pi 运行时报错兜底） |

## Acceptance

1. 第三组展示 `models.json` 中已有 provider 列表（名称 / baseUrl / api / 模型数）；文件不存在时显示空态 + 引导文案。
2. 「编辑配置」展开 textarea：文件不存在或为空时预填 Grok 中转示例模板；存在时显示原文（含注释）。
3. 保存：JSONC 解析通过 + `providers` 为对象 → 原子写入 0600；否则行内报错，原文件不变。
4. 宽松校验：provider 内含未知字段（如未来 pi 新增字段）不报错、保存后不丢失。
5. 写坏风险隔离：非法内容保存被拒，已有 `models.json` 字节不变。
6. 窗口 focus / 保存成功后列表与文本刷新（事件驱动，不轮询）。
7. `cargo test`（pi_models_config 单测）与前端既有测试通过。

## Capabilities

- **ADDED** `pi-models-json-config`：`~/.pi/agent/models.json` 的读取、摘要解析、宽松校验与原子写入；前端「自定义供应商」组的展示与整段文本编辑。
