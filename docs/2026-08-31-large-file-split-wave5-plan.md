---
type: plan
status: active
created: 2026-08-31
---

# 大文件拆分 Wave 5 计划（2026-08-31）

> 承接 `docs/2026-08-30-large-file-split-master-plan.md`（下称主计划）。主计划 Wave 1-4 已全部落地，本文档是剩余债务的下一轮执行计划。
> 执行纪律、验证矩阵、风险登记册沿用主计划 §8/§9 + 两次会话教训增补（见本文 §6），不重复全文，只列增量。
> 选目标时仍以 `npm run check:large-files:near-threshold` 的 live watchlist 校准。

## 0. 现状度量（2026-08-31 第二会话末实测）

| 指标 | 2026-08-30 | 现在 | 变化 |
|---|---:|---:|---|
| >2000 行文件（含测试） | 107 | **87** | −20 |
| 其中源码（非测试） | ~80 | **60** | ~−20 |
| 其中测试 >2000 | — | 27 | 长尾 |
| >800 行文件 | 369 | 349 | −20 |
| 全仓最大源码文件 | 7685 | **3663**（GitHistoryPanelImpl） | −52% |

**治理状态**：policy v5 + 三道 baseline 锁（主 baseline / new-file ratchet / near-threshold）全绿；tsc 全仓零 error；分支 feat/code-quality-optimization（两会话累计 44 commit）。

**已知存量失败/违规（勿顺手修，非本计划范围）**：useThreadMessaging.test 4 个、useThreadsReducer 系 5 文件、GitHistoryWorktreePanel.test 8 个、useThreads 集成 3 文件、GitDiffPanel commit-message-engine 超时 3 个、appShellLazyBoundaries 4 个、T3.7 useEngineAvailabilityProjection 治理违规（1a7463e01 引入）。所有基线对比以这些为「既有失败名单」。

## 1. 目标与验收

| 里程碑 | 验收 |
|---|---|
| W5-A 前端中枢 | dispatchAppServerEvent 四族落地；F3 面板四件全部 <2000；源码 >2000 ≤ 50 |
| W5-B Rust P0 长尾 | bridge-runtime-critical 区全部 ≤2600（fail 线以下）；app_server_cli/browser_agent/pi/local_usage/claude_history/grok_history/runtime 清账 |
| W5-C 收尾 | GitHistoryPanelImpl <2000；治理收尾（strictReduction + PR trigger）评估落地；源码 >2000 进入 40 区间 |

## 2. W5-A 前端中枢（先动，churn 最高）

### A1. F1 二期：`dispatchAppServerEvent`（useAppServerEvents.ts L42-1807，~1765 行单函数，61-key handlers）

- 现状：一期已把 types/extractors/emitters/normalizedRouting 抽出（文件 1981 行，其中 dispatcher 本体 ~1765）。
- 拆法：按 method 前缀四族切 `dispatch/` 子文件（与 useAppServerEvents.ts 同目录新建 `appServerEventDispatch/`）：
  - `turnDispatch.ts`（turn.* 族）
  - `itemDispatch.ts`（item.* 族）
  - `threadDispatch.ts`（thread/session 族）
  - `collabDispatch.ts`（collab/multi-agent 族）
- 每族导出 `dispatchXxxFamily(ctx, method, payload): boolean`（handled 与否返回 boolean，主 dispatcher 按族序短路）。**method 分支顺序敏感（早 return 语义）**：族序与族内分支序逐字保持。
- dispatcher 闭包共享变量（batch 缓冲、refs、emitters）打包成 ctx 参数对象，每次调用现构，禁止缓存（SendMessageContext 先例）。
- 锁面：4 个导出函数签名 + 2 个 backpressure 再导出不动；测试 mock 打在服务边界。
- PR 切分：一族一 PR（4 PR），或 turn+item / thread+collab 两 PR。
- 验证：`npx vitest run src/features/app/hooks/useAppServerEvents`（全 14 个测试文件）+ `npx vitest run src/services/events.test.ts` + 删 tsbuildinfo 后 `npx tsc --noEmit`。

