# refactor-composer-thread-selection · tasks

> 全程 TDD：每个修复先红后绿；每 Phase 一个独立提交。基线 = 101 既有用例（hook 18 / 纯函数 25 / flow 4 / modelSelection 54）。

## Phase 0 · 基线与 Gate 前置

- [x] 0.1 `git status` 确认 `app-shell/domains/`、`app-shell/sections/`、`features/models/hooks/useModels.ts` 工作区干净；不干净即停手协调
- [x] 0.2 基线：`npx vitest run ...（选择域四文件）` 记录通过/失败清单 → **120/120 全绿（modelSelection 65 + 纯函数 33 + hook 18 + flow 4，2026-08-27 21:55）**
- [x] 0.3 `npx tsc --noEmit` 记录基线 → **1 error（并行会话在途 useThreadMessaging 域，与本 change 无关）**
- [x] 0.4 验证 `resolveThreadEngine` 对 pending/真实线程的映射表（红测试 fixture 依赖），存本文件备注 → **约定：`<engine>:`（真实）/ `<engine>-pending-`（新建）/ `claude-fork:`（fork）；effort 约束：claude/grok/dsh/pi 有白名单集合，gemini/kimi/opencode 恒 null，codex 不 fill 不 seed**

## Phase 1 · 决策核心纯函数化（行为零变化，既有用例恒绿）

- [x] 1.1 【红】写 `composer-selection/resolveThreadSelectionOnSwitch.test.ts` 显式用例：5 层优先级（stored / cache / fork 继承 / draft carry / engine default-pending）+ effort 回填 + thread-id 迁移，各至少 1 例直接作用于纯函数（先行红：模块未建）→ 11 契约用例；红阶段抓出两处 fixture 错误（fork 前缀实为 `claude-fork:`、键名漂移）
- [x] 1.2 【绿】建 `resolveThreadSelectionOnSwitch.ts`：组合既有 4 个 `should*` 纯函数（不重写），输出 `{display, writes, clears}`；hook `reloadSelectedComposerSelection` 收缩为「组装 input → 调决策 → 应用 writes」薄壳（~130 行 → 80 行）→ **实现中发现并忠实保留原实现的「双取数通道」语义：L3c 种入走注入 resolver（含 codex 除外）、L4 回填直接读 store——合一会语义漂移（hook 测试 2 红实证），已拆回 `engineDefaultSelection` + `enginePrefEffort` 两输入**
- [x] 1.3 18 个 hook 用例 + 25 纯函数用例不改断言全绿；DSH seed / Claude fork / 双 workspace 隔离场景逐一对照 → **131/131（=120 基线 + 11 新）零回归**
- [x] 1.4 【验证】0.2 基线复跑零新增红；tsc 零新增；提交：`refactor(app-shell): 切会话选择解析抽为 resolveThreadSelectionOnSwitch 决策核心` → **131/131（=120+11）+ 66/66 复验 + tsc 过滤后零 error；两处 nullable 类型错误（stored 读取 key / resolver 入参）已修**

## Phase 2 · 写入统一 + epoch 防竞态（修 D1/D3）

- [x] 2.1 【红】D1 复现：codex→codex 同引擎切换窗口，repair 把上一线程模型写进目标线程持久账本 → **红实锤**（`useAppShellComposerModelSection.test.tsx`「D1红/绿裁决」用例）
- [x] 2.2 【红→绿守卫】D3 复现：账本 miss + 全局残留 → **现状已有守卫（`!selectedComposerSelection` 早退），测试作为回归守卫保留（绿）**
- [x] 2.3 【绿】防竞态落地（epoch 完整版的精简等效实现）：hook 新增 `selectedComposerSelectionThreadId`（commit 时记录线程归属，即 design §2.2 的 epoch 语义最小化）；repair effect 加 opt-in 守卫——标志非空且 ≠ activeThreadId（切换窗口）即拒绝回写；无标志信息放行（向后兼容）→ D1 红转绿
- [x] 2.4 codex repair effect 保留但窗口免疫（比删除更小步：repair 的 effort 归一职责仍有效，仅 stale 窗口被守卫拦截）；既有 repair 测试（含 unprefixed local codex / DSH skip / Claude skip）全绿
- [x] 2.5 W5/W7 外部直写不收口 → **简化裁决**：D1 已由「commit 归属标志」根治，外部直写（send/layoutNodes）本身带明确 threadId 参数、无窗口歧义，统一入口化留待后续演进（非本 change 必要路径，design 记录）
- [ ] 2.6 【验证】0.2 基线 + 新用例全绿 → **63/63（section 30 + hook 18 + 决策核心 11 + flow 4）**；提交：`fix(app-shell): 会话切换窗口账本同步标志守卫，杜绝 codex repair 跨线程污染（D1）`

## Phase 3 · draft carry 门禁升 profile 粒度（修 D2）——重界定为另案

- [x] 3.1 【评估】实施前提核对：`shouldApplyDraftComposerSelectionToThread` 只有 threadId（engine 粒度）；profile 维度需要 draft 数据结构携带来源 profileId + 目标线程 profile 解析（pending 新线程尚无 profile 绑定，需接 codex provider catalog 域语义）→ **超出本 change 边界（数据结构 + 跨域），另立 change 实施；本 change 记录裁决留档**

## Phase 4 · 生命周期收口（修 D4/D5）

- [x] 4.1 【红→绿裁决】D4 守卫测试：线程 A 用户锁模型 + 全局残留 vs 线程 B 自身账本 → **显示路径现状已账本优先（getEffectiveSelectedModelId ledger-first），绿**；用户锁残余影响仅剩 Home/无线程场景的 preferred 语义（设计内行为）；D1 修复后污染写入路径已消除
- [x] 4.2 N/A（无需修复实现；守卫测试保留回归）
- [x] 4.3 【红→绿裁决】D5 守卫测试：目标已有 selection 时迁移拒绝（canonical 匹配也不覆盖）→ **`!hasTargetSelection` 守卫现状已存在，绿**
- [x] 4.4 提交随收口（守卫测试 + 裁决文档）

## 收口

- [ ] 5.1 `openspec validate refactor-composer-thread-selection --strict` 通过；design §5 回填表补齐
- [ ] 5.2 全量回归：Phase 0 基线 + 新增 D1-D5 红转绿用例全绿；`check:app-shell:governance`；tsc 零新增
- [ ] 5.3 真机手测矩阵：同引擎多会话快切 5+ 轮（claude/codex 各一组）、跨引擎互切、codex managed↔三方互切、新会话↔老会话混切、fork 会话——每次切回断言下拉显示 = 该会话上次模型
- [ ] 5.4 README 索引行；sync specs（新增 `composer-thread-selection-resolution` + MODIFIED `codex-composer-startup-selection-stability`）
- [ ] 5.5 archive（待 5.3 通过）
