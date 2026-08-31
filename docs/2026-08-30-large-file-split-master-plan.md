---
type: plan
status: active
created: 2026-08-30
---

# 大文件拆分主计划(2026-08-30)

> 目标:以投入产出比(ROI)排序,系统性消化全仓大文件债务,并用治理机制锁死反弹。
> 本文档是 dated snapshot;每轮选目标时仍以 `npm run check:large-files:near-threshold` 的 live watchlist 校准(见 §10)。
> 上一代计划 `docs/large-file-split-plan-2026-07-01.md` 已丢失,本文档取代之。

## 0. 现状度量(2026-08-30 实测)

| 指标 | 2026-07-01 | 2026-08-30 | 变化 |
|---|---:|---:|---|
| >800 行文件(TS/TSX/Rust) | 234 | **369** | +58% |
| 其中前端源码(非测试) | 110 | 137 | +27 |
| 其中前端测试 | 69 | 86 | +17 |
| 其中 Rust | 55 | **106** | +93%(恶化最快) |
| >2000 行文件 | 68 | **107** | +57% |
| 全仓最大文件 | — | `shared_session_v2.rs` **7685 行** | 新增 |

**7 月计划执行回顾**(已落地,勿重复):`types.ts`→15 行桶✓、`services/tauri.ts`→690 行✓、`Messages.tsx`→12 行 facade✓、`app-shell.tsx`→1 行✓。
**7 月结论中已过时的**:①`sendMessageToThread` 实测 3010 行(非 1414);②`daemon_state.rs` 的 `pub(super)` 实测 114 处(非 88);③`SettingsView.tsx` 已无 `@ts-nocheck`;④i18n 只有 en/zh 需手工重切,其余 8 个 locale 是 `build-locale.ts` 生成产物,保持单文件即可;⑤`useAppServerEvents.ts` 纯 helper 实测 51 个(非 40),`dispatchAppServerEvent` 已涨至 1765 行;⑥`claudeHistoryLoader.ts` 模块级函数实测 79 个(非 66)。

**治理现状**:`scripts/check-large-files.policy.json`(v4, 2026-08-25)+ baseline 棘轮 + 周频 CI(`.github/workflows/large-file-governance.yml`,无 PR trigger)。三个缺口:
1. 存量 baseline 只冻结不缩减,`retained` 状态永不阻塞 → 巨兽可永久躺平;
2. fail 阈值 2600-3000 过高,800-2600 区间的膨胀(如 `SessionManagementSection` 2547→2648)完全无感知;
3. `src-tauri/src/` 根级文件(shared_session_v2 等 7 个)落 default-source(fail 3000),恰是恶化最快区域的治理盲区。

## 1. 总目标与验收指标

**北极星**:全仓源码文件 ≤2000 行(显式登记豁免除外);>800 行文件数进入净下降通道;拆分成果被棘轮锁死不反弹。

| 里程碑 | 时点 | 验收 |
|---|---|---|
| M0 治理修复 | 第 1 周 | policy v5 落地;7 个根级 Rust 纳管 P0;baseline 重生成;gate 绿 |
| M1 零风险热身 | 第 2 周末 | >2000 行 ≤92;全仓最大文件 <6500;Rust 内联测试外移 ~9200 行 |
| M2 高 churn 中枢 | 第 6 周末 | feature-hotpath 区活跃文件全部 <2400;useLayoutNodes/Composer/useThreadMessaging 完成主体拆分;>2000 行 ≤55 |
| M3 巨兽攻坚 | 第 10 周末 | 全部源码 <2000(git-history 与登记豁免除外);P0 区全部 <2600;>2000 行 ≤10 |
| M4 git-history + 长尾 | 第 12 周起 | git-history 四层架构落地;长尾滚动机制运转;>800 行总数逐版本递减 |

## 2. ROI 排序模型

- **收益** = 可削减行数 × churn(并行冲突/审查成本) × 治理区压力(超 fail 倍数)
- **投入** = 耦合度(纯搬运 < helper 外移 < 闭包/architecture)+ 测试迁移成本 + 可见性变更面 + churn 冲突窗口
- **排序结论**:零风险纯机械先行(立威+验证模板+快速冲量)→ 高 churn 中枢(收益最大,配降冲突纪律)→ 巨兽攻坚(前置可见性手术)→ git-history 架构级收尾。
- **防反弹先行**:治理修复(阶段 0)必须先于大规模拆分,否则边拆边涨。

## 3. 阶段 0:治理修复(第 1 周,2 个 PR)

### PR 0.1 — policy v5:纳管根级 Rust + 降阈值

`scripts/check-large-files.policy.json`:
1. `bridge-runtime-critical.match.exactPaths` 追加 7 个精确路径:`shared_session_v2.rs`、`shared_runtime_coordinator.rs`、`session_management.rs`、`skills_hub.rs`、`local_usage.rs`、`types.rs`、`shared_sessions.rs`(均 `src-tauri/src/` 前缀)。
   - ⚠️ **严禁**加 prefix `"src-tauri/src/"`:policies 是 first-match-wins 且 exactPaths/prefixes 为 OR,会把 `main.rs`/`lib.rs` 全部吞进 P0/2600 门。
2. 新增 sections 防反弹条目:prefix `src/features/settings/components/settings-view/sections/`,fail 2000、warn 1500(登记 `SessionManagementSection` 2547→2648 反弹史)。
3. bump `version` 至 `2026-08-30.policy-v5`。
4. **同 PR 内**重生成 baseline:`npm run check:large-files:baseline`(否则新越线文件以 `status=new` 立即阻塞 gate)。baseline diff 必须在 PR 描述中作为治理变更说明(playbook 硬性要求)。

### PR 0.2 — 严格棘轮(可选,Wave 2 前启用)

- scanner `check-large-files.mjs` 加 `strictReduction` 可选字段(~15 行+更新 `check-large-files.test.mjs`):对标记 policy,把 `retained`/`within-allowance` 重分类为阻塞。
- ⚠️ 不得全局阻塞 retained(会把全部存量一次性打红);只对已完成一轮拆分的 policy 组逐步启用。
- 顺带评估给 `.github/workflows/large-file-governance.yml` 加 `pull_request` trigger(mode=fail 很快),让 gate 成为真 PR blocker。