### A2. `SessionManagementSection.tsx`（2649 → <2000，**唯一在 sections fail>2000 闸门上的前端源码，优先级最高**）

- 拆法（主计划 F3）：curtain 全链路独立 → `useSessionCurtain.ts`（~700）+ Curtain Dialog（~140）；FolderNav（~260）；utils 下沉（~200）。close-on-delete 纳入 curtain hook。
- ⚠️ exported helper 保留 re-export 一轮；该文件有 2547→2648 反弹前科，拆后确认 baseline 重生成把闸门咬到新值。
- 验证：该文件关联测试全量 + settings-view 相关 governance + tsc。

### A3. `FileViewPanel.tsx`（3150 → ~1500）

- 拆法：右键菜单 builder（~470，先定义 `FileViewContextMenuDeps` 参数对象）+ 图片/拖拽 2 自含 hook + 3 渲染段。
- ⚠️ tab 拖拽连 ref 移交；17 个测试文件的 vi.mock 整模块对 import 路径敏感——抽出文件继续从原路径 import 服务。
- 验证：`npx vitest run src/features/files/components/FileViewPanel` + tsc。

### A4. `FileTreePanel.tsx`（2623 → ~1100）

- 拆法：`fileTreeContextMenu.ts`（~500，deps 对象）+ 3 自含 hook（preview popover / lazy children / item operations）。
- ⚠️ memo 推导链是性能敏感区（30s 轮询前科），保持引用稳定粒度；menu item id 不变。
- 验证：`npx vitest run src/features/files/components/FileTreePanel` + tsc。

### A5. `SettingsView.tsx`（2612 → ~800-1000，测试迁移成本最大，放 A 组最后）

- 拆法：**状态下沉**（非新文件）：外观/open apps/分组/快捷键各归 section；8 个同构 doctor 回调收敛为注册表泛型 `useDoctorRunner`；删死代码 picker（~50）。
- ⚠️ 先加 section 级直渲染测试再下沉（doctor/外观测试现经顶层断言）；lazy/Suspense 边界勿动。
- 验证：SettingsView 关联测试全量 + tsc。

## 3. W5-B Rust P0 长尾（bridge-runtime-critical，fail 2600 线上的全部）

通用：逐字搬运；doc/cfg/tauri::command 随函数走；重导出穷尽调用点零改动；每 PR `cargo check --manifest-path src-tauri/Cargo.toml` + 对应 `cargo test <module>` 基线对比；`#[path]` 平铺优先（engine/commands.rs、session_management 先例），避免 daemon bin E0583。

| 序 | 文件 | 现状 | 内联测试 | 建议刀法 |
|---|---|---:|---|---|
| B1 | `engine/grok_history.rs` | 2621 | L1835 起 ~780 行 | **测试先外移** `grok_history_tests.rs` → 主体 ~1840 直接落到线下，一笔见效 |
| B2 | `backend/app_server_cli.rs` | 3307 | L2457 起 ~850 行 | 测试外移 → ~2450；再按 handler 族平铺 `app_server_cli_*.rs` |
| B3 | `browser_agent/mod.rs` | 3225 | L2947 起 ~278 行 | 测试外移 → ~2950；再按 action 族拆子模块 |
| B4 | `local_usage.rs` | 3170 | 测试已分离（tests.rs 2578） | 主体纯拆：按采集/聚合/IO 族平铺；`local_usage/tests.rs`（2578）顺带按域切两段 |
| B5 | `engine/claude_history.rs` | 2882 | 测试已分离（L2873 仅声明） | 按 loader/filter/delete 族平铺（注意 9 个 claude_history* 测试文件是既有失败名单之一，基线对比锁死） |
| B6 | `engine/pi.rs` | 3202 | 已分离 | 按引擎段（send/interrupt/session）拆 `engine/pi/` 子模块，参照 claude.rs 五子模块先例 |
| B7 | `runtime/mod.rs` | 2586 | L2585 声明 | 按 registry/lifecycle 族拆子模块 |

