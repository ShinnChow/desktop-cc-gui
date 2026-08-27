# refactor-composer-thread-selection · design

> 状态：proposal 阶段。§5 漂移候选→测试映射在实施各 Phase 回填实际结果。

## 1. 现状全图（事实快照，2026-08-27，分支 bump-version-0.9.4）

```text
━━━━━ 状态源（6）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
S1 线程账本    clientStore["composer"]["<ws>::<threadId>"]   持久·权威显示源
S2 内存 cache  selectedComposerSelectionBySessionKey         会话期
S3 useModels   selection + hasUserSelectedModel/Effort 锁    workspace 级
S4 engine pref composerEnginePrefsStore                       per-engine durable
S5 全局偏好    appSettings.lastComposerModelId/Effort        useModels preferred
S6 瞬时 overlay nativeAtomicSelection                        resetKey 三段+回滚事件

━━━━━ 取值合成点（3）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
C1 reloadSelectedComposerSelection（useSelectedComposerSession，518 行 hook）
   切线程 5 层优先级：stored → cache → {fork 继承 | draft carry(引擎门禁)
   | engine default(仅 pending)} → pending effort 回填；+ thread-id 迁移
C2 getEffectiveSelectedModelId（modelSelection.ts）
   codex{线程:账本→全局→default | 无线程:全局→default}
   非codex{线程:账本→default | 无线程:enginePref→default}
C3 planComposerModelSelection（useModels.ts）
   用户锁 existing/freeform → preferred → default → existing

━━━━━ 写入点（7）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
W1 handleSelectComposerSelection（点选→账本 or draft）
W2 codex repair effect（useAppShellComposerModelSection L520-560，effective 回推）
W3 writeSelectionForSessionKey（reload 内部：draft 落盘/迁移/继承）
W4 setSelectedModelId（useModels 全局） + setComposerEnginePref（per-engine）
W5 send section / layoutNodes（发送后写账本）
W6 usePersistComposerSettings（无线程→appSettings）
W7 persistComposerSelectionForThread（外部直写入口）
```

## 2. 目标架构

```text
app-shell/domains/composer-selection/
  resolveThreadSelectionOnSwitch.ts   ★ 决策核心纯函数（C1 全部规则迁入）
  resolveThreadSelectionOnSwitch.test.ts
  selectionWrites.ts                  ★ 写入统一入口 + epoch 防护
  selectionWrites.test.ts
  carryGate.ts                        draft carry 门禁（engine+profile 粒度）
  （selectedComposerSession.ts 既有纯函数：normalize/extract/storage-key 随迁或保留原位再导出）
```

### 2.1 决策核心契约

```ts
type ThreadSelectionSwitchInput = {
  previous: { threadId: string | null; workspaceId: string | null } | null;
  next: { threadId: string | null; workspaceId: string | null };
  // S1/S2 双侧读取结果（由 hook 注入，纯函数不做 IO）
  storedSelection: { exists: boolean; value: ComposerSessionSelection | null };
  cachedSelection: ComposerSessionSelection | null;
  draft: {
    value: ComposerSessionSelection | null;
    workspaceId: string | null;
    sourceThreadId: string | null;
    applyToNextThread: boolean;
  } | null;
  engineDefault: ComposerSessionSelection | null; // 仅 pending 适用（调用方判）
  engineDefaultReady: boolean;
  resolveCanonicalThreadId: (id: string) => string;
};

type SelectionWrite =
  | { kind: "thread-ledger"; sessionKey: string; value: ComposerSessionSelection | null; reason: "draft-apply" | "fork-inherit" | "engine-default" | "effort-fill" | "migration" }
  | { kind: "clear-draft-apply-flag" }
  | { kind: "clear-user-model-lock" };

type ThreadSelectionSwitchDecision = {
  display: ComposerSessionSelection | null;
  writes: SelectionWrite[];
};
```