**阶段 0 验证**:`npm run check:large-files:gate` 绿;`npm run check:large-files` 报告中 7 个根级 Rust 以新 policyId 显示为 retained。

## 4. Wave 1:零风险热身(第 1-2 周,~14 PR)

选品原则:纯搬运、零调用点改动、测试锁行为不锁内部。两条轨道可并行。

### 轨 A:Rust 内联测试外移(纯收益 ~9200 行)

| 文件 | 现状→目标 | 测试行数 | 落点 | 注意 |
|---|---|---|---|---|
| `engine/status.rs` | 4594→~3018 | 1576 | `engine/status_tests.rs` | 零风险,最大单笔 |
| `shared_session_v2.rs` | 7685→~5331 | 2354(7 个 mod) | `shared_session_v2/` tests 或平铺 7 文件 | 全仓最大文件先瘦身 |
| `shared_runtime_coordinator.rs` | 4864→~2666 | 2198 | `coordinator_tests.rs` | 测试直接构造私有字段 → 用 `include!` 模式(session_management 先例)或先放宽可见性 |
| `engine/pi.rs` | 4280→~3160 | 1120 | `engine/pi_tests.rs` | 平铺,参照 `commands_tests.rs` 先例 |
| `shared_sessions.rs` | 2816→~2058 | 758 | `shared_sessions_tests.rs` | — |
| `skills_hub.rs` | 3574→~3059 | 515 | 同上 | env 隔离设置顺序保持 |
| `types.rs` | 2828→~2340 | 488 | 并入 types/ 目录拆分(轨 B) | — |

验证:`cargo test --manifest-path src-tauri/Cargo.toml <module>` 全绿 + `cargo check`。

### 轨 B:纯机械搬运

**B1. `claudeHistoryLoader.ts`(2552→~650,全仓性价比之王,4 个连续小 PR)**
模块级函数 79 个、零可变状态,~1900 行可外移。目标布局:
`claudeHistoryPrimitives.ts`(~250)、`claudeControlPlaneClassifier.ts`(~500)、`claudeAskUserQuestion.ts`(~290,i18n 依赖随 2 函数外迁)、`claudeToolExtraction.ts`(~260)、`claudeFileChangeInference.ts`(~140)、`claudeReasoningMerge.ts`(~100)、`claudeAssistantFinalTiming.ts`(~130)、`claudeSyntheticApprovalResume.ts`(~110)、`claudeShadowRecovery.ts`(~420)、`claudeHistoryTokenUsage.ts`(~45)。
主文件保留 `parseClaudeHistoryMessages`(320 行耦合枢纽)+ factory + **再导出 5 符号**(`CLAUDE_UI_HISTORY_WINDOW`/`parseClaudeHistoryMessages`/`parseClaudeHistoryMessagesWithShadowRecovery`/`extractClaudeHistoryTokenUsage`/`createClaudeHistoryLoader`,6 个外部消费文件锁面)。
PR 切分:primitives → classifier → ask-user → shadow-recovery。
验证:`npx vitest run src/features/threads/loaders/claudeHistoryLoader.test.ts` + `npx tsc --noEmit`。(`historyLoaders.test.ts` 已核实零 Claude 引用,不锁本文件。)

**B2. i18n settings 重切(en 2700 / zh 2548,1-2 PR)**
- en:`settings.ts` → `settings/index.ts` 桶(`{ settings: {...appearance, ...engines, ...behavior, ...services} }`)+ 4 子文件:`appearance.ts`(~600)、`engines-vendors.ts`(~700)、`workspace-behavior.ts`(~700)、`services.ts`(webService+email+diagnostics,~600)。zh 手工同步同切。
- 其余 8 个 locale(2143×8)是 `build-locale.ts` 生成产物,**保持单文件**,重跑生成器零 diff。
- ⚠️ 硬约束:2146 处 `t("settings.*")` + 动态模板 key(`vendor.${keyPrefix}.${suffix}` 等)→ **key 路径逐字节不变**,只允许改文件布局;`./settings` 导入路径由 `settings/index.ts` 天然接住,2 个外部 importer(deferred.ts×10、ProviderDialog.test.ts)不受影响。
- ⚠️ 已知 hack:10 个 locale 的 `index.ts/critical.ts/deferred.ts` 是手工改写的两段式,**重跑生成器会覆盖**,本 PR 不动它们;后续可单独立项让生成器原生支持两段式。
- 验证:i18n parity/placeholder 校验 + `criticalShellKeys.test.ts`(断言 settings 不得进 critical 包)+ `npx tsc --noEmit`。

**B3. `types.rs`(2828→mod.rs<50 行,1 PR 快速落地,churn 48 全仓最高)**
`types/` 目录:`git.rs`(~410)、`settings.rs`(AppSettings+60 个 `default_*` fn+impls,~1250)、`workspace.rs`(~280)、`email.rs`(~200)、`providers.rs`(~150)、`usage.rs`(~90)、`tests.rs`(488);mod.rs 仅 `pub(crate) use *::*` 重导出。
⚠️ **93 个引用文件全仓最高扇出** → 纯搬运+桶重导出,禁止顺手改名;serde `default_*` fn 必须与 struct 同桶(或升 `pub(crate)` 用显式路径)。
验证:`cargo check` + `cargo test types`。

**B4. `skills_hub.rs`(3574→~400,Rust 端风险最低)**
仅 1 个引用方、2 个 `pub(crate)`。`skills_hub/` 目录:`fsutil.rs`(~350)、`registry.rs`(~130)、`http.rs`(~140)、`targets.rs`(~300)、`lifecycle.rs`(~470)、`discover.rs`(~340)、`updates_popular.rs`(~340)、`usage.rs`(~400)、`tests.rs`(~515)。
注意:`reqwest` client 单例与 `read_registry` 内 trash purge 隐式时机保持。
验证:`cargo test skills`。