顺序建议：B1/B2/B3 测试外移先行（零风险立威），B4-B7 主体拆分随后。B5 与 B6 可并行（不同文件），全部互不重叠。

## 4. W5-C 收尾

### C1. `GitHistoryPanelImpl.tsx`（3663 → <2000）

- 已完成：scope 类型迁出（Types.ts 1123）、数据加载段、Dialogs/View/Interactions 四步。
- 剩余拆法：再抽 1-2 个域——候选：渲染壳内的大 JSX 段组件化（参照 BranchDiffSection 先例，Pick<GitHistoryPanelViewScope, N keys> 收窄）、其余数据 effects。4 锚点函数原地不动；两治理脚本（check:git-history:runtime-contract / static-imports）每步绿。

### C2. 治理收尾（小投入，各 ~15 行）

- `strictReduction`（主计划 PR 0.2 遗留）：scanner 加可选字段，对已完成拆分的 policy 组（bridge-runtime-critical / feature-hotpath）逐步启用，把 retained 重分类为阻塞。**不得全局启用**。
- `.github/workflows/large-file-governance.yml` 加 `pull_request` trigger（mode=fail），让 gate 成真 PR blocker。
- 同 PR 重生成三道 baseline 并在 PR 描述登记。

### C3. 测试文件长尾（27 个 >2000，低优先级滚动轨）

- 随主体拆分同 PR 顺带拆；>3000 孤儿测试（useAppServerEvents.test 4328 / useThreadMessaging.test 4101 / ModelSelect.test 3679 / Sidebar.test 3608 / Messages.live-behavior.test 3606 / tauri.test 3508）单开，按 describe 族切 `*.test.ts` 分片，共享 setup 抽 `xxxTestSetup.ts`。

## 5. 执行编排（已验证的多代理模式）

- 沿用第二会话模式：任务文件互不重叠的子代理并行（≤6 个同时在跑），主会话统一 commit；子代理禁 git 写操作、禁 stash、基线对比用「先跑记录失败名单→拆后重跑」。
- 建议并行波次：
  - 波 1：A1 一族（或整 dispatcher 单代理四连）+ B1 + B2 + A2（四者文件全不重叠）
  - 波 2：A1 剩余族 + B3 + B4 + A3
  - 波 3：B5 + B6 + A4 + C1
  - 波 4：B7 + A5 + C2
- 每波末：主会话跑 `npm run check:large-files:baseline` + `npm run check:large-files:new-file-baseline` + gate + 全量 tsc（删 tsbuildinfo）后统一 commit。

## 6. 纪律增量（主计划 §8/§9 之外的本仓新增教训）

1. tsc 增量缓存漏报新文件错误——验证必删 tsbuildinfo（`find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete`）。
2. 段切分 doc 注释/cfg 属性/tauri::command 宏随函数走。
3. 子代理禁止共享 CARGO_TARGET_DIR 建临时 worktree；cargo 遇 target lock 排队等待即可。
4. options/builder 段拆分先算行数硬底：字面量 − 搬出 + bag 逐名列举（~0.36 行/名），算不到目标就提前拍板接受值，别到验收才发现。
5. 多代理并行时测试基线对比一律用「记录失败名单」，禁止 stash（会扫走兄弟代理的在途改动）。
6. new-file ratchet 是独立 baseline 文件（`check:large-files:new-file-baseline`），漏跑 gate 以 status=new 阻塞；每波末两个 baseline 都要重生成。
7. TFunction 从 `"i18next"` import（react-i18next 不导出）；类型用顶层 `import type`。
8. reducer/hook 拆出的 flag 常量模块级只求值一次；`__profile`/`threadReducerTestProjection` 等锚点不改名不移位。

## 7. 下会话入口

