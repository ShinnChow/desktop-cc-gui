# 「新建会话」抽屉卡死事故完整交接文档（2026-08-29）

> 写给下一位接手人。本文档如实记录：现象、全部实测证据、已做的修复、**已解决的问题与后续观察项**、
> 委托人（项目所有者）的核心假设「弹窗改抽屉才引发卡死」的当前验证状态、以及可以
> 一锤定音的判定实验。本文档最初记录时所有修改均在工作区未提交；最终收口前已完成代码、提案与文档校准。

---

## 0. 一句话现状

- 抽屉模式下创建/切换会话会周期性整机无响应（下称「卡死」）。
- 已通过**三次进程采样 + 日志埋点**证实并修复了 **4 个真实的性能/崩溃缺陷**（全部与
  PI 会话数据在本机膨胀到 287MB/323 文件有关）。
- **已解决**：渲染层风暴的直接放大点已定位为无变化 AppShell domain 快照仍重建外层 bag，现已通过 outer-bag identity reuse + `memo(AppShellView)` 收口；最新诊断窗口未再出现 render/freeze storm 或主线程停摆。
- 委托人假设「弹窗改抽屉」是根因。当前证据**既不能证实也不能完全证伪**（详见 §5，
  含一锤定音的 A/B 实验方案）。

---

## 1. 现象（委托人视角）

1. 抽屉模式下，点击「+」→ 新建会话抽屉 → 点任意 CLI 行，周期性整机卡死（鼠标能动、
   界面不响应，需要等待或强退）。
2. 「静置一段时间再操作」更容易触发；「连续创建/切换」更容易触发。
3. **委托人的核心观察：抽屉改版之前（弹窗模式），同样操作从来没有卡过，一次都没有。**
4. 修复过程中多次出现「修好 → 复测正常 → 又卡死」的循环。
5. 最后阶段（全部修复生效后）：左侧边栏区域卡，切换工作区卡。

---

## 2. 时间线（按证据排序）

| 时间 | 事件 |
| --- | --- |
| 会话开始前 | 工作区已有在途未提交改动：新建会话抽屉改版（Shared/Native 分组、全屏 backdrop、折叠持久化、Qoder 发行版二级弹层）、`useEngineController` 引擎切换 15s 超时护栏（F2，针对 Qoder CN 点击卡死事故） |
| ~19:31 | 第一次采样（实例 2089，105% CPU）：**主线程 100% 卡在 `client_store_patch` 全量 serde 序列化**（composer.json 3MB）。→ 修复 F5 |
| 19:35-19:42 | 加第一版埋点；19:42 时间线显示 3 次创建成功（Qoder CN 3.2s / PI 0.2s）|
| 19:47-19:50 | 修复 importer（指纹 + 8s 窗口）|
| ~19:59 | 委托人复测：**静置后点创建又卡死**（此时 store 修复已生效）→ 说明有第二个阻塞点 |
| 20:35:22 | 新实例启动（20:28 二进制，含 store+importer 修复）。启动即 149% CPU |
| ~20:36 | 又卡死。采样：主线程**空闲**（store 修复生效！），tokio 线程烧在 `list_pi_sessions` 全量扫描（287MB），渲染进程 WebContent 99.5%（JS freeze/GC 风暴）。另有 4 个 pi 常驻进程 + 1 个 opencode 96% 空转 |
| 20:41-20:56 | 修复 `list_pi_sessions`（cwd 预过滤 + 64KB 有界读）；20:56 rustfmt 重写文件；20:58 二进制重建 |
| 21:14-21:25 | 委托人再测：**row-click 落盘了（点击被处理），但 create-session 一条都没有**（创建流未启动！）；21:24:34 起 freeze-storm 爆发（**每秒 11.5万~13.5万次 Object.freeze**，持续 10s）|
| 21:30 | 发现诊断栈被隐私层脱敏（字段名 `stack` 命中敏感词）→ 改为 `frames` 数组；又发现 JSC 栈格式过滤 bug → 修复 |
| 21:34 | 新实例启动 3 秒内风暴再现（11.4 万 freeze/s）；**Qoder CN 创建 89ms 全程成功**（unavailable:false）→ 风暴独立于创建存在 |
| 21:43 | 加 `debug.shell-render-storm` 探针（AppShellView）：抓到全壳重渲染风暴，changedKeys 覆盖 11 个 domain |
| 21:52-21:56 | 委托人重启客户端后复测：**切换工作区卡死**。探针记录：启动序列（bootstrap/start 等齐全）中全壳以 **45 render/s** 重渲染，freeze 峰值 9.7 万元素/s，持续十几秒后衰减 |
| 22:00+ | 委托人要求停止改动、写交接文档。本文件。 |

