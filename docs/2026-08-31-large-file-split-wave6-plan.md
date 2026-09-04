---
type: plan
status: active
created: 2026-08-31
---

# 大文件拆分 Wave 6 计划（2026-08-31）

> 承接 `docs/2026-08-31-large-file-split-wave5-plan.md`（Wave 5 已全量落地）与主计划 `docs/2026-08-30-large-file-split-master-plan.md`。
> 执行纪律沿用主计划 §8/§9 + Wave 5 计划 §6 八条 + Wave 5 §8 教训⑦-⑩，本文不重复全文，只列增量与目标。
> 开工前以 `npm run check:large-files:near-threshold` 的 live watchlist 校准目标。

## 0. 现状度量（2026-08-31 Wave 5 收官实测）

| 指标 | 08-30 起点 | Wave 5 后 | 变化 |
|---|---:|---:|---|
| 源码 >2000 行（非测试） | ~80 | **49** | −39% |
| 全仓最大源码文件 | 7685 | **3170**（daemon_state/git.rs） | −59% |
| bridge-runtime-critical 超 fail 线（>2600） | — | **1 个**（status.rs 3020） | 清尾阶段 |
| feature-hotpath 超 fail 线（>2800） | — | 2 个 | 见 §1 |
| 测试 >2000 | — | 27 个长尾 | 见 §3 |

**治理状态**：policy v5 + 三道 baseline 锁全绿；strictReduction 已在 settings-view-sections 组启用（retained=阻塞）；large-file-governance.yml 已加 `pull_request` trigger（gate 是真 PR blocker）；tsc 全仓零 error；分支 feat/code-quality-optimization。

**已知存量失败清单（勿顺手修，基线对比以这些为准）**：
- useThreadMessaging.test 4 个、useThreadsReducer 系 5 文件、GitHistoryWorktreePanel.test 8 个、useThreads 集成 3 文件
- GitDiffPanel commit-message-engine 超时 3 个、appShellLazyBoundaries 4 个
- useAppServerEvents 目录 compaction.test 3 个 + routing.test 1 个（compaction payload 存量错位）
- RuntimePoolSection.test.tsx 1 个（i18n key 计数 expected 5 to be 4）
- FileViewPanel open-in-browser 2 个 5s 超时（flaky）
- claude_history 系 9 个测试文件（panic 签名已锁定）
- runtime 系 3 个环境性失败（进程组回收 os error 3 / provider 路由超时）
- T3.7 useEngineAvailabilityProjection 治理违规（1a7463e01 引入）

## 1. 目标与验收

| 里程碑 | 验收 |
|---|---|
| W6-A P0 清尾 | status.rs ≤2600；bridge-runtime-critical 组 retained 清零 → **启用 strictReduction** |
| W6-B feature-hotpath 清尾 | GitHistoryPanelView ≤2800、useThreadMessaging ≤2800；组 retained 清零 → **启用 strictReduction** |
| W6-C 测试长尾 | >3000 孤儿测试 6 件按 describe 族切片；测试 >2000 从 27 降至 ≤20 |
| W6-D default-source 头部 | daemon_state/git.rs 3170 → <3000（fail 线下）；project_map_api_contracts.rs 2793 → 评估 |

**收官理想态**：strictReduction 三组全启用（settings-view-sections ✓ + bridge-runtime-critical + feature-hotpath），retained 全仓归零制，大文件治理从「控增量」进入「存量清零」阶段。

## 2. W6-A：status.rs（3020 → ≤2600，P0 组唯一残余）

- 文件：`src-tauri/src/engine/status.rs`（bridge-runtime-critical，fail>2600）。
- 先例：Wave 1 已做过一轮 4594→3020（有既有拆分结构可循，先看现状再定刀法）。
- 拆法建议：按 status 采集/投影/命令族用 `#[path]` 平铺 `engine/status_*.rs` 或 `engine/status/` 子模块（参照 pi.rs→pi/、claude.rs→claude/ 先例）；pub use 穷尽重导出，调用点零改动。
- ⚠️ 该文件在引擎事件链上，动前必读 `dev-guidelines/guides/engine-forwarder-dual-path-pitfall.md`；dev（app 进程内）与 daemon（cc_gui_daemon）两份转发器共享判定函数必须单实现原路径重导出。
- 验证：拆前 `cargo test --manifest-path src-tauri/Cargo.toml status` 记录失败名单 → 拆后零新增；`cargo check`（lib + daemon bin 双 target）。
- **同 PR 治理动作**：拆完后 bridge-runtime-critical 组无 retained，policy.json 给该组加 `"strictReduction": true`，三道 baseline 同 PR 重生成，gate 必须仍绿。