1. 先读本文件 + 主计划 §10 第二会话记录。
2. 确认基线：`npm run check:large-files:gate` 绿、tsc 零 error、`git status` 干净（分支 feat/code-quality-optimization）。
3. 按 §5 波次开工；每 PR 走主计划 §8 执行卡（分支可继续在 feat/code-quality-optimization 上滚动，或按仓规切 refactor/split-* 分支）。
4. 收尾：重生成三道 baseline、更新本文 §8 执行记录、回报指标。

## 8. 执行记录

### 波 1（2026-08-31 第三会话，4 代理并行，落地 1 commit）

- **A1 dispatcher 二期**：useAppServerEvents.ts 1981→442；新建 appServerEventDispatch/ 五件（types 15 + collab 131 + item 528 + turn 346 + thread 638）。族序 collab→item→turn→thread 按原分支首现序短路；ctx 每次调用现构未缓存；return; → return true; 契约化改写（runtime/ended forEach 内 return; 保持原样）；dsh/raw 与 codex/connected 留壳内 preamble（顺序敏感区）。锁面 4 族签名 + 2 backpressure 再导出未动，export 面与 HEAD diff 为空。
- **A2 SessionManagementSection**：2648→1758（fail>2000 闸门通过）；新建 useSessionCurtain.ts 636（close-on-delete 已纳入）+ SessionFolderNavControls 195 + SessionCurtainDialog 145 + sessionManagementSectionHelpers 93；14 个导出符号 re-export 桶零漂移，逐字性经 byte-identical 程序化断言。
- **B1 grok_history 测试外移**：2620→1836 + grok_history_tests.rs 784（#[path] mod 先例）；cargo test grok_history 27+27 passed 前后一致。
- **B2 app_server_cli 测试外移**：3306→2458 + app_server_cli_tests.rs 848；逐字守恒（2455+3+848=3306）；cargo test 52+52 passed 前后一致；主体落 2600 线下，handler 族二拆免做。
- 验证矩阵：两道 baseline 重生成 + gate 绿；删 tsbuildinfo 后 tsc 全仓零 error；四件关联测试基线对比全部零新增失败。

**存量失败名单新增（非本次引入，已核实 pre-existing，勿顺手修）**：
- useAppServerEvents 目录 compaction.test 3 个 + routing.test 1 个（A1 拆前基线实测同样 4 failed/127 passed，失败签名逐字相同——疑似 Wave 1 compaction payload 行为与已提交测试的存量错位）
- RuntimePoolSection.test.tsx 1 个（i18n key 计数 expected 5 to be 4；A2 用 HEAD 对换法证明 HEAD 树同样失败，与拆分模块图零交集）

**教训增补**：⑦ eval/脚本内核变量会被并行代理跨调用污染（A1 遭遇异源内容混入主文件，靠 git show HEAD 只读恢复 + md5 双测一致后单 cell 原子重生成）——并行代理用脚本装配文件时须用独立临时文件，禁共享可变内核状态。

### 指标（波 1 末）

| 指标 | 波 1 前 | 波 1 后 |
|---|---:|---:|
| SessionManagementSection | 2648 | 1758 |
| useAppServerEvents | 1981 | 442 |
| grok_history.rs | 2620 | 1836 |
| app_server_cli.rs | 3306 | 2458 |
| gate | 绿 | 绿（baseline 咬新值） |
| tsc | 零 error | 零 error |
### 波 2（2026-08-31 第三会话，3 代理并行，落地 1 commit）