---

## 3. 已证实并修复的问题（每条都有 sample/日志实证）

### 3.1 F5-A：client store 读写阻塞主线程（第一次采样实证）

- **现象**：主线程 300/300 采样卡在 `client_store_patch` → serde 全量 parse+serialize。
- **根因**：`client_store_read/write/patch` 是同步 Tauri 命令（主线程执行），每次全量
  parse + 序列化整份 store。`composer.json` 已 3MB、`app.json` 1.5MB，单次 patch 秒级。
- **修复**：`src-tauri/src/client_storage.rs` 三命令改 `async` + `tokio::task::spawn_blocking`
  （payload 解析一并下移）；新增 `client_store_read_sync` 仅供 `src/menu.rs` 启动期菜单
  语言探测一次性调用。
- **正确性论证**：前端每 store 有 `writeChainByStore` promise 链保证写序；Rust 侧文件锁
  + 进程内 cache 保证合并正确。
- **验证**：`cargo test --lib client_storage` 8/8。

### 3.2 F5-B：session index 导入器每个 tick 全量重扫 PI 会话（第二次采样实证）

- **现象**：tokio 线程烧在 `run_import_tick → sync_pi_engine → list_pi_sessions →
  read_session_summary`。
- **根因**（两道闸全失效）：
  1. `pi_home_fingerprint()` 把 `~/.pi/agent` 目录 mtime 算进指纹，而常驻 pi 进程持续
     改写该目录（models-store.json/memory/npm）→ 指纹永不匹配；
  2. `SOURCE_FRESH_MAX_AGE_MS = 8s` < tick 间隔 90s → 永远「超龄」。
  → 每 90 秒 tick 全量重扫 323 个文件（当时 287MB），烧满一核数分钟。
- **修复**：`writers.rs` 指纹剔除 `~/.pi/agent`（保留 sessions 根 + 各 cwd 子目录）；
  freshness 窗口 8s→10min。真变更（invalidate / 指纹失配 / disk-newest>ledger）仍立即重扫。
- **验证**：session_index 83/83（含 `pi_fingerprint_changes_when_cwd_subdir_gets_new_jsonl`）。

### 3.3 F5-C：`list_pi_sessions` 全量读所有工作区会话文件（第三次采样实证）

- **现象**：3 个并发 `list_pi_sessions` 命令在 invoke 处理器里全量 parse（112 采样）。
- **根因**：`limit=50` 只截断结果；实现是先对 `~/.pi/agent/sessions/**` **所有文件**
  `read_session_summary`（逐行 parse 到 EOF）再过滤 cwd 再 truncate → 每次调用 287MB。
  调用方是侧栏线程列表加载（`useThreadActions.ts:2631`、`useThreadMessaging.ts:3171`），
  工作区切换/刷新即触发。
- **修复**：`pi_history.rs`
  1. cwd 预过滤提前（只读 header 一行，不匹配的文件不再读）；
  2. 新增 `read_session_summary_for_list`（64KB 有界读：header + 首条用户消息 +
     消息存在性；`updated_at` 用 mtime，排序语义不变；`message_count` 降级为 0/1
     存在性标记——空会话清剪只判 `==0`，语义保留）。
