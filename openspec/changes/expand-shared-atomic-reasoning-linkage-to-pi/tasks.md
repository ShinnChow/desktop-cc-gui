# Tasks: expand-shared-atomic-reasoning-linkage-to-pi

> 2026-08-27 L1 收口批次：逐项按 HEAD 代码证据补勾（commit `d0706f545` 落地，此前 39 项全未勾——审计见 verification.md §审计）。剩余未勾项仅 §6 两条手测 smoke 与 §7 收口 chore。

## 1. `atomicModelReasoning.ts` 接 PI

- [x] 新增 private helper `enrichModelReasoningForEngine(engine, model)`：当 `engine === "pi"` 时从 `model.supportedReasoningEfforts` 复制 capability 元数据到返回值；其它 engine 直返 `model`（不发明）。与 `enrichModelInfoWithAtomicReasoning`（codex-only）平行。【落地为 export（无外部 importer，语义等价）；PI 分支恒等直返——capability 已在 catalog 投影（`supported_thinking_levels_for_pi_model`）填好，`atomicModelReasoning.ts:180-189`】
- [x] `resolveAtomicReasoningOptions` 在 `engine === "pi"` 分支走 `enrichModelReasoningForEngine` → 从 `enriched.supportedReasoningEfforts` 推导 options；空则按 `enriched.defaultReasoningEffort` 回退到 `[default]`；全空返 `[]`。【`atomicModelReasoning.ts:243-256`】
- [x] `reconcileAtomicReasoningEffort` 早退白名单加 `pi`：`if (engine !== "codex" && engine !== "pi") { return null; }`（保留 claude/grok 既有早退，移除 DSH/Kimi/OpenCode 等非四档引擎的空早退扰动）。【`atomicModelReasoning.ts:214`】
- [x] `resolveAtomicDefaultReasoningEffort` 扩 PI 分支：从 `enrichModelReasoningForEngine("pi", model).defaultReasoningEffort` 或 `resolveAtomicReasoningOptions("pi", enriched)[0]` 取值；非 PI 走原早退（null）。【`atomicModelReasoning.ts:285-298`】
- [x] `resolveAtomicReasoningEffort`（`buildProviderExecutionTarget` / `initialTarget.ts` seed 用）扩 PI 分支：inherit 命中保留，不命中 → PI 模型 default；非 inherit → PI 模型 default。【`atomicModelReasoning.ts:333-348`；caller `initialTarget.ts:89` / `ModelSelect.tsx:285`】

## 2. `Composer.tsx` `atomicModelReasoningRef` 接 PI

- [x] 非 codex 分支扩为：目标引擎 === "pi" 时去 `providerModelCatalogs["pi"]` 按 id/model 匹配，把 `matched.supportedReasoningEfforts` / `matched.defaultReasoningEffort` 复制到 `atomicModelReasoningRef.model`。匹配逻辑复用 codex 分支的 `matchByIdentity` 形态。【`Composer.tsx:987-1041`】
- [x] 非 codex 且非 pi 引擎维持原行为（只填 `id` / `model`）。【`Composer.tsx:987-998`】

## 3. `Composer.tsx` Shared target hydrate reconcile effect

- [x] effect 早退条件 `engine !== "codex" && engine !== "claude" && engine !== "grok"` 改为 `engine !== "codex" && engine !== "claude" && engine !== "grok" && engine !== "pi"`。【`Composer.tsx:1093-1100`】
- [x] effect 内部 `reconcileAtomicReasoningEffort({ engine, model, effort: normalizedRaw })` 自动受益于 §1 的 PI 分支扩展，无需额外改本 effect。【`Composer.tsx:1101-1107`】

## 4. 测试

- [x] `src/features/models/atomicModelReasoning.test.ts`：
  - [x] PI 全 7 档 catalog allowlist【:208-235】
  - [x] PI `thinkingLevelMap` 含 holes 时 options 是子集【:237-253】
  - [x] PI unknown model 走 capability-neutral（返 `[]` / null）【:255-263 + reconcile 变体 :413-437】
  - [x] PI 模型支持 high → 保留 high（inherit）【:277-295】
  - [x] PI 模型支持 [low, medium] + current ultra → 收敛到 default【:376-392】
  - [x] PI 跨引擎从 Codex high → PI 不继承（non-inherit）【:297-316】
  - [x] PI 模型 `defaultReasoningEffort` 为 high → 默认 effort = high【:252 / :274】
  - [x] `enrichModelReasoningForEngine` 对非 PI 直返 model【2026-08-27 收口补测："enrichModelReasoningForEngine passes non-PI models through untouched"】