**B5. `codex/mod.rs`(3120→~600,七文件最低风险立威)**
已是扁平 `pub(crate)` 函数池、19 个子模块先例。新增 6 兄弟模块:`doctor_family.rs`(~410)、`thread_lifecycle.rs`(~490)、`control_ops.rs`(~490)、`shared_control.rs`(~300)、`commit_message_gen.rs`(~370)、`title_metadata.rs`(~460);mod.rs 留 helper+`send_user_message`。
⚠️ 75 个 `pub(crate)` 消费面横跨全 crate,重导出必须穷尽——`cargo check` 一次兜底。
验证:`cargo check` + `cargo test codex`。

**B6. `useQueuedSend.ts`(2648→~1150,churn 12 全仓最低,前端热身首拆)**
`queuedSendHelpers.ts`(~500,纯区 L56-549)、`useQueueDrainEffects.ts`(~450,10 个 drain effect)、`useQueuedFusion.ts`(~560,fuse 系)。
⚠️ drain flag 模块级可变单例(`__setEnableBackgroundQueueDrainForTests`)被测试实现级锁定 → 保 export + 原文件 re-export。唯一外部消费者:`useComposerController.ts`。
验证:`npx vitest run src/features/threads/hooks/useQueuedSend.test.tsx` + tsc。

**B7. `useThreadActions.helpers.ts`(2646→~350+re-export 桶)**
已是纯函数模块(~60 export,95% 可外移):`useThreadActions.recovery.ts`(~700)、`.engineSummaries.ts`(~760)、`.continuityMerge.ts`(~450)、`.rewind.ts`(~180)。
⚠️ helpers.test.ts(1932 行)直接 import 各 export → helpers.ts 留 re-export 桶,测试零改动。
验证:`npx vitest run src/features/threads/hooks/useThreadActions.helpers.test.ts` + tsc。

**B8. `useThreadsReducer.ts` 一期(3728→~3300)**
仅做零风险部分:`threadReducerEqualityGuards.ts`(~180,L291-437)、`threadReducerProviderBinding.ts`(~110)、`threadReducerCompleteAgentMessage.ts`(~200,L3546-3728 整函数)。
⚠️ `__profile` 导出被 `useLayoutNodes.tsx` 消费,不得改名/移位;`threadReducerTestProjection` 被测试直接 import,路径稳定。
验证:`npx vitest run src/features/threads/hooks/useThreadsReducer.test.ts src/features/threads/hooks/useThreadsReducer.append-agent-delta-fast-path.test.ts src/features/threads/hooks/threadReducer*.test.ts` + tsc。

**B9. `cc_gui_daemon.rs` 内联 mod 落盘(3076→~2450)**
7 个内联 mod 体(~620 行)落盘为已有同名文件(`state/event_sink/remote_backend/session_index/shared_sessions/codex/files.rs`);内联体内 `use crate::…` 绝对路径基本原样可用。
⚠️ 根部有 20 行 `include_str!` 自引用回归测试,落盘后确认断言路径仍命中。
验证:`cargo check --bin cc_gui_daemon` + `cargo test --bin cc_gui_daemon`。

## 5. Wave 2:高 churn 中枢(第 3-6 周,~12 PR)

降冲突纪律(全 Wave 通用,churn≥48 的文件强制):
1. 逐字搬运——变量名/语句顺序/deps 数组零改动,语义改名留独立后续 PR;
2. 每 PR 只删一段连续区间,PR 生命周期 <2 天,合前 rebase;
3. 抽取 PR 评审期间冻结通告:被搬区间的并行改动改投新文件;
4. useMemo 壳与 deps 数组留在调用点逐字不动(「lint 绿≠memo 生效」教训)。

### 链 A:threads hooks 依赖分层(leaf-first)

依赖序(实测):`helpers`/`ItemEvents`/`QueuedSend` 是叶子 → `ResumeThread`(→helpers)/`EventHandlers`(→ItemEvents)→ `ThreadActions` → `Threads`(L3,Wave 3)。
(QueuedSend、helpers 已在 Wave 1 完成)

**A1. `useThreadItemEvents.ts`(2624→~1350)**
`threadItemEventPredicates.ts`(~350,L93-431 纯函数,有测试直接 import,export 名不变)、`useRealtimeDeltaQueue.ts`(~380)、`useNormalizedRealtimePipeline.ts`(~520)。
⚠️ 队列与管线共用 unmount flush,保 `flushPendingRealtimeEvents` 聚合入口;「分段前 drain 尾段」语义逐字。
验证:`npx vitest run src/features/threads/hooks/useThreadItemEvents*.test.ts*` + tsc。

**A2. `useThreadEventHandlers.ts`(2745→~700,须在 ItemEvents 后——其测试直接 import ItemEvents)**
`useTurnDiagnosticsRuntime.ts`(~1050,9 个共享 timer refs 的工厂 hook,返回 {schedule/clear/note/quarantine/emit})、`useTurnLifecycleHandlers.ts`(~720)、`useDeferredCompletionReconciliation.ts`(~280)。
⚠️ 55 回调共享 timer refs:工厂返回值注入而非各自新建;handlers useMemo 的 35-key deps 是 memo 生效边界,拆后引用稳定。
验证:`npx vitest run src/features/threads/hooks/useThreadEventHandlers.test.ts` + tsc。

**A3. `useThreadActionsResumeThread.ts`(2293→~1300)**
⚠️ **前置**:`useThreadActionsResumeThread.dshDown.policy.test.ts`(31 行)是源码文本锁(readFileSync+regex),拆分前必须先改写为行为测试或跨文件断言。
`useThreadActionsResumeThread.legacyFallback.ts`(~580,per-engine 分支)、`.recoveryProbe.ts`(~420)。
验证:`npx vitest run src/features/threads/hooks/useThreadActionsResumeThread*` + claude-history 集成测试。

**A4. `useThreadActions.ts`(3066→~1700,churn 68)**
`listThreadsForWorkspace` 单回调 2600 行:`useThreadActions.indexEarlyPaint.ts`(~420,Session Index 早画)、`useThreadActions.engineAsyncMerge.ts`(~920,DSH/Grok/PI 三段异步 merge);前导+codex 分页+shared 合并+hide 闸门 ~1300 行留壳。
⚠️ 20 个测试文件(~13k 行)实锤的 timeout/partial-source/hide 契约雷区;stage 抽取保持 dispatch 次序与 seq 所有权(ownsRequest 结算 L2956-2966)。
验证:`useThreadActions*.test.tsx` 全 20 个文件 + tsc。