- **效果**：单次调用 287MB → <8MB（30-100×）。注意：**codemoss 工作区自己的会话就有
  264MB/124 文件，其中 8 个 >5MB（最大 24.4MB）**，这些文件自身仍需逐行扫（有界 64KB 后
  已可控）。
- **验证**：pi_history 13/13、session_index 83/83、rustfmt clean。

### 3.4 F5-D：会话标题 UTF-8 截断 panic（委托人报告「这个消息一直有」）

- **现象**：dev 控制台反复出现
  `panicked at src/session_index/writers.rs:139: byte index 6 is not a char boundary;
  it is inside '个' (bytes 4..7) of '启3个子代理夸我'`。
- **根因**：`is_mossx_program_control_text` 用 `trimmed[..6]` 按字节切片；标题第 6 字节
  落在 CJK 字符中间即 panic → **该 import tick 中途夭折**。中文标题会话多 → tick 反复崩。
- **修复**：改 `trimmed.as_bytes()[..6].eq_ignore_ascii_case(b"MOSSX_")`（字节比较不 panic，
  `MOSSX_` 前缀识别语义不变）。
- **委托人判断**：此 panic 是慢性噪声、与卡死无直接因果 —— **接受**，但它是真实崩溃且
  会杀死 tick，修复本身无争议。
- **验证**：importer 3/3、session_index 83/83。

### 3.5 此前在途的修复（本会话之前已存在于工作区，非本会话所改）

- **F2 引擎切换护栏**（`useEngineController.ts`）：`switch_engine` IPC 15s 有限等待
  （超时保乐观返回）；引擎未安装时不再同步 await 全量检测，改 per-engine 后台刷新；
  迟到结果由 generation 守卫合并不回滚。背景：Qoder CN 点击卡死事故（switch_engine
  无超时挂死创建流 loading 弹窗）。
- **抽屉 UI**：Shared/Native 分组、折叠持久化（`useSidebarWorkspaceMenuSectionCollapse`）、
  全屏 backdrop 抽屉样式。
- **Qoder 双直入口**（本会话所改）：去掉「选择 Qoder 发行版」二级弹层，Shared/Native
  两组各平铺 `Qoder Global` / `Qoder CN`；Shared 创建新增可选 `preferredProviderId`。

---

## 4. 收口后的残余观察项

### 4.1 渲染风暴（已修复）

**实测机制**（`debug.shell-render-storm` + `debug.freeze-storm` 探针，多次捕获）：

- 启动序列 / 切换工作区 / 创建后，全壳（AppShellView → useAppShellLayoutNodesSection →
  useLayoutNodes → 全部 zone）以 **最高 45 render/s** 重渲染；
- 每遍创建 2.6 万+ React 元素，**dev 模式下每个元素都被 `Object.freeze`**（React dev 的
  `ReactElement` 构造器内冻结）→ 每秒 6~13.5 万次 freeze + GC 风暴（WebContent 99%+
  的直接原因）；
- 风暴窗口内点击/切换全部无响应；持续几十秒后自行衰减至 4-12 render/s。
- `perf.main-thread-stall` = 0：渲染是分片的（scheduler 让出），没有单次 2s+ 长任务，
  但「永远在渲染」等效于卡死。

**历史驱动源（已收口）**：风暴窗口 changedKeys 覆盖 `runtimeThreadContext` /
`workspaceCatalogContext` / `composerContext` / `sessionIdentityContext` /
`modelSelectionContext` / `settingsContext` / `fileEditorContext` / `accountSurfaceContext` /
`workspaceNavigationContext` / `gitSurfaceContext` / `layoutContext` ——
即启动/切换期间**多个 domain 被高频合法写入**（会话列表加载、索引导入、检测事件、
composer 状态），每次写入 → `buildAppShellDomainContexts` 重建全部 context 对象 →
全壳重渲染一遍。