## 3. W6-B：feature-hotpath 两件

### B1. GitHistoryPanelView.tsx（3012 → ≤2800，越低越好）

- 路径：`src/features/git-history/components/git-history-panel/components/GitHistoryPanelView.tsx`。
- 拆法：渲染段组件化（参照 Wave 4 BranchDiffSection、Wave 5 FileViewPanel 渲染段先例）；用 `Pick<GitHistoryPanelViewScope, N keys>` 收窄 props。
- ⚠️ 锚点 `renderGitHistoryPanelView` 原地不动；两治理脚本每步绿：`check:git-history:runtime-contract` + `check:git-history:static-imports`。
- 验证：`npx vitest run src/features/git-history`（GitHistoryWorktreePanel.test 8 个为既有）零新增 + 删 tsbuildinfo 后 tsc 零 error。

### B2. useThreadMessaging.ts（2819 → ≤2800，越低越好）

- 已拆两轮（4600→4025→2819），剩余主干。
- 拆法：先读现状结构，候选：剩余 handler 族抽出 / 上下文对象再切一刀（SharedSendContext / NativeResolveContext 参数对象化先例）。
- ⚠️ 渲染红线：流式正文走 `liveAssistantTextChannel`、思考/工具走 `liveItemDeltaChannel`，禁把 delta 重新打根；高频 setState 禁挂根 hook 链（见 AGENTS.md Render Perf Baseline）。
- ⚠️ useThreadMessaging.test 4 个为既有失败（基线锁死）。
- **同 PR 治理动作**：两件完成后 policy.json 给 feature-hotpath 加 `"strictReduction": true` + baseline 重生成。

## 4. W6-C：测试长尾（27 个 >2000，>3000 孤儿 6 件优先）

按 describe 族切 `*.test.ts` 分片，共享 setup 抽 `xxxTestSetup.ts`；**既有失败名单所在的 describe 族先切，切后失败名单必须逐字相同**。

| 序 | 文件 | 行数 | 备注 |
|---|---|---:|---|
| C1 | useAppServerEvents.test.tsx | 4327 | 含既有失败 compaction 3+routing 1 |
| C2 | useThreadMessaging.test.tsx | 4101 | 含既有失败 4 个 |
| C3 | ModelSelect.test.tsx | 3679 | |
| C4 | Sidebar.test.tsx | 3620 | |
| C5 | Messages.live-behavior.test.tsx | 3606 | |
| C6 | tauri.test.ts | 3508 | |
| 长尾 | useThreadActions 3330 / useThreadsReducer 3251（既有失败 5 文件）/ threadItems 3193 / GitHistoryPanel.test 3134 / historyLoaders 3089 / useThreadEventHandlers 3078 / useSidebarMenus 3032 / useThreadTurnEvents 2994 / WorkspaceSessionActivityPanel.test 2821 / useQueuedSend 2718 / SettingsView.test 2691 | — | 滚动轨，随主体拆分同 PR 顺带 |

## 5. W6-D：default-source 头部

- **D1 daemon_state/git.rs**（3170，现全仓最大源码，fail>3000）：daemon git 域，按命令族平铺（参照 daemon_state 九分块先例 `src-tauri/src/bin/cc_gui_daemon/daemon_state/`）；⚠️ include_str! 自引用测试路径教训（主计划 §9）。
- **D2 project_map_api_contracts.rs**（2793，watch）：评估是否一次性拆到 2600 下。

## 6. 执行编排

- 沿用已验证多代理模式：文件互不重叠的子代理并行（≤6），主会话统一 commit；子代理禁 git 写、禁 stash、禁共享 CARGO_TARGET_DIR 建临时 worktree。
- 建议波次：
  - 波 1：W6-A status.rs + W6-B1 GitHistoryPanelView + W6-C1/C2（四者不重叠）
  - 波 2：W6-B2 useThreadMessaging + W6-C3/C4 + W6-D1
  - 波 3：W6-C5/C6 + W6-D2 + strictReduction 组启用收尾
- 每波末主会话：`check:large-files:baseline` + `check:large-files:new-file-baseline` + gate + 删 tsbuildinfo 全量 tsc，绿后统一 commit（中文 Conventional Commits），回填本文 §8。
- 每 PR 走主计划 §8 标准执行卡。

## 7. 纪律增量（Wave 5 之后新增，开工前必读）