### 链 B:composer / sidebar / layout(按护栏厚度排序:useSidebarMenus → Composer → Sidebar → useLayoutNodes)

**B1. `useSidebarMenus.ts`(2693→~1100)**
`sidebarMenus/` 目录:`types.ts`(~350)、`constants.ts`(~80)、`sessionMenuItemBuilders.ts`(~330)、`useProviderContinuationDialog.ts`(~430)、`useWorkspaceEngineMenuState.ts`(~330);index.ts 桶导出,`useSidebarMenus` 原路径 re-export。
⚠️ continuation 取消竞态测试(时序敏感)逐字搬运;remembered-provider 不可用最底行有测试锁定。
验证:`npx vitest run src/features/app/hooks/useSidebarMenus.test.tsx` + tsc。

**B2. `Composer.tsx`(4127→~2000,churn 98)**
`Composer/` 子目录(ChatInputBox/ 范式):`types.ts`(~300)、`utils.ts`(~120)、`composerMemo.ts`(~100)、`hooks/useContextUsageProjection.ts`(~200)、`hooks/useComposerContextSelections.ts`(~500)、`hooks/useComposerRewind.ts`(~280);主文件留 props 解构+`handleSend`(400 行)+target 回调+JSX。
⚠️ 状态+回调整组搬禁半拆;usage useMemo 逐字(result usage 语义有前科);比较器字段顺序不动;`ComposerRewindDialogRequest` 等类型被 useLayoutNodes 跨包引用,原路径 re-export。
验证:13 个 `Composer.*.test.tsx` 全量 + tsc。

**B3. `Sidebar.tsx`(2847→~1300,churn 66;逻辑先行,JSX 最后)**
hooks:`useSidebarProviderCatalogs.ts`(~200)、`useSidebarThreadProjections.ts`(~360)、`useSessionFolderActions.ts`(~580,与 projectionCache 整组搬)、`useSidebarCollapseAll.ts`(~80);utils:`sidebarSearch.ts`(~60)。
最后单独 PR:`renderWorkspaceEntry`(310 行)组件化为 `SidebarWorkspaceEntry.tsx`。
⚠️ 测试**锁 DOM 结构+class 名**(`.sidebar-primary-nav` 等 querySelector 断言)→ 逻辑抽取安全,JSX 拆分必须渲染输出逐字节一致。
验证:`Sidebar.test.tsx`(3608 行)+ `Sidebar.styles.test.ts` + tsc。

**B4. `useLayoutNodes.tsx`(3235→~1500,churn 151 全仓第一,6-8 个微型 PR)**
`layoutNodes/` 子目录:`engineResolve.ts`(~180)、`sidebarNode.tsx`(~280)、`messagesNode.tsx`(~160)、`composerNode.tsx`(~400)、`gitDiffPanelNode.tsx`(~400)、`panelNodes.tsx`(~500)、`chromeNodes.tsx`(~350);模式=useMemo 壳留 hook 内、JSX 体搬出为 `buildXNode(propsBag)`(layoutNodeSections.tsx 先例)。
⚠️ 消费方 `useAppShellLayoutNodesSection.tsx`(2531)的 options 拆分(canvasOptions/chromeOptions/gitOptions ~600/个)放最后一期,与 hook 拆解耦;`__profile` 锚点不动;memo 引用稳定性被测试间接锁定。
验证:`useLayoutNodes.client-ui-visibility.test.tsx` + `npm run check:app-shell:governance` + tsc。

### 链 C:reducer 二期 + messaging

**C1. `useThreadsReducer.ts` 二期(3300→~1200-1500)**
六大块改 `reduceXxx(state, action)` + 薄 case(先例 `reduceNormalizedRealtimeEvent`):`threadReducerEnsureThread.ts`(~370)、`.setThreads.ts`(~300)、`.upsertItem.ts`(~300)、`.agentDelta.ts`(~170,profile 计数点随函数走且语义不变)、`.codexCompaction.ts`(~130)。
⚠️ flag 常量在拆出文件各自 import 并保持模块级只求值一次;测试纯黑盒(只 import `{initialState, threadReducer}`),内部搬迁不可见。
验证:同 Wave 1 B8 全量。

**C2. `useThreadMessaging.ts`(4600→~2200-2500,本 Wave 最难)**
拆法=段级外移+`SendMessageContext` 参数对象化(49 项 deps 打包,薄壳每次调用现构 ctx,**禁止缓存 ctx** 防 stale closure):
`threadMessagingTypes.ts`(~200)、`threadMessagingMemoryPick.ts`(~200)、`threadMessagingSharedSend.ts`(~500,`runSharedV2Send(ctx,args)`)、`threadMessagingPickGate.ts`(~300)、`threadMessagingNativeResolve.ts`(~320)、`threadMessagingInterrupt.ts`(~360)。
⚠️ **顺序硬约束**:先外圈(interrupt/review)后主干——`sendMessageToThreadRef.current` 自递归(L647-720)与 interrupt/review 反向捕获构成环;内层闭包 `retryCodexSendAfterThreadRefresh`(L2185)必须随 native 段整体搬,不可单抽。
⚠️ return 对象 ~40 键是事实契约(消费者 useThreads/useQueuedSend);mock 打在服务边界,抽出文件继续从原路径 import 服务。
验证:`useThreadMessaging.test.tsx`(4101 行)+ `threadMessagingHelpers.*.test.ts` + `useCodexMessageRecovery`/`useOrphanTurnWatchdog` 测试;高风险段(shared/pickGate)逐段落地每段跑全量。

### 链 D:Rust engine/commands.rs(5452→~1300)