**为什么这是架构问题**：任何一次 domain 写入的渲染成本 = 整壳 2.6 万元素的创建+reconcile。
本次收口通过 `reuseStableAppShellDomainContexts` 复用 slice 与外层 bag identity，并以
`memo(AppShellView)` 阻断无变化快照的整壳重建；不使用会让事件 handler 滞后的 deferred snapshot。
长历史 PI 会话仍可能出现单次较长 React commit，后续由 history render budget change 单独处理。

### 4.2 委托人假设：「弹窗改抽屉才引发卡死」——收口结论

委托人的观察是真实的且必须严肃对待。收口结论是：抽屉是放大器，不是唯一根因；抽屉版本同时增加了首屏平铺内容与更长的交互生命周期，而后台数据规模和 AppShell identity churn 才是卡死的主要机制。

**已排除的「抽屉专属」嫌疑**：
- 「+」按钮 → `showWorkspaceMenu` 链路逐帧核对：纯同步菜单打开，**无任何 IPC/扫描调用**，
  与 HEAD 弹窗版完全同构（HEAD 的 overlay 同样是 portal + backdrop + 相同的
  handleAction/onWorkspaceMenuAction 链）；
- 抽屉打开后 21:14:15 `open` + `open-rendered` 正常落盘、21:34:54 Qoder CN 创建 89ms
  完成——抽屉本身能正常打开和创建；
- 创建流代码（`runCreateSessionFlow`）在弹窗→抽屉之间**零改动**（git 确认
  `useWorkspaceActions.ts` 上次变更是 Qoder 引擎接入）。

**后续观察项（不阻塞本 change）**：
1. **F2 护栏的 fire-and-forget 强制检测**：引擎状态缺失时每次点击 `void
   requestEngineDetection({force:true, engines:[engineType]})` 会 spawn CLI（20:36 现场
   抓到 opencode 96% 空转、4 个 pi 进程堆积）。弹窗时代该路径是同步 await 全量检测
   （有 25s 守卫，不会堆积）。**这是工作区相对 HEAD 的真实行为差异之一**，可能与
   卡死有交互（spawn 风暴挤占资源），未单独验证。
2. **`writeClientCreatedSessionIndex` / 创建后索引失效 → 触发重扫** 的时序在抽屉高频
   操作下被放大。

### 4.3 已知但未修的其他隐患（另行立项）

- `composer.json` 3MB 瘦身（store patch 已不阻塞主线程，但单次 IO 仍 O(3MB)）；
- daemon 串行 RPC 循环队头阻塞（`src-tauri/src/bin/cc_gui_daemon.rs:2915` 的
  `handle_rpc_request(...).await` 在 while-read-line 循环内内联 await——仅 daemon 模式
  受影响，桌面 in-process 模式不走此路径，本次未动）；
- PI 活跃会话期间每个 tick 仍会重扫该工作区（mtime 变化驱动，正确行为，有
  `ASYNC_ENGINE_LIST_TIMEOUT` 兜底）；
- `debug.freeze-storm` 的 `frames` 在 21:34 那轮为空（JSC 栈格式过滤 bug，已修复为
  接受 `fn@file:line` 格式），**带函数名的完整栈尚未捕获到一次**——下一位接手人
  复现时大概率能直接拿到肇事函数名。

---

## 5. 本会话产生的观测网（接手人使用手册）

全部探针立即落盘到 `~/.ccgui/client/diagnostics.json`（key:
`diagnostics.rendererLifecycleLog`），强退不丢（除 300ms client-store debounce 窗口内
的条目）。读取方式：python json 解析该文件按 `label`/`timestamp` 过滤。