- **A3 FileViewPanel**：3149→2023（纪律④算不到 ~1500，提前拍板接受：菜单 deps 逐字留调用点 + bag 逐名 59 名 + Footer 33 props/Tabs 20 props 使用块 ~370 行硬底；再降需动核心状态 wiring，计划外）。新建 fileViewContextMenus.tsx 717（两 deps 对象 40+19 名，menu item id 不变）+ useFileImagePreview 112 + useFileTabDrag 133（两 ref 随迁）+ FileViewPanelTabs 160 + FileViewExternalChangeOverlays 169 + FileViewPanelFooter 386。12 chunk byte-identical 审计（md5 登记）；测试 21 文件 150/152 前后一致（2 个 open-in-browser 5s 超时 pre-existing flaky，新增存量名单）。
- **B3 browser_agent**：3224→mod.rs 57 + 13 个子模块（state/routing/diagnostics/capture/snapshot/tab_context_menu/webview/url_validation/commands_query/sessions/webview/snapshot/actions）+ tests.rs 276 逐字外移。130 处机械 pub(crate) 为唯一偏差（跨模块必需）；command_registry 23 命令等调用点零改动；cargo test 18/18 前后一致。
- **B4 local_usage**：主体 3169→1103（5 个 #[path] 平铺桶：codex_session_list 742/codex_session_parse 413/codex_summary_helpers 515/codex_session_roots 230/claude_scan 228）；tests.rs 2577→1844 + tests/session_mutation.rs 739（两段均 <2000）。43 处 pub(crate) bump + 52 行 decl 块为唯一偏差；20+ 引用方零改动；cargo test 71+71 前后一致；tests.rs 内 child mod 需显式 #[path]（E0583 教训）。
- 波末：两道 baseline 重生成 + gate 绿 + 删 tsbuildinfo tsc 零 error。

**教训增补**：⑧ #[path] 加载的测试文件内再声明 child mod 必须继续显式 #[path]（裸 mod 触发 E0583）；⑨ 并行代理共享 target 时 cargo check exit 101 / 引用未落盘文件 E0583 为 transient，hub 协调后重跑即可。
### 波 3（2026-08-31 第三会话，4 代理并行，落地 1 commit）

- **B5 claude_history**：2881→30 壳 + 三族平铺（filter 1822 / loader 700 / delete 376）；17 处机械 pub(crate) 为唯一偏差；cargo test 61 passed/9 failed 前后逐字相同（9 个为既有失败名单，panic 签名逐字一致）。
- **B6 pi.rs**：3201→68 壳 + engine/pi/ 12 子模块（session_rpc 1330/session_send 584/stream_lines 250/background_tasks 188/session 160/session_interrupt 132 等）；Dual-Path Gate 判定函数集（is_pi_external_wakeup_allowed 等 5 件）单实现落 gates.rs 原路径重导出，dev/daemon 两转发器调用点零改动；110 处 pub(crate) 前缀为唯一偏差；cargo test lib 242+daemon 150 前后一致。
- **A4 FileTreePanel**：2622→1188（硬底测算 ~1180，memo 推导链 ~250 性能敏感区未动，拍板接受）；新建 fileTreeContextMenu 481（deps 29 名逐字留调用点、menu item id 集合比对一致）+ useFileTreeLazyChildren 275 + useFileTreePreviewPopover 296 + useFileTreeItemOperations 753；59/59 测试前后一致。
- **C1 GitHistoryPanelImpl**：3662→1932（<2000 ✓）；11 个同目录 hook（deps 对象模式，DataLoading 先例）；4 锚点原地不动，两 scope bag 与 HEAD 逐字节一致；两治理脚本绿；git-history 测试 8 failed/202 passed 前后逐字相同（8 个为既有 GitHistoryWorktreePanel）。
- 波末：两道 baseline 重生成 + gate 绿 + 删 tsbuildinfo tsc 零 error。
- 事故登记：波中仓内出现 0 字节杂散 src-tauri/src/bin/cc_gui_daemon/main.rs（duplicate bin 阻塞 manifest 解析），B6 移至 /tmp 恢复；来源未定位（非 B5/B6 任务内容），后续波次留意。
### 波 4（2026-08-31 第三会话，2 代理 + 主会话 C2，落地 1 commit）