已有 4 个 `#[path]` 平铺先例,不搞子目录:
`commands_send.rs`(~2300,`engine_send_message` 2284 行按 8 引擎臂逐个抽自由函数:Pi 452/Claude 391/Qoder 301/Kimi 266/Grok 266/Codex 231/Gemini 218/Dsh 52)、`commands_send_sync.rs`(~900)、`commands_opencode_catalog.rs`(~600)、`commands_pi_rpc.rs`(~320,消掉唯一 pub(super))。
⚠️ 臂内捕获局部变量面宽(~10 个上下文参数)→ **按臂逐个抽、每步编译**;`engine/mod.rs` 的 `pub use commands::*` glob 保 command_registry 零改动。
验证:每臂抽完 `cargo check`;完事 `cargo test --manifest-path src-tauri/Cargo.toml engine`。

## 6. Wave 3:巨兽攻坚(第 7-10 周,~14 PR)

### Rust

**R1. `daemon_state.rs`(5353→分 9 块,churn 56,最高风险,前置手术)**
- **前置独立 PR**:`sed` 批量 `pub(super)`→`pub(crate)` 共 **114 处** + `cargo check` 兜底(拆入 `daemon_state/` 孙模块后 pub(super) 只达 daemon_state,而 dispatch 在 crate 根)。`DaemonState` 字段私有但孙模块是后代,无需改字段可见性。
- 目标:`daemon_state/mod.rs`(~250)、`workspaces.rs`(~480)、`settings_doctor.rs`(~400)、`engine_detect.rs`(~200)、`engine_send.rs`(~2050)、`engine_send_sync.rs`(~570)、`session_history.rs`(~500)、`codex_ops.rs`(~620)、`session_listing.rs`(~234)、`interrupt_web_file.rs`(~185);每文件一个 `impl DaemonState` 分块。两个 send 巨方法(2610 行)按引擎臂抽自由函数回收。

**R2. `engine/claude.rs`(3430→~350 聚合层)**
全部落在已有 `engine/claude/`:`session_state.rs`(~500)、`command_build.rs`(~300)、`interrupt.rs`(~240)、`tool_tracking.rs`(~490)、`send_attempt.rs`(~1150)。
⚠️ `send_message_attempt`(1100 行)内部引用 30+ `self` 辅助方法→**整函数搬迁、最后拆、勿拦腰切**;`pub(crate)`×29 被 daemon 直接消费,重导出穷尽。
验证:外部 6 个测试文件 ~5266 行全量 + cargo check。

**R3. `shared_session_v2.rs` 主体(5331→mod.rs ~800)**
`shared_session_v2/`:`execution_target.rs`(~700)、`binding_state.rs`(~370)、`turn_lifecycle.rs`(begin/commit/recover ~1600)、`dispatch_settlement.rs`(~720)、`receipt.rs`(~560);mod.rs 保留 16 个 `#[tauri::command]` 壳 + `pub(crate) use *::*`。
⚠️ 9 个引用方;不得反向引入 `shared_sessions`(v1)的新依赖(现状 v2→v1 单向)。

**R4. `shared_runtime_coordinator.rs` 主体(2666→~1300)**
`ingress.rs`(~800)、`canonical_blocks.rs`(~400)、`identity.rs`(~250);impl 核心留 mod.rs。7 个引用方。

**R5. `session_management.rs`(4008→~600,20 个引用方全仓最多之一)**
沿用既有 `#[path]` 平铺先例:`session_management_commands.rs`(15 命令壳 340)、`_delete_core.rs`(~570)、`_metadata_keys.rs`(~1340,qoder legacy rekey)、`_folder_core.rs`(~430)、`_global_catalog.rs`(~855)。
⚠️ `include!` 测试直接吃私有 fn → 外移函数被测试用到的须升 `pub(crate)`,测试与外移同 PR 搬。

**R6. `shared_sessions.rs`(2058→mod.rs ~700)**
`thread_id.rs`(~180,v1/v2 共用面=v2 的 import 清单 L42-47)、`store.rs`(锁+meta IO ~600)、`selection.rs`(~400)、`delta_sync.rs`(~170)。
⚠️ 8 个 tauri 命令仍在注册,**不是死代码**;daemon bin 也消费 meta 读取;与 v2 拆分分两个 PR(churn 叠加)。

**R7. `workspaces/commands.rs`(3493→~1900)**
open-app 探测簇(722 行,高度自包含)→ `workspaces/open_app.rs`(~750);worktree 簇(~570)并入既有 `workspaces/worktree.rs`(32 行,几乎空);spec/external 文件命令 → `external_spec_files.rs`(~260)。
⚠️ mod.rs 已有 glob 重导出垫,新子模块重导出注意通用名冲突(`open_workspace_in` 等)。

**R8. `git/mod.rs`(2720→~400)**
`git/push.rs`(~240)、`diff_collect.rs`(~400)、`pr_workflow_helpers.rs`(~240)、`remote_forward.rs`(~480 含 test-only 矩阵,cfg(test) 整体搬)、`tests.rs`(874)。
⚠️ **关键耦合**:`git/commands.rs` L1 `use super::*` glob 消费 mod.rs 私有 helper → 外移 helper 必须升 `pub(crate)` 并在 mod.rs 重导出;同步给 `git/commands.rs`(2343 行)立 2000 行红线防"拆后再淤积"。

### 前端

**F1. `useAppServerEvents.ts`(3818→~2100,二期再切 dispatcher)**
一期:`appServerEventExtractors.ts`(~700,51 个纯函数)、`appServerEventEmitters.ts`(~250)、`appServerEventNormalizedRouting.ts`(~450)、`appServerEventTypes.ts`(~230);原文件留 dispatcher+batch+hook+全量再导出。
二期(可独立排期):`dispatchAppServerEvent`(1765 行,61-key handlers)按 turn/item/thread/collab 四族切 `dispatch/*.ts`。
⚠️ dispatcher 闭包变量跨分支共享、method 分支顺序敏感(早 return 语义);测试锁面=4 个导出函数签名+2 个 backpressure 再导出。
验证:6 个测试文件(4327 行主测试等)全量 + `services/events.test.ts` + tsc。

**F2. `GitDiffPanel.tsx`(3279→~2000,churn 43)**
- 先行单独 PR:`DiffTreeSection`(546 行,零闭包已核实)→ `GitDiffPanelTreeSection.tsx`(~580,props 21 个原样搬迁勿顺手精简)。
- 后续:`useGitDiffPreview.ts`(~350)、`gitDiffContextMenus.ts`(~380)。
⚠️ 10 个测试文件锁再导出面 → **任何外移符号必须从原文件再导出**(L176 已有先例);61+ 未 memo 回调是既有性能债,禁止顺带重构。
验证:10 个 GitDiffPanel 测试文件 + styles.test + tsc。