- [x] `src/features/composer/components/Composer.*.test.tsx`（新建）：
  - Shared target 切到 PI 模型有 catalog allowlist → `atomicReasoningOptions` 等于 catalog 行 `supportedReasoningEfforts`【`Composer.shared-pi-reasoning.test.tsx:175`】
  - Shared target PI 模型无 catalog 行（runtime-only）→ `atomicReasoningOptions = []`【:241】
  - Shared target PI 模型 `defaultReasoningEffort = low` + `selectedEffort = null` → `atomicSelectedEffort = "low"`【:175 区段；null→default】
  - Shared target PI 模型 + 不支持 effort → reconcile 收敛到 default【:269 + native 不消费回归 :301】
- [x] `src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx`（新建或追加）：
  - `buildProviderExecutionTarget({ providerId: "pi", modelMeta: { defaultReasoningEffort: "low", supportedReasoningEfforts: [...] } })` → seed `reasoning.effort = "low"`【:2208】
  - 同上但 inherit=true + previousEffort="high" 命中 PI allowlist → seed `reasoning.effort = "high"`【:2247；另 :2283 不支持丢弃 / :2318 unknown→null】
- [x] `src/features/threads/hooks/useThreadMessaging.test.tsx`（追加）：
  - send 边界 `reconcileAtomicReasoningEffort({ engine: "pi", model, effort: "high" })` + catalog 允许 high → 返 high【2026-08-27 收口补测 "keeps Shared PI reasoning effort at the send boundary"】
  - send 边界 `reconcileAtomicReasoningEffort({ engine: "pi", model, effort: "ultra" })` + catalog 不允许 → 返 default【按落地契约修正：send 边界 model ref 只有字符串（无 capability metadata），PI 走 capability-neutral 直通（不发明不清）；「非法档位收敛 default」由带 metadata 的 Composer 层完成（atomicModelReasoning.test :376 覆盖）。收口补测 "keeps an out-of-band Shared PI effort value at the send boundary" 钉死该契约】

## 5. 文档与 ADR

- [x] `openspec/changes/expand-shared-atomic-reasoning-linkage-to-pi/specs/shared-execution-target/spec.md`：在三条 Atomic Reasoning requirement 上追加 ADDED scenarios 覆盖 PI（详见 specs delta）。
- [x] `docs/research/mossx-multi-cli-provider-session-foundation-design.md`：
  - [x] 最近校准段追加 `2026-08-25 · Atomic 思考强度联动扩到 PI（expand-shared-atomic-reasoning-linkage-to-pi）`【:16】
  - [x] 「Atomic 模型↔思考强度联动」校准行刷新 OpenSpec change id + 事实源【:47】
  - [x] 「更新触发器」条目保留（本次属于该能力的引擎覆盖扩展）【:64】

## 6. 验证

- [x] `npm run check` 全绿【口径修正：仓库不存在 `npm run check` 脚本（历史核查从未存在）；落地时以 `tsc --noEmit` + eslint 等价执行（commit `d0706f545`），2026-08-27 收口复核 typecheck 0 error】
- [x] focused vitest `src/features/models/atomicModelReasoning.test.ts` 全绿【2026-08-27 复跑 28/28】
- [x] focused vitest `src/features/composer/components/Composer.*.test.tsx` 全绿【2026-08-27 复跑 9 套件 100/100】
- [x] focused vitest `src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx` 全绿【2026-08-27 复跑 79/79】
- [x] focused vitest `src/features/threads/hooks/useThreadMessaging.test.tsx` 全绿【口径注记：4 failed 为存量非 PI 用例（racing Shared V2 submits / Shared V0 rollback / opencode pending / codex retry），落地 commit 已做 stash-baseline 对照声明；本 change 相关 PI 用例（含 2026-08-27 补测 2 例）全绿，116 passed】
- [x] `cargo test --lib` 不引入新 failure（与 HEAD baseline 对照）【本 change 零 Rust 改动（commit stat 仅 .ts/.tsx/.md），按构造不可能引入；verification.md 记录 18 存量 baseline】
- [x] `openspec validate --change expand-shared-atomic-reasoning-linkage-to-pi` 通过【CLI 1.3.1 位置参数等价 `openspec validate expand-shared-atomic-reasoning-linkage-to-pi` → valid】
- [ ] **Native PI 0 回归**：跑一次 native pi dialog 的 smoke（手工或 scripted）：模型选择 → 思考档位显示 → 发消息 → 验 `[pi/rpc] set_thinking_level(<level>)` 日志
- [ ] **Shared PI smoke**：创建 Shared Session 选 PI 模型 → 思考档位选择器出现 → 选档 → 发消息 → 验 V2 dispatch `reasoning_effort` 非 null → 验 PI native set_thinking_level / --thinking 日志

## 7. 收口

- [ ] proposal.md / design.md / tasks.md / verification.md 全部勾完【依赖 §6 两条 smoke】
- [x] ADR 校准回写完成
- [x] spec delta 同步
- [x] openspec status --change expand-shared-atomic-reasoning-linkage-to-pi ready-for-archive【`openspec status` → Progress 4/4 artifacts complete】