1. tsc 验证必删 tsbuildinfo（`find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete`）。
2. doc 注释/cfg 属性/tauri::command 宏随函数走。
3. 子代理禁共享 CARGO_TARGET_DIR；cargo exit 101/E0583 多为兄弟代理 transient，hub 协调或稍后重跑。
4. options/builder 段拆分行数硬底 = 字面量 − 搬出 + bag 逐名列举（~0.36 行/名），算不到目标提前拍板。
5. 测试基线对比一律「记录失败名单」，禁止 stash。
6. 两道 baseline 每波末都要重生成（主 baseline + new-file ratchet）。
7. 并行代理脚本装配文件用独立临时文件 + byte-identical 审计；禁共享 eval 内核可变状态。
8. #[path] 加载的文件内再声明 child mod 必须继续显式 #[path]（裸 mod 触发 E0583）。
9. 开工前先 `ls src-tauri/src/bin/cc_gui_daemon/main.rs` 确认无 0 字节杂散文件（Wave 5 波 3 事故，来源未定位）；发现立即移走。
10. 治理脚本自身（check-large-files.*）加测试会撞 new-file ratchet（800 线），须同 PR 重生成 new-file baseline。
11. TFunction 从 `"i18next"` import；类型顶层 `import type`。
12. 锚点不改名不移位：`__profile` / `threadReducerTestProjection` / GitHistoryPanel 四锚点 / reducer flag 常量模块级只求值一次。

## 8. 执行记录

### 波 1（2026-08-31 本会话，4 代理并行，落地 1 commit 46bfa275d）

- **W6-A status.rs**：3020→70 壳 + engine/status/ 11 子模块（catalog 531/orchestration 554/pi 452/opencode 304/claude 266/qoder 244/kimi 184/probe 172/grok 142/gemini 110/codex 39）；11 个显式 #[path] mod 声明 + 穷尽 pub use（catalog/probe 用 pub(crate) use 避 glob-visibility 警告）；80 处 pub(crate) bump（74 item + ClaudeModelOverrides 6 字段，E0451）为唯一偏差，逐字性经 112 顶层 item 脚本化比对；判定函数单实现留 engine::status 原路径，dev/daemon 双转发器零改动；cargo test status 78+76 passed 前后一致，lib + daemon bin check 双 0 error。
- **W6-B1 GitHistoryPanelView**：3012→2340 ✓（≤2800）；拆出 CreatePrDialog 714 + CreatePrPreviewCard 296，Pick<Scope, 71/29 名> 收窄 props，deps 72 名逐字留调用点，renderGitHistoryPanelView 锚点原地；测试 8 failed/202 passed 前后逐字一致（8 个 GitHistoryWorktreePanel 既有）；两 git-history 治理脚本绿。
- **W6-C1 useAppServerEvents.test**：4327→8 族切片（最大 761）+ TestSetup 70；74 it 逐字迁移，describe 包装名保留测试全名不变；setup 内 mount 改 createElement（.ts 无 JSX，脚手架非用例文本）；目录失败名单 5 条（compaction 3 + routing 1 + sidebarPinned 1）前后逐字一致。
- **W6-C2 useThreadMessaging.test**：4101→8 族切片（最大 702）+ TestSetup 22；114 it 双向逐字节一致；既有 4 失败前后逐字一致；vi.mock 顺序敏感——setup import 须置顶。
- **治理动作**：bridge-runtime-critical retained 清零 → policy.json 启用 strictReduction（第二组）；两道 baseline 同 PR 重生成；gate 绿；删 tsbuildinfo tsc 零 error；无 0 字节杂散文件。
- 新教训：⑬ 并行代理共享 eval 内核可变状态污染再现（B1 lines 变量被 C2 覆盖），靠 git show 只读取 pristine + 唯一变量名恢复——纪律⑦须强调「唯一变量名」而不只是「独立临时文件」。

### 波 2（2026-08-31 本会话，4 代理并行，落地 1 commit）