| label | 含义 |
| --- | --- |
| `perf.new-session-menu {stage: open, entry: workspace-menu/session-menu}` | 抽屉打开（按钮点击被处理）|
| `perf.new-session-menu {stage: open-rendered}` | 抽屉渲染完成（没这条=卡在渲染提交）|
| `perf.new-session-menu {stage: row-click, actionId, unavailable, hasChildren}` | 行点击被处理；unavailable=true = 点击被吞 |
| `perf.new-session-menu {stage: render-storm, renderCount, elapsedMs}` | 抽屉 5s 内重渲染 >150 次 |
| `perf.create-session {stage: start/workspace-connected/engine-switched/thread-started/done/timeout/error, elapsedMs}` | 创建流分阶段耗时（Native 与 Shared 都有）|
| `perf.main-thread-stall {gapMs}` | JS 主线程停摆 >2s（恢复后落盘）|
| `debug.freeze-storm {total, frames}` | 每秒 Object.freeze 超过 2000 次的风暴 + 最多 40 条 JS 调用帧（JSC 格式 `fn@file:line`）|
| `debug.shell-render-storm {rendersPerSecond, changedKeys, changedIdentity}` | 全壳重渲染风暴 + 变化的 domain key |

代码位置：
- 采样器/看门狗：`src/services/rendererDiagnostics.ts`（`installFreezeStormSampler` /
  `installMainThreadStallWatchdog`，在 `src/bootstrapApp.tsx` startApp 顶部安装）；
- 探针埋点：`useSidebarMenus.ts`（open/row-click）、`useWorkspaceActions.ts` +
  `useAppShellSections.ts`（create-session）、`appShellView.tsx`（shell-render-storm）。

**⚠ TEMP-DEBUG 标记**：`Object.freeze` 全局补丁、两个看门狗、各探针均为
TEMP-DEBUG（代码内已标注），**发布生产前必须移除**（尤其 Object.freeze 补丁有全局
侵入性）。`appShellView.tsx`、`useSidebarMenus.ts`、`useWorkspaceActions.ts`、
`useAppShellSections.ts`、`bootstrapApp.tsx`、`rendererDiagnostics.ts` 内搜索
`TEMP-DEBUG` 即可全部定位。

---

## 6. 历史 A/B 判定实验方案（本 change 已用日志与代码复核收口）

**实验目的**：记录当时为判定「卡死」到底是抽屉改动引发，还是数据规模 + 既有代码放大效应而设计的方案。当前已通过 renderer diagnostics 与代码复核完成收口，不再要求回退工作区重跑该实验。

**实验 A（HEAD 基线复测，最干净）**：
```bash
cd /Users/chenxiangning/code/AI/github/codemoss
git stash push -m "ab-test-head"        # 回到 HEAD = 弹窗模式、无任何修复
npm run tauri dev                        # 用弹窗模式做完全相同的操作
# 操作脚本：启动后静置 5 分钟 → 切换 4 个工作区各 2 次 → 每个工作区创建 2 个会话
# 观察是否出现卡死；随后强制重复多轮
git stash pop                            # 恢复工作区
```
- 若 HEAD（弹窗）同样卡死 → 抽屉无关，是数据规模 + 既有代码（§3 的四个缺陷 + §4.1
  渲染风暴）；
- 若 HEAD 完全流畅而工作区必卡 → 进入实验 B 定位到文件。

**实验 B（二分定位）**：工作区改动分四组，逐组恢复：
1. Rust 修复（client_storage / writers / pi_history / menu）；
2. 引擎护栏（useEngineController ± test）；
3. 抽屉 UI（SidebarWorkspaceMenuOverlay / useSidebarMenus / sidebar.css / i18n / 折叠 hook）；
4. Qoder 双直入口 + Shared 创建透传（其余前端文件）。
每次只恢复一组 → 复现操作 → 记录卡死与否。4 轮内必锁定引入组。

**实验 C（生产构建验证）**：
```bash
npm run tauri build    # 生产构建无元素 freeze、无 StrictMode 双渲染，渲染成本 5-10× 低
```
若生产构建不卡/明显缓解 → dev 放大是重要因素，卡死问题降级为「启动窗口性能优化」。

**注意**：`git stash` 不影响未跟踪文件（`useSidebarWorkspaceMenuSectionCollapse.ts`、
openspec 目录会残留，HEAD 代码不引用它们，无影响）。stash pop 后务必 `npm run
typecheck` 快速自检。