**F3. 面板五件(各 1-2 PR)**

| 文件 | 现状→目标 | 首选刀法 | 关键风险 |
|---|---|---|---|
| `FileViewPanel.tsx` | 3149→~1500 | 右键菜单 builder(470,先定义 `FileViewContextMenuDeps` 参数对象)+ 图片/拖拽 2 自含 hook + 3 渲染段 | tab 拖拽连 ref 移交;17 个测试文件中 vi.mock 整模块对 import 路径敏感 |
| `WorkspaceSessionActivityPanel.tsx` | 2679→~1000 | 纯 helper 层 530 行零风险起步;再 TurnArtifacts/FollowBubble/DiffPreview/TimelineEventCard | running 2s 状态机跨 4 ref+timer,整体搬迁勿对半切;`renderSemanticSummaryList` 签名被 aria 测试锁 |
| `SessionManagementSection.tsx` | 2648→~1100 | curtain 全链路独立(`useSessionCurtain` ~700 + Dialog 140)+ FolderNav 260 + utils 下沉 200 | **防反弹**:阶段 0 的 sections 2000 行闸门是前置;close-on-delete 纳入 curtain hook;exported helper 保留 re-export 一轮 |
| `SettingsView.tsx` | 2611→~800-1000 | **状态下沉**(非新文件):外观/open apps/分组/快捷键各归 section;8 个同构 doctor 回调收敛为注册表泛型 `useDoctorRunner`;删死代码 picker(~50) | 测试迁移成本最大:doctor/外观测试经顶层断言,先加 section 级直渲染测试再下沉;lazy/Suspense 边界勿动 |
| `FileTreePanel.tsx` | 2622→~1100 | `fileTreeContextMenu.ts`(500,deps 对象)+ 3 自含 hook(preview popover/lazy children/item operations) | memo 推导链是性能敏感区(30s 轮询前科),保持引用稳定粒度;menu item id 不变 |

**F4. `useThreads.ts`(3385→~2500,L3 编排器,Wave 2 链 A 稳定后才动)**
仅做三个自含域:`useThreadsMemoryCapture.ts`(~520)、`useThreadAutoNaming.ts`(~320)、completion email(~130,并入既有 hook)。
⚠️ refs 内核(~30 个共享 refs,55+ 回调的总线)~1800 行不可拆,留壳;re-export 透传块(L83-150)是对外 API 不得动;外部消费者 `useAppShellRuntimeThreadHost`。
验证:7 个 useThreads 集成测试文件(1387+1519+1077+767+337+291+220 行)全量。

## 7. Wave 4:git-history 目标架构 + 长尾(第 11-12 周起)

### git-history-panel(全目录 26,016 行,4 文件超阈值)

现状:scope:any 已清除,但被两个显式巨型类型取代——`GitHistoryPanelInteractionScope`(~328 字段)/`GitHistoryPanelViewScope`(~471 字段),且**依赖方向倒置**(View/Dialogs/hook 从 Impl import 自己的 scope 类型)。两个治理脚本(`check:git-history:runtime-contract`/`static-imports`)钉死 4 个锚点函数——**拆分期间锚点必须原地不动**,子抽取不受限。

目标分层:`GitHistoryPanelTypes.ts`(scope 类型迁出,破倒置)→ container(Impl<1500)/ hooks 按域 / view 纯渲染 section / dialogs 按族。

拆序(leaf-first,每步 contract 保持绿):
1. **Dialogs(2076)先**——纯叶子:抽 force-delete/reset dialog 族到 `components/dialogs/`,本体退化为编排器;
2. **Hook(2878)**:抽 PR 创建+sync/push preview 处理器组(照搬 `useGitHistoryPanelBranchContextMenu`/`BranchCompareHandlers` 先例);
3. **View(3425)**:抽最大 commit-details/diff 面板段,收窄 sub-scope;
4. **Impl(4933)最后**——scope 契约拥有者:先把两个 scope 类型块(~900 行)迁入 Types,再抽数据加载 effects。

### 长尾滚动机制(替代静态队列)

遵循 playbook「不维护静态拆分队列」:每个版本周期初跑 `npm run check:large-files:near-threshold`,从 `.artifacts/large-files-near-threshold.json` 按 churn × 行数选 top-N(建议 N=5)纳入该版本拆分;测试文件(86 个 >800)随主体拆分同 PR 顺带拆,>3000 的孤儿测试单开低优先级轨。

## 8. 每 PR 标准执行卡

1. **分支**:`refactor/split-<file>-<segment>`,从最新 main 切;
2. **测试先行确认**:拆分前跑通目标文件全部关联测试(锁行为),文本锁/源码锁测试先改写(已知唯一:`useThreadActionsResumeThread.dshDown.policy.test.ts`);
3. **逐字搬运**:不重命名、不调语句顺序、不顺手重构、不顺手删死代码(发现则记录,另开 PR);
4. **facade/重导出**:原文件保留 re-export 桶,import 路径零漂移;Rust 侧 `pub use` 保 command_registry/调用点零改动;
5. **验证命令矩阵**:
   - 前端:`npx tsc --noEmit` + `npx vitest run <关联测试全量>` + `npm run check:large-files:gate`;涉 app-shell/git-history/messages 边界加跑对应 `check:*` runtime-contract;
   - Rust:`cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --manifest-path src-tauri/Cargo.toml <module>`;
6. **baseline 维护**:拆分永久减少债务的 PR 内重生成 baseline(`npm run check:large-files:baseline`);新文件 >800 行需同 PR 重生成 new-file baseline 并在 PR 描述登记治理豁免;baseline diff 视为治理变更审查,禁止当生成噪音;
7. **merge guardrails**(AGENTS.md):高风险大文件禁止整文件 `--ours/--theirs`,逐段 semantic merge;合前 rebase,PR 窗口 <2 天(高 churn 文件);
8. **PR 描述模板**:迁移区段行号对照表 + 保留能力说明 + 验证输出粘贴 + baseline 变更原因。