- **W6-B2 useThreadMessaging**：2819→2384 ✓（≤2800）。三刀逐字搬运：① 七引擎 pending-session 缓存 if 块 291 行 → 新文件 threadMessagingPendingSessionCache.ts 361（PendingSessionCacheContext 参数对象化，仿 NativeResolveContext 先例）；② realSessionId 三元链 72 行 → threadMessagingNativeResolve.ts +108；③ spec-root probe/codex hint/explore 卡注入 114 行 → threadMessagingSpecRoot.ts +155。deps 数组逐字未动；liveAssistant/liveItemDelta wiring 不在拆动区。失败名单 12 failed/173 passed 前后逐字一致（4 族既有 + context-injection 8 既有）。
- **W6-C3 ModelSelect.test**：3679→6 族切片（最大 1194）+ TestSetup 57；83 用例逐字节迁移；目录 156 passed/0 failed 前后一致。3 片 >800（1194/956/815，单 describe 族不可再切）登记豁免，new-file baseline 同 PR 重生成覆盖。实际路径在 ChatInputBox/selectors/ 下（任务书路径已由 find 校准）。
- **W6-C4 Sidebar.test**：3620→6 族切片（最大 756）+ TestSetup 40；66 passed + 1 failed（engine refresh 菜单按钮，拆前既有、前后逐字一致）；目录另有 session-folders 3 个既有失败零交集。
- **W6-D1 daemon_state/git.rs**：3170→1536 ✓（<3000 出 fail 线）+ 5 平铺模块（git_pr 576/git_compare 344/git_branches 275/git_sync 273/git_staging 186）；27 处 pub(super) bump 为唯一偏差；无 include_str! 自引用命中；cargo test --bin cc_gui_daemon git 34 passed 前后逐名一致；cargo check 全 target 0 error。
- **治理动作**：feature-hotpath retained 清零 → policy.json 启用 strictReduction（第三组，三组全启用达成）；两道 baseline 同 PR 重生成（覆盖 C3 三件 >800 豁免）；gate 绿；删 tsbuildinfo tsc 零 error；清掉 W6C3 tsc -b 误产的 vite.config.js/.d.ts 杂散。
- 新教训：⑭ 子代理验证 tsc 禁用 `tsc -b` 模式（会 emit vite.config.js/.d.ts 入仓）；只用 `npx tsc --noEmit`。

### 波 3（2026-08-31 本会话，3 代理并行，落地 1 commit）

- **W6-C5 Messages.live-behavior.test**：3606→6 族切片（最大 live-follow 1663）+ TestSetup 130；65 个 it/it.each 块逐字节校验；既有 10 failed/58 passed 前后逐字一致（auto-follow/RO 追底族，pre-existing，勿顺手修）。
- **W6-C6 tauri.test**：3508→4 族切片（git 491/commands 1075/sessions 1030/engines 892）+ tauriTestSetup 70；145 it 多重集逐字节一致；145 passed/0 failed 前后一致。教训补强：setup 的 vi.mock 依赖 import 求值顺序，setup import 必须置于被测模块 import 之前。
- **W6-D2 project_map_api_contracts.rs**：2793→2539 ✓（出 warn 线）+ project_map_api_contracts_java_schema.rs 259（Java schema 域 9 fn 平铺）；9 处 pub(super) bump 唯一偏差；cargo test project_map 23 passed 前后逐名一致；check 全 target 0 error。
- 波末：两道 baseline 重生成 + gate 绿 + 删 tsbuildinfo tsc 零 error。

### Wave 6 收官指标（2026-08-31 本会话末实测）

| 指标 | Wave 6 前 | Wave 6 后 | 主计划起点（08-30） |
|---|---:|---:|---:|
| 源码 >2000 行（非测试非 css） | 49 | **47** | ~80 |
| 全仓最大源码 | 3170（daemon_state/git.rs） | **2562**（cc_gui_daemon.rs） | 7685 |
| bridge-runtime-critical retained | 1（status.rs） | **0**（strictReduction 已启用） | — |
| feature-hotpath retained | 2 | **0**（strictReduction 已启用） | — |
| 测试 >2000 | 27 | **18**（目标 ≤20 ✓） | — |
| strictReduction 启用组 | 1（settings-view-sections） | **3 组全启用** | — |
| gate / tsc | 绿 / 零 error | 绿 / 零 error | — |

**W6-A 验收**：status.rs 70 ≤2600 ✓；bridge-runtime-critical strictReduction 启用 ✓。
**W6-B 验收**：GitHistoryPanelView 2340 / useThreadMessaging 2384 均 ≤2800 ✓；feature-hotpath strictReduction 启用 ✓。
**W6-C 验收**：6 件 >3000 孤儿测试全部切片落地（C1-C6）；测试 >2000 降至 18 ≤20 ✓。
**W6-D 验收**：daemon_state/git.rs 1536 <3000 ✓；project_map_api_contracts.rs 2539 <2600 ✓。
**收官理想态达成**：strictReduction 三组全启用，retained 仅剩 styles（5 css）与 test-files（7 测试）两非 strict 组存量，大文件治理进入「存量清零」轨道。
