# Change: fix-pi-degraded-thinking-catalog-self-heal

## Why

用户现场（2026-08-27）：PI 思考档位菜单最高只有 High，pi CLI 本身能识别 `max`；且「多切换几次有时又能对上」。排查结论（详见会话记录）：

1. **PI 档位投影逻辑与 pi 官方一致**（`supported_thinking_levels_for_pi_model` 与 pi `getSupportedThinkingLevels` 逐条对齐，本机 pi 0.84.3 源码比对确认）。
2. **降级探测源被当健康缓存钉死（主因）**：PI catalog 探测链为 RPC `get_available_models`（携带每模型 `thinkingLevelMap`）→ 失败回退 `pi --list-models`。后者解析固定宽度表格、天然拿不到 map，推理模型一律只投影 `off/minimal/low/medium/high` 五档（永不出现 `xhigh/max`）。但该结果 `source="detected"` 且非空，`resolve_engine_models_cache_first` 视为健康数据写入缓存，此后所有非强制读取全部命中——菜单长期缺档。
3. **现有自愈缺口**：打开模型选择器的自动补拉只覆盖 fallback-only（PI `auto`）形态；对这种「降级但 detected」形态不触发。而带 `forceRefresh` 的机会窗口（Atomic picker authoritative refresh、显式刷新、供应商续接）何时出现取决于操作路径，于是表现为「时好时坏、切几次能对上」，被误判为状态泄露。
4. **判别字段存在但断在前端**：后端 `ModelInfo.provenance` 区分两类来源（`cli:pi-available-models` vs `cli:pi-list-models`），`EngineModelInfo` / `ModelOption` 均保留该字段；唯独 composer 链路的 `normalizeAdapterModelOptions` 把它剥掉，UI 无从判定。

## What Changes

- **前端透传 provenance（纯增量字段）**：composer `ModelInfo` 增加可选 `provenance?: string | null`，`ChatInputBoxAdapter.normalizeAdapterModelOptions` 原样透传。不改任何既有字段语义。
- **菜单打开自愈扩展（严格圈 PI + legacy/native 路径）**：`ModelSelect.handleMenuOpenChange` 在原 fallback-only 判定旁新增 PI capability-degraded 判定——当前引擎组非空、非 fallback-only、且全部行 `provenance === "cli:pi-list-models"` 时，复用既有 `handleRefreshConfig`（forceRefresh 全链重探）。语义与 fallback-only 自愈一致：每次打开最多一次，`isRefreshingConfig` 期间不重入，失败不循环（下次打开再试）。RPC 成功后行 provenance 变为 `cli:pi-available-models`，判定自动失效，不会反复探测。
- **明确不做（边界）**：
  - 不动后端 cache-first 命中契约（`cache-first-engine-model-catalog`：非 force + 非空 cache 必须零 spawn），不引入 TTL；
  - 不动切会话热路径（零新增 catalog IPC，红线见 `session-switch-catalog-fetch-pitfall.md`）；本 change 的唯一新 IPC 触发点是「打开模型选择器」，属该文档允许的三类 catalog 拉取之一；
  - 不覆盖 Atomic 双栏路径（`useProviderTargetCatalogOwners` 链路，另一套 ModelInfo 类型）；
  - 不处理发送侧 skip `set_thinking_level` 的可观测性（单独跟进）。

## Impact

| 维度 | 说明 |
| ---- | ---- |
| Frontend | `ChatInputBox/types.ts`（+可选字段）、`ChatInputBoxAdapter.tsx`(透传)、`selectors/ModelSelect.tsx`（自愈判定）、`selectors/ModelSelect.test.tsx`（+用例） |
| Backend | 零改动 |
| 热路径红线 | 打开模型选择器才可能触发一次 force 重探，符合 pitfall 文档允许触发点 |
| 性能边界 | 对 models.json 确实无 `thinkingLevelMap` 的中转模型用户（五档即正确），每次打开菜单会多一次后台重探（fire-and-forget + spinner，RPC 常态 ~1s / 预算 15s），失败静默保持现状 |
| Out of scope | Atomic 路径同款自愈、skip set_thinking_level 前端透出、后端缓存 TTL |

## Acceptance

1. PI catalog 整组 `provenance = "cli:pi-list-models"` 时，打开模型菜单自动触发一次刷新（不重入、失败不循环）。
2. 整组 `provenance = "cli:pi-available-models"`（含无 map 的合法五档模型）或混合 provenance 时，不触发自动刷新。
3. 非 PI 引擎不受影响；fallback-only 自愈行为不变。
4. 全量 `npm run typecheck` 通过；新增测试通过。