## 9. 风险登记册(历史教训,拆分期间每日对照)

| 风险 | 来源 | 对策 |
|---|---|---|
| prettier `--write` 炸既有文件(3 处→64 hunk 前科) | memory | 只格式化新增文件;误跑用 `git restore` 回暂存版重做 |
| `vi.mock` 整模块对 import 路径敏感 | AppShell 拆分教训 | 抽出文件保持从原路径 import 服务;mock 目标路径不动 |
| 「lint 绿≠memo 生效」 | P0 sidebar 教训 | useMemo 壳+deps 逐字留调用点;引用稳定性由测试间接锁定 |
| 源码文本锁测试 | ResumeThread dshDown | 拆分前先改写为行为测试 |
| serde `default_*` 与 struct 分桶 | types.rs | 同桶搬运或显式路径+升 pub(crate) |
| `include_str!` 自引用测试路径 | cc_gui_daemon.rs | 落盘后确认断言仍命中 |
| `__profile` 导出锚点 | useThreadsReducer | 不改名不移位(useLayoutNodes 消费) |
| i18n keySeparator="." 路径 | i18n 重切 | key 逐字节不变,只动文件布局 |
| build-locale 覆盖手工两段式 | i18n | 不重跑生成器,或先让生成器支持两段式 |
| glob 消费私有 helper(`use super::*`) | git/commands.rs | 外移 helper 升 pub(crate)+mod.rs 重导出 |
| pub(super) 114 处可见性断裂 | daemon_state.rs | 前置 sed 批量升级+cargo check,再搬 impl |
| 拆分后反弹(SessionManagementSection 2547→2648) | 7 月教训 | 阶段 0 闸门 + strictReduction + 每 wave 末 baseline 对比 |
| 高 churn 冲突(useLayoutNodes 151/3月) | 代理实测 | §5 降冲突纪律四条 |

## 10. 进度追踪与度量
### 2026-08-31 执行记录（本会话，21 个 commit 落在 feat/code-quality-optimization）

**已完成（全部逐字搬运 + 验证矩阵通过 + gate 绿）**：
- 阶段 0：PR 0.1（policy v5 + 7 根级 Rust 纳管 + sections 防反弹）已于 ba1a5e1cc 落地；本会话修复 gate 至绿
- Wave 1 轨 A 全量：status.rs 4594→3020 / shared_session_v2 7685→5349 / coordinator 4864→2670 / pi.rs 4318→3201 / shared_sessions 2816→2061 / skills_hub 测试外移
- B1 claudeHistoryLoader 2552→1077（primitives/classifier/askUser/shadowRecovery/finalTiming 五件）
- B2 i18n en/zh settings 四桶目录（leaf 等价比对 PASS）
- B3 types.rs 2828→types/ 目录（mod.rs 34 行）
- B4 skills_hub.rs 3574→skills_hub/ 目录（mod.rs 162）
- B5 codex/mod.rs 3120→654（六兄弟模块）
- B6 useQueuedSend 2648→1164（helpers + drain effects + fusion 三刀）
- B7 useThreadActions.helpers 2646→243（四族 + re-export 桶）
- B8 useThreadsReducer 一期 3728→3495（equalityGuards + providerBinding；completeAgentMessage 依赖面 22 项超零风险界，回退留二期）
- B9 cc_gui_daemon.rs 七内联 mod 落盘 3076→2555
- Wave 2：A1 useThreadItemEvents 2668→1726（predicates + deltaQueue + normalizedPipeline 三刀）；A2 useThreadEventHandlers 2747→908（diagnosticsRuntime/lifecycleHandlers/deferredReconciliation）；A3 ResumeThread 2293→1394（文本锁测试已改写为跨文件断言）；B1 useSidebarMenus 2688→2365（types/constants）；B2 Composer 4127→2066（Composer/ 子目录 11 件）；B3 Sidebar 2847→1537（逻辑六件，JSX 未动）；C2 useThreadMessaging 4600→4025（外圈 interrupt/review）；链 D commands.rs 5432→1340（八臂自由函数×async/sync）
- Wave 3：R1 daemon_state 5339→mod.rs 136 + 九分块；R7 workspaces/commands 3493→2224（open_app + worktree 两刀）；R8 git/mod.rs 2720→61（五子模块）
- F1 useAppServerEvents 一期 3843→1981（types/extractors/emitters/normalizedRouting）
- F3 启动：WorkspaceSessionActivityPanel 2679→2086（helpers 层）

**收尾增补（同日稍后落地）**：
- A4 useThreadActions 3066→2244（indexEarlyPaint 324 + engineAsyncMerge 815；dispatch 次序与 ownsRequest 结算原位）
- B4 useLayoutNodes 一期 3235→2935（engineResolve/sidebarNode/messagesNode/composerNode 四段；gitDiffPanelNode/panelNodes/chromeNodes 留二期）
- T3.7 allowlist 登记 legacyFallback.ts（拆分随迁桥）
- 已知存量违规（非本次引入）：useEngineAvailabilityProjection 两处 direct app-shell/ import（分支在途提交 1a7463e01）

**实测指标（2026-08-31 最终）**：>2000 行 95（107→95，↓12）；>800 行 344（369→344，↓25）；全仓最大 shared_session_v2 5349（原 7685）；tsc 全仓零 error；check:large-files:gate 绿

**教训增补**：① tsc 增量缓存会漏报新文件错误——拆分验证必须删 tsbuildinfo 或用全新输出确认；② 段切分必须把 doc 注释/cfg 属性/tauri::command 宏随函数走（三次事故均为此）；③ 子代理建临时基线 worktree 会污染共享 target 的 build-script 缓存（/private/tmp/baseline_wt 事故），下次子代理任务书须禁共享 CARGO_TARGET_DIR。

**下会话入口**：在途两项验证收尾 → Wave 2 剩余（A4 收尾、B4 续、C1 reducer 二期、C2 messaging 主干）→ Wave 3 剩余（R2 claude.rs、R3 v2 主体、R4 coordinator 主体、R5 session_management、R6 shared_sessions 主体）→ F2 GitDiffPanel 续 → F4 useThreads → Wave 4 git-history。