- **B7 runtime/mod.rs**：2585→62 壳 + 5 子模块（manager 2112/entry 324/coordinator 101/end_context 30/consts 8）；94 处 pub(super) 为唯一偏差（逐行断言纯前缀插入）；cargo test 203 passed/3 failed 前后一致（3 个环境性失败为基线既有）。治理豁免登记：runtime/manager.rs 2112 行为新文件 >800，触发 new-file ratchet，同 PR 重生成 new-file baseline 收口（逐字搬运的 struct+impl 单块无法再切，属豁免情形）。
- **A5 SettingsView**：2611→1625（纪律④硬底 ~1650 拍板接受；fail>2000 闸门过）。状态下沉四域（外观→BasicAppearanceSection 1525→1789 / open apps→OpenAppsSection 799→936 / 分组→ProjectsSection 417→536 / 快捷键→ShortcutsSection 330→374）；8 同构 doctor 回调收敛 useDoctorRunner 注册表泛型 117；死 picker ~41 行删（计划明确例外）。测试先行：+useDoctorRunner.test 9 个 +BasicAppearanceSection.test 5 个直渲染；关联测试 1 failed/256 passed 前后同（RuntimePoolSection 既有），零新增。lazy/Suspense 边界与 SettingsViewProps 导出面零改动。
- **C2 治理收尾（主会话）**：
  - scanner 加可选 `strictReduction` 布尔字段（policy 校验 + 两个 classify 返回点挂旗 + isBlockingLargeFileFinding 把 retained+strictReduction 重分类为阻塞）；isBlockingLargeFileFinding 升 export；+3 个 parser 测试（retained 阻塞/未启用不阻塞/非布尔拒绝），node --test 0 fail。
  - 启用面评估落地：bridge-runtime-critical（status.rs 3020 retained）与 feature-hotpath（useThreadMessaging 2819 / GitHistoryPanelView 3012 retained）仍有存量 retained，启用即红，**未启用**；settings-view-sections 组 retained 清零（A2 后），**已启用** strictReduction（防 2547→2648 反弹前科）。
  - workflow 加 `pull_request` trigger（hard-gate job 三 OS 矩阵 + mode=fail 既有步骤直接成为 PR blocker；advisory watch 保持 schedule/dispatch 限定）。
  - 教训⑩：给 scanner 测试文件加用例会撞 new-file ratchet（1054→1124 超 allowance 50）——治理脚本自身的测试增长需同 PR 重生成 new-file baseline。
- 波末：两道 baseline 重生成 + gate 绿（strictReduction 启用后仍绿）+ near-threshold 绿 + 删 tsbuildinfo tsc 零 error。

### Wave 5 收官指标（2026-08-31 第三会话末实测）

| 指标 | Wave 5 前 | Wave 5 后 | 主计划起点（08-30） |
|---|---:|---:|---:|
| 源码 >2000 行（非测试） | 60 | **49** | ~80 |
| SessionManagementSection | 2648 | 1758 | — |
| useAppServerEvents | 1981 | 442 | 3818 |
| GitHistoryPanelImpl | 3662 | 1932 | 4933 |
| 全仓最大源码 | 3662（GitHistoryPanelImpl） | **3170**（daemon_state/git.rs） | 7685 |
| bridge-runtime-critical >2600 | 6 个 | **1 个**（status.rs 3020） | — |
| gate（三道 baseline） | 绿 | 绿 | — |
| tsc 全仓 | 零 error | 零 error | — |

**W5-A 验收**：dispatcher 四族落地 ✓；F3 面板四件 <2000：SessionManagementSection 1758 ✓ / FileViewPanel 2023（拍板值，硬底已算）⚠ / FileTreePanel 1188 ✓ / SettingsView 1625（拍板值）✓ 闸门过；源码 >2000 ≤50 ✓（49）。
**W5-B 验收**：bridge-runtime-critical 区 app_server_cli 2458 / grok_history 1836 / claude_history 30 / pi 68 / local_usage 1103 / runtime 62 全部 ≤2600 ✓；browser_agent 3224→mod.rs 57 ✓。残余：engine/status.rs 3020（Wave 6 候选）。
**W5-C 验收**：GitHistoryPanelImpl <2000 ✓（1932）；strictReduction + PR trigger 落地 ✓；源码 >2000 进入 40 区间 ✓（49）。
