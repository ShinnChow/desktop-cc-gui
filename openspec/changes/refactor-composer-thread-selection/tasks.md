# refactor-composer-thread-selection · tasks

> 全程 TDD：每个修复先红后绿；每 Phase 一个独立提交。基线 = 101 既有用例（hook 18 / 纯函数 25 / flow 4 / modelSelection 54）。

## Phase 0 · 基线与 Gate 前置

- [ ] 0.1 `git status` 确认 `app-shell/domains/`、`app-shell/sections/`、`features/models/hooks/useModels.ts` 工作区干净；不干净即停手协调
- [ ] 0.2 基线：`npx vitest run src/app-shell/domains/useSelectedComposerSession.test.tsx src/app-shell/domains/selectedComposerSession.test.ts src/app-shell/sections/selectedComposerSession.flow.test.ts src/app-shell/domains/modelSelection.test.ts` 记录通过/失败清单（存量失败逐条记录作零新增红对照）
- [ ] 0.3 `npx tsc --noEmit` 记录基线（当前已知：并行会话在途 threads 域 error，与本 change 无关）
- [ ] 0.4 验证 `resolveThreadEngine` 对 pending/真实线程的映射表（红测试 fixture 依赖），存本文件备注

## Phase 1 · 决策核心纯函数化（行为零变化，既有用例恒绿）

- [ ] 1.1 【红】写 `composer-selection/resolveThreadSelectionOnSwitch.test.ts` 显式用例：5 层优先级（stored / cache / fork 继承 / draft carry / engine default-pending）+ effort 回填 + thread-id 迁移，各至少 1 例直接作用于纯函数（先行红：模块未建）
- [ ] 1.2 【绿】建 `resolveThreadSelectionOnSwitch.ts`：组合既有 4 个 `should*` 纯函数（不重写），输出 `{display, writes, clears}`；hook `reloadSelectedComposerSelection` 收缩为「组装 input → 调决策 → 应用 writes」薄壳
- [ ] 1.3 18 个 hook 用例 + 25 纯函数用例不改断言全绿；DSH seed / Claude fork / 双 workspace 隔离场景逐一对照
- [ ] 1.4 【验证】0.2 基线复跑零新增红；tsc 零新增；提交：`refactor(app-shell): 切会话选择解析抽为 resolveThreadSelectionOnSwitch 决策核心`

## Phase 2 · 写入统一 + epoch 防竞态（修 D1/D3）

- [ ] 2.1 【红】D1 复现：codex 线程 A(model a) → 快切 codex 线程 B(账本 b) → catalog ready 收敛 → 断言 B 账本仍为 b（旧实现被 a 污染）
- [ ] 2.2 【红】D3 复现：线程 B 账本 miss + modelsReady=false → 断言不产生 repair 写、display 不取旧全局残留
- [ ] 2.3 【绿】建 `selectionWrites.ts`：`applyComposerSelectionWrites(writes, epoch)`；hook 内 switchEpochRef（threadId 变化时 ++）；写入前 epoch+线程归属校验，过期丢弃并 debug 记录 `selection-write-dropped-stale`
- [ ] 2.4 删除 codex repair effect（useAppShellComposerModelSection L520-560），其职责改为「catalog ready 收敛 effect 产生 writes（经 epoch 校验）」；`codex-composer-startup-selection-stability` 既有测试护航
- [ ] 2.5 W5/W7 外部直写（send/layoutNodes/persist 入口）内部改走统一写入（带当前 epoch）
- [ ] 2.6 【验证】0.2 基线 + 1.1 新用例全绿；提交：`fix(app-shell): 会话选择账本写入统一入口与 epoch 防竞态（修跨线程污染）`

## Phase 3 · draft carry 门禁升 profile 粒度（修 D2）

- [ ] 3.1 【红】draft 源 codex+profile P1 → 目标 codex+profile P2：断言不应用（旧实现 engine 相等即放行）
- [ ] 3.2 【绿】`carryGate.ts`：门禁 engine + providerProfileId 双等；profile 信息不可得时保守放行（与现有引擎门禁同语义退化）
- [ ] 3.3 【验证】提交：`fix(app-shell): draft carry 门禁升级到 engine+profile 粒度（修同引擎跨渠道串台）`

## Phase 4 · 生命周期收口（修 D4/D5）

- [ ] 4.1 【红】D4：线程 A 点选（用户锁）→ 切线程 B → B 的 plan 不再被 A 的用户锁压制
- [ ] 4.2 【绿】决策核心 `clears` 增 `clear-user-model-lock`；hook 切线程时应用；useModels 侧消费该清理（保留 selection 作显示回退）
- [ ] 4.3 【红+绿】D5：目标线程已有账本 → 迁移不覆盖（收紧 `shouldMigrateComposerSelectionBetweenThreadIds` 目标无账本条件）
- [ ] 4.4 【验证】提交：`fix(models): 会话切换时清理跨线程用户锁并收紧 thread-id 迁移条件`

## 收口

- [ ] 5.1 `openspec validate refactor-composer-thread-selection --strict` 通过；design §5 回填表补齐
- [ ] 5.2 全量回归：Phase 0 基线 + 新增 D1-D5 红转绿用例全绿；`check:app-shell:governance`；tsc 零新增
- [ ] 5.3 真机手测矩阵：同引擎多会话快切 5+ 轮（claude/codex 各一组）、跨引擎互切、codex managed↔三方互切、新会话↔老会话混切、fork 会话——每次切回断言下拉显示 = 该会话上次模型
- [ ] 5.4 README 索引行；sync specs（新增 `composer-thread-selection-resolution` + MODIFIED `codex-composer-startup-selection-stability`）
- [ ] 5.5 archive（待 5.3 通过）