- 纯函数不读 store、不发 setState；IO 与副作用全部留在 hook 薄壳。
- 既有 `shouldApplyDraftComposerSelectionToThread` / `shouldInheritComposerSelectionFromClaudeForkParent` / `shouldMigrateComposerSelectionBetweenThreadIds` / `fillPendingComposerSelectionEffortFromEnginePref` 保持导出（它们已是纯函数，决策核心组合它们，不重写已验证逻辑）。

### 2.2 写入统一 + epoch 防护（Phase 2）

- hook 内 `switchEpochRef`：activeThreadId 变化的 layout effect 里 `epoch++`。
- `applyComposerSelectionWrites(writes, epoch)`：逐条应用；应用前 `epoch === current && sessionKey 属于当前（或显式允许的）线程`，否则丢弃并 debug 记录（`selection-write-dropped-stale`）。
- W2 repair effect 删除，其职责并入决策核心：切线程决策不含 repair；repair 只在「用户点选」与「catalog ready 收敛」两个明确时机由点选路径/收敛 effect 产生 writes，且经 epoch 校验。
- W5/W7 外部直写保留接口但内部走 `applyComposerSelectionWrites`（带当前 epoch）。

## 3. 漂移候选 → 修复映射

| # | 候选 | 修复 Phase | 红测试最小场景 |
| --- | ---- | ---------- | -------------- |
| D1 | codex repair 回写竞态 | P2 | 模拟：线程 A（codex, model a）→ 快切线程 B（codex, 账本 b）→ 断言 B 账本仍为 b（旧实现会在 catalog ready 窗口被 a 污染） |
| D2 | 同引擎跨 profile 串台 | P3 | draft 源 codex+profile P1，目标 codex+profile P2 → 断言不应用 |
| D3 | catalog 窗口全局残留固化 | P2（随 D1 修复后 display 层残留由 C2 收敛规则裁决：账本 miss + catalog 未 ready → 显示 null/loading 而非旧全局） | 线程 B 账本 miss + modelsReady=false → 断言 repair 不写、显示不取全局残留 |
| D4 | useModels 用户锁跨线程 | P4 | 线程 A 点选（锁=true）→ 切线程 B → 断言 B 的 plan 不再 keepUserModel 压过 B 账本 |
| D5 | thread-id 迁移过宽 | P4 | 目标线程已有账本 → 断言不迁移覆盖 |

## 4. 实施顺序与依赖

P1（纯函数抽取）是地基；P2 依赖 P1 的 writes 通道；P3/P4 相对独立可并行小 PR；收口在全部 Phase 后。每 Phase 提交前跑：`useSelectedComposerSession.test + selectedComposerSession.test + flow.test + modelSelection.test + useModels 相关 + governance`。

## 5. 漂移修复结果回填表（实施时回填）

| # | 红测试（文件/用例名） | 修复提交 | 验证 |
| --- | --------------------- | -------- | ---- |
| D1 | （待实施回填） | | |
| D2 | （待实施回填） | | |
| D3 | （待实施回填） | | |
| D4 | （待实施回填） | | |
| D5 | （待实施回填） | | |

## 6. 风险表

| 风险 | 概率 | 影响 | 缓解 |
| ---- | ---- | ---- | ---- |
| 纯函数抽取引入语义漂移（518 行 hook → 决策核心） | 中 | 高 | 101 既有用例护航；既有 4 个 should* 纯函数不重写只组合；每 Phase 小步提交 |
| epoch 误杀合法晚到写入（如异步 catalog 完成后的收敛写） | 中 | 中 | 丢弃仅限「epoch 过期」即线程已切走；同线程内晚到写不拦；debug 记录可观测 |
| DSH seed / Claude fork 等特例在纯函数化中丢失 | 低 | 高 | 特例以既有纯函数为单位整体迁入；hook 层 18 用例含 DSH/fork 场景护航 |
| 与并行会话在途改动冲突（threads 域） | 中 | 中 | 主战场 app-shell/domains 低交叠；动手前 git status 核对；发现交叠即停手协调 |
| repair effect 删除后 startup 收敛缺位 | 中 | 高 | P2 同时补「catalog ready 收敛 writes」路径 + codex-composer-startup-selection-stability 既有测试护航 |