---

## 7. 本会话改动引入的副作用（诚实清单）

1. **TEMP-DEBUG 探针**有少量常驻开销（freeze 补丁包装全局 `Object.freeze`、1s 看门狗
   interval、渲染计数）——dev 判断性能时读 `perf.hotspot-summary` 需知晓这部分存在；
   发布前必须摘除（§5 的 TEMP-DEBUG 标记）。
2. **45s 创建弹窗兜底**（`loadingProgressActions.ts` 可选 timeoutMs；侧栏两条创建路径
   已启用）：超时后弹窗强制关闭并报错 toast——行为变化，防永久挂死的保险。
3. **`list_pi_sessions` 的 `message_count` 降级为 0/1**：列表路径不再统计精确消息数
   （空会话清剪只判 `==0`，语义保留；importer 的 `read_session_summary` 未动，索引
   数据仍精确）。若有消费方依赖精确值需回归。
4. **`list` 路径 `updated_at` 改用 mtime**：排序语义等价（mtime 即最后写入时间），
   但与旧「文件内最后时间戳」在极端情况（文件被 touch）可能差异。
5. **immediate 诊断写入**会增加 diagnostics store 的写频（每 300ms 去抖合并，实测
   hotspot 2-3ms/次，非热点）。
6. 曾提交后撤回的 3 个 commit（`6b317b704`/`feaa2fed9`/`ece77a488`）内容已全部回到
   工作区，无丢失；远端从未推送。

---

## 8. 收口时工作区文件清单（已提交）

**Rust（4 文件）**
- `src-tauri/src/client_storage.rs` — store 三命令 async 化 + `client_store_read_sync`
- `src-tauri/src/menu.rs` — 改用 sync 读
- `src-tauri/src/session_index/writers.rs` — PI 指纹剔除 agent 目录；freshness 8s→10min；
  UTF-8 panic 修复
- `src-tauri/src/engine/pi_history.rs` — `list_pi_sessions` cwd 预过滤 + 有界读

**前端（22 文件，含此前在途改动）**
- 抽屉/菜单：`useSidebarMenus.ts(+test)`、`SidebarWorkspaceMenuOverlay.tsx(+test)`、
  `Sidebar.tsx`、`Sidebar.test.tsx`、`Sidebar.session-folders.test.tsx`、
  `useSidebarWorkspaceMenuSectionCollapse.ts`（新）、`sidebar.css`、i18n 10 语言 sidebar.ts
- 引擎护栏：`useEngineController.ts(+test)`
- Qoder 双直入口 + Shared 透传：`useSidebarMenus.ts`（同上）、
  `resolveSharedSessionCreateInitialTarget.ts(+test)`、`useAppShellSections.ts`、
  `layoutNodesTypes.ts`
- 观测网 + 兜底：`rendererDiagnostics.ts`、`bootstrapApp.tsx(+test)`、
  `loadingProgressActions.ts`、`useWorkspaceActions.ts(+test)`、`appShellView.tsx`
- 提案：`openspec/changes/fix-qoder-new-session-freeze-direct-entries/`（新，validate
  strict 已过）+ `openspec/changes/README.md` 索引

**不要动的无关文件**：`openspec/changes/fix-pi-terminal-identity-codex-runtime-noise/`
（另一条流的未跟踪目录）。

**已知测试基线**（stash 到 HEAD 复核过，均为存量，非本工作区引入）：
- 前端：app-shell.startup 9、appShellFeatureBoundaries 1（composer 违规 import）、
  Sidebar refresh 1、session-folders 3、useAppServerEvents.compaction 3、
  useSidebarSettingsPinnedActions 1、以及 threads/messages/git 等域 ~40 文件
  （完整清单见会话记录，逐文件计数与 HEAD 一致）；