### 2026-08-31 执行记录（第二会话，18 个 commit 落在 feat/code-quality-optimization）

**已完成（逐字搬运 + 基线对比零新增失败 + 收口 gate 绿）**：
- Wave 2 收尾：B4 二期 useLayoutNodes 2935→2543（gitDiffPanelNode/panelNodes/chromeNodes 三段；deps 310 行逐字留 hook 是硬底）；B4 三期 layoutNodesSection 2531→2182（七组 options 全抽 builder，457 引用名 bag 硬底 ~2170，经拍板接受 2182）；C1 useThreadsReducer 二期 3506→1924（六块 reduceXxx）；C2 useThreadMessaging 4600→2819 全六段（memoryPick/types/pickGate/squadRequest/sharedSend/nativeResolve，SharedSendContext 与 NativeResolveContext 参数对象化每次调用现构未缓存）
- Wave 3 全量：R2 claude.rs 3430→426（五子模块）；R3 shared_session_v2 5349→870（五域子模块+聚合层，7 个命令随域迁移 glob 重导出）；R4 coordinator 2670→1280（ingress/canonical_blocks/identity）；R5 session_management 4008→317（五平铺子模块，20 引用方零改动）；R6 shared_sessions 2061→954（四子模块）
- F2 续：GitDiffPanel 2711→2146（contextMenus + useGitDiffPreview）
- F4：useThreads 3385→2446（memoryCapture/autoNaming/completionEmail 三域；refs 内核留壳）
- Wave 4 四步全落地：Dialogs 2076→48 编排器（四 dialog 族）；Interactions 2878→2236（PR 创建 + sync/push preview 两组）；View 3425→2988（branchDiff 段）；Impl 4933→3662（两个 scope 类型 895 行迁出 GitHistoryPanelTypes 破倒置 + 数据加载段 371 行抽出）；4 锚点函数原地不动，两治理脚本绿

**实测指标（2026-08-31 第二会话末）**：>2000 行 87（107→95→87）；>800 行 349；全仓最大源码文件 GitHistoryPanelImpl 3663（原 7685）；全仓最大文件为测试 useAppServerEvents.test 4328；tsc 全仓零 error；check:large-files:gate 绿（含 new-file baseline 重生成）

**教训增补**：④ options/builder 段拆分的行数硬底 = 字面量行数 − 搬出行数 + bag 逐名列举行数（457 名 ≈ 163 行），评估目标时先算这笔账；⑤ 并行子代理可行（本会话 9 代理并行落地 18 commit），关键是文件不重叠 + 禁 git 写操作 + 基线对比用「先跑记录失败名单」而非 stash；⑥ new-file ratchet 需跑 `check:large-files:new-file-baseline` 单独重生成（与主 baseline 是两个文件），漏跑 gate 以 status=new 阻塞。

**下会话入口**：长尾滚动机制（near-threshold top-N）；已知大文件余量：GitHistoryPanelImpl 3663 / useAppServerEvents 1981(一期后)/ dispatcher 二期 / SessionManagementSection 2648 / SettingsView / FileViewPanel / FileTreePanel / Rust 长尾（app_server_cli 3306 / browser_agent 3224 / local_usage 3169 / claude_history 2881 / grok_history 2620 / runtime/mod 2585）。既有存量失败清单（与拆分无关，勿顺手修）：useThreadMessaging.test 4 个、useThreadsReducer 系 5 文件、GitHistoryWorktreePanel.test 8 个、T3.7 useEngineAvailabilityProjection 治理违规。

- 每 wave 末:重生成 baseline,`git diff docs/architecture/large-file-baseline.json` 随 PR 提交,PR 描述说明;
- 追踪指标(写进每 wave 收尾 PR):>2000 行文件数、>800 行文件数、全仓最大文件行数、P0 区超阈值文件数;
- 目标曲线:107 → 92(W1)→ 55(W2)→ 10(W3)→ 登记豁免制(W4);
- 与性能工作的协调:拆 reducer/Messages 周边时对照 `docs/perf/` 既有结论,避免与进行中的性能修复同窗口改同一区段。

## 附录 A:>2000 行文件头部清单(2026-08-30 快照,完整版以 watchlist 为准)

**Rust(24 个)**:shared_session_v2 7685 / engine/commands 5452 / daemon_state 5353 / shared_runtime_coordinator 4864 / engine/status 4594 / engine/pi 4280 / session_management 4008 / skills_hub 3574 / workspaces/commands 3493 / engine/claude 3430 / backend/app_server_cli 3306 / browser_agent/mod 3224 / daemon git 3170 / local_usage 3169 / codex/mod 3120 / cc_gui_daemon 3076 / engine/claude_history 2881 / types 2828 / shared_sessions 2816 / project_map_api_contracts 2793 / git/mod 2720 / engine/grok_history 2620 / runtime/mod 2585 / local_usage/tests 2577

**前端源码(24 个)**:GitHistoryPanelImpl 4933 / useThreadMessaging 4600 / Composer 4127 / useAppServerEvents 3818 / useThreadsReducer 3728 / GitHistoryPanelView 3425 / useThreads 3385 / GitDiffPanel 3279 / useLayoutNodes 3235 / FileViewPanel 3149 / useThreadActions 3066 / useGitHistoryPanelInteractions 2878 / Sidebar 2847 / useThreadEventHandlers 2745 / en/settings 2700 / useSidebarMenus 2693 / WorkspaceSessionActivityPanel 2679 / useQueuedSend 2648 / SessionManagementSection 2648 / useThreadActions.helpers 2646 / useThreadItemEvents 2624 / FileTreePanel 2622 / SettingsView 2611 / zh/settings 2548

**前端测试(13 个 >3000)**:useAppServerEvents.test 4327 / useThreadMessaging.test 4101 / ModelSelect.test 3679 / Sidebar.test 3608 / Messages.live-behavior.test 3606 / tauri.test 3508 / useThreadActions.test 3330 / useThreadsReducer.test 3251 / threadItems.test 3193 / GitHistoryPanel.test 3134 / historyLoaders.test 3089 / useThreadEventHandlers.test 3078 / useSidebarMenus.test 3038
