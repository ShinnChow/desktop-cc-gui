# refactor-composer-thread-selection

## Why

切换会话时模型下拉的默认跟随（"切到会话 T 应显示什么模型/档位"）由散落在四层的规则拼成，用户实测「切换多了有时候还是不准」。现状盘点（2026-08-27 审计）：

**状态源 6 个**：

1. 线程账本 `clientStore["composer"]["<ws>::<threadId>"]`（持久，权威显示源）
2. 内存 `selectedComposerSelectionBySessionKey` cache（会话期）
3. `useModels` selection + `hasUserSelectedModel/Effort` 用户锁（workspace 级，**切线程不清**）
4. `composerEnginePrefsStore`（per-engine durable last-used，external store）
5. `appSettings.lastComposerModelId/Effort`（全局持久，useModels 的 preferred）
6. `nativeAtomicSelection` overlay（瞬时勾选反馈，resetKey 三段）

**取值合成点 3 个**：`reloadSelectedComposerSelection`（切线程 5 层优先级 + 3 分支 + migration）、`getEffectiveSelectedModelId`（codex/非 codex × 有线程/无线程四分叉）、`planComposerModelSelection`（用户锁/freeform/preferred/default 优先级）。

**写入点 7 个**：点选 handler、repair 回写 effect、draft 落盘/迁移/继承（reload 内部）、useModels 全局 setState、per-engine store、send/layoutNodes 发送后写账本、无线程时写 appSettings。

**已识别漂移候选（均未修）**：

- D1 codex repair 回写竞态：repair effect 可能把旧线程的 effective 写进新线程持久账本（永久污染）
- D2 draft carry 门禁只到 engine 粒度：同引擎跨 provider profile（codex managed ↔ 三方）串台（2026-08-27 review 留案 P2-3）
- D3 catalog 加载窗口全局残留：codex 账本 miss 回落「useModels 全局 = 上一线程残留」，显示错模型后可能被 D1 固化
- D4 useModels 用户锁/selection 跨线程存活（切线程不清，只清 workspace）
- D5 thread-id 迁移（pending→real）条件过宽，可能把临时选择带入真实线程

既有 101 个测试用例（hook 18 / 纯函数 25 / flow 4 / modelSelection 54）覆盖较厚，但规则散落使每个新 bug 都要在多处打补丁（fix-composer-cross-engine-draft-selection-leak 已是第三次补丁）。本 change 以 TDD 整体收拢重写。

## What Changes

按四个 Phase 交付，每 Phase 独立提交可回退：

- **Phase 1 · 决策核心纯函数化**：把 `reloadSelectedComposerSelection` 的全部取值规则（5 层优先级 / fork 继承 / draft carry / engine default / effort 回填 / thread-id 迁移）抽为纯函数 `resolveThreadSelectionOnSwitch(input)`，输入全量上下文（前后线程、双侧账本、draft、engine、catalog 就绪态），输出 `{ display, writes: [...], clears: [...] }` 决策结果。hook 收缩为「调纯函数 + 应用 writes」。既有 43 个 hook/纯函数用例不改断言迁移护航。
- **Phase 2 · 写入统一 + epoch 防竞态（修 D1/D3）**：所有账本写入收敛到单一入口 `applyComposerSelectionWrites()`；每次线程切换分配单调递增 epoch，写入携带 epoch、过期丢弃。codex repair effect 重写为决策核心的 `writes` 产物（不再从 effective 回推），写前校验 threadId 与 epoch 未变。
- **Phase 3 · draft carry 门禁升到 profile 粒度（修 D2）**：carry 判定从 engine 相等升级为 engine + providerProfileId 相等（codex managed ↔ 三方互不串）。
- **Phase 4 · 生命周期收口（修 D4/D5）**：切线程时清 useModels 用户锁（保留 selection 作显示回退但不再以用户锁身份压过线程账本）；thread-id 迁移条件收紧到「canonical 相同且目标无账本」。
- **收口**：101 既有用例 + 新增回归用例全绿；真机手测矩阵（快速连续切换 A↔B↔C 若干轮）。

## 目标与边界

- **目标**：切会话取值规则单源（一个纯函数可单测、可解释）；写入单入口带竞态防护；5 条漂移候选全部消除或显性裁决。
- **边界**：不改点选→发送的 send authority 语义（fix-model-picker-send-authority 域）；不动 Shared `targetStore`；不动 per-engine prefs store 的持久化格式；不改 UI/DOM。
- **验收基线**：101 既有用例零回归；每个 D1-D5 先有红测试复现再转绿；`check:app-shell:governance` 通过；tsc 零新增 error。

## TDD 口径

- Phase 1 特征迁移：既有用例即行为快照，纯函数抽取过程中恒绿；对 5 层优先级各补 1 个直接作用于纯函数的显式用例。
- D1-D5 每条：先写红测试（复现漂移的最小场景，含 D1 的快速切换竞态模拟），修复转绿。
- 收口前全量复跑 + HEAD 基线对照（临时 worktree，用完即删，绝不用 stash）。

## 非目标

- 不重构模型 catalog 加载链（useAppShellCatalogHost 域）。
- 不合并 per-engine prefs 与全局 lastComposerModelId 双持久化（另案裁决）。
- 不处理 DSH 特有的 selection seed 语义重构（仅保持现有行为随规则迁移）。
- 不动本轮 selector 渲染层（refactor-composer-selector-layer 已收口）。

## Capabilities

### New Capabilities

- `composer-thread-selection-resolution`: 切会话选择解析合同——取值规则单源于 `resolveThreadSelectionOnSwitch`；账本写入单入口 + epoch 防护；draft carry 门禁 engine+profile 粒度；用户锁生命周期与会话切换对齐。

### Modified Capabilities

- `codex-composer-startup-selection-stability`: MODIFIED——startup/切换窗口的 codex 选择稳定性从「repair 回写」机制改为「决策核心 writes 产物 + epoch 校验」，禁止旧线程 effective 污染新线程账本。

## Impact

| 层 | 影响面 |
| ---- | -------- |
| Frontend | `app-shell/domains/useSelectedComposerSession.ts`（518 行收缩为薄壳）、`selectedComposerSession.ts`（纯函数并入决策核心）、`useAppShellComposerModelSection.ts`（repair effect 重写）、`useModels.ts`（用户锁生命周期）、新增 `composer-selection/` 决策核心模块 + 测试 |
| Backend | 无 |
| Specs | 新增 `composer-thread-selection-resolution`；MODIFIED `codex-composer-startup-selection-stability` |
| Gate | PlanFirst（本 change 即载体）；Format Discipline（外科式编辑）；AppShell Structure Gate（不动 domain key 与 bag 结构，仅域内实现） |
| 风险 | ① 纯函数抽取语义漂移——101 用例护航 + 每 Phase 小步提交；② epoch 机制误杀合法晚到写入——写入丢弃仅限「epoch 过期且目标线程已切换」；③ 并行会话在途（threads 域多文件）——本 change 主战场在 app-shell/domains，与在途域低交叠，动手前 `git status` 核对 |