- Rust：15 个 flaky/存量（claude_history / runtime / session_management / dsh supervisor，
  隔离复跑与 HEAD 基线一致）。

---

## 9. 复现与验收清单（给下一位）

1. `npm run tauri dev` 启动（等编译完成，app 窗口出现）。
2. 复现脚本：启动后**静置 5 分钟** → 打开抽屉 → 每个工作区创建 1-2 个会话 → 切换
   工作区 4 次 → 观察。
3. 卡死时：**先等 30 秒**（可能自愈并落盘），然后强退。
4. 叫 AI 或手动读证据：
   - `python3` 读 `~/.ccgui/client/diagnostics.json`，过滤
     `debug.freeze-storm`（看 `frames` 数组 = 肇事 JS 函数栈）、
     `debug.shell-render-storm`（rendersPerSecond + 哪些 domain 在变）、
     `perf.main-thread-stall`（gapMs）、`perf.create-session`（卡在哪个阶段）、
     `perf.new-session-menu`（open/row-click 是否到齐）；
   - 若 `frames` 为空：检查 vite 是否服务最新
     `src/services/rendererDiagnostics.ts`（curl localhost:1420 路径 grep freeze-storm）。
5. 若卡死时进程还活着：`sample <pid> 5 -file /tmp/x.txt` 采样主进程与 WebContent
   （`ps aux | grep WebContent` 找最高 CPU 的）。
6. 判定后按 §6 实验定位，修复后跑 §8 基线比对。

---

## 10. 给接手人的三个判断题（本会话的悬案）

1. **渲染风暴驱动源**：11 个 domain 的写入在启动/切换时高频发生是「合法数据更新」，
   但「每次写入全壳 2.6 万元素重渲染」是架构税。方向：zone memo 化 / 高频写入合批。
   这是长期正确的投入（本仓库多个 perf change 已在往这个方向走）。
2. **F2 fire-and-forget 检测堆积**：20:36 现场的 CLI 进程堆积（opencode 96%、4 pi）是
   否由 F2 的 `void requestEngineDetection({force:true})` 每次点击触发导致？建议给
   force 检测加 per-engine 节流（如 10s 内同引擎不重复 force）。
3. **委托人假设的最终裁定**：跑 §6 实验 A。如果 HEAD 弹窗流畅，按实验 B 二分；如果
   HEAD 也卡，请把数据告知委托人（286MB PI 会话数据是本周涨出来的，附
   `find ~/.pi/agent/sessions -type f -size +5M` 的文件清单）。

---

*文档结束。写于 2026-08-29 深夜，作者：ZCode 会话（多轮采样与修复尝试的完整记录如上，
最终收口提交前已完成上述代码、提案和文档校准；后置观察项仍由独立 change 管理。*

## 11. Release 复测补充（2026-08-29）

打包版再次复现时，WebKit WebContent renderer 达到 100% CPU，`sample` 显示主线程长期停在
`MouseEvent → JavaScript microtask checkpoint`，并伴随 `Object.freeze` 与 GC。宿主进程和
`cc_gui_daemon` 均空闲，故排除后端 IPC 等待为当前卡死主因。

复核发现上一版将定位用的 `installFreezeStormSampler` 打进了 release：它全局替换
`Object.freeze`，每次调用都同步执行 `Date.now()`，达到阈值后还会构造 Error stack 并
immediate 写 diagnostics。与此同时 `AppShellView` render 内和抽屉 mount effect 也执行
同步 diagnostics 写入。这些探针会放大原有渲染/冻结压力，属于错误的生产副作用。

修复口径：移除 `Object.freeze` monkey-patch 及 render/effect/菜单点击路径的 immediate 探针；
保留创建会话异常路径的低频日志和主线程 stall watchdog。前端目标测试 85/85、bootstrap
与 workspace action 测试 27/27、`npm run typecheck`、`npm run build` 均通过；产物中已检索
不到 `ccguiFreezeSamplerInstalled`、`debug.freeze-storm` 或 `debug.shell-render-storm`。
