# Design: refactor-engine-detection-pipeline

按批次给出演练级设计。每批次独立可交付、可回滚；TDD 锚点测试先行（红测试必须先在现实现上跑出失败）。批次间依赖：B1/B2 后端独立先行 → B3 依赖 B1（轻量 detect 使 revalidate 便宜）→ B4 依赖 B3（SWR revalidate 才有事件流）→ B5 与 B4 同文件顺序执行 → B6 依赖 B4 → B7 依赖 B4/B5/B6。

## 关键架构决策

### D1 detect 只回答「装没装 / 版本 / 登录」，模型目录全部懒加载

「是否安装」是 10s 级版本探测就能回答的轻问题，「模型目录」是需要 ACP 握手 / spawn models 命令的重活，二者耦合在一个 `EngineStatus.models` 里是全部延迟的根源。方向已有两个先例：`engine-environment-doctor` 的「Codex Startup Detection MUST Be Metadata-Only」与 PI 的 version∥models 并行化。本 change 推广到全部引擎。

各引擎 detect 链裁剪表：

| 引擎 | 现状 detect 链（最坏） | 裁剪后 detect 链（最坏） | 移出项去哪 |
| ---- | ---- | ---- | ---- |
| Claude | login shell + 多轮 --version + models（静态） | --version ×1（B2 缓存环境解析后秒级） | 重复探测删除（无信息损失） |
| Codex | 纯文件探测（metadata-only） | 不变 | — |
| Gemini | --version(10s) | 不变 | — |
| OpenCode | version(10s) → help(10s) → `opencode models`(30s) = 50s | version(10s) → help(10s) = 20s | `opencode models` 留在 `get_engine_models`（既有） |
| Kimi / Grok | --version + 配置文件 models（便宜） | 不变 | — |
| PI | version(10s) ∥ RPC models 链(15s×3) ≈ 45s（已并行 ≈20s） | --version(10s) | RPC 链留在 `get_pi_models`（既有） |
| Qoder | version(10s) → login spawn(10s) → ACP(20s)+session/new(15s) = 55s | --version(10s) + 同步凭据检查(<10ms) | ACP 链留 `get_engine_models`（既有）；login spawn 移 B6 phase 2 |
| DSH | version(10s) + host HTTP 探测 | 不变（host 可达性即其 installed 语义，超范围不动） | — |

契约：`EngineStatus.models` 字段保留（避免破坏消费方与 remote daemon 兼容），detect 只填便宜来源（静态 generated catalog / 配置文件读取），**保证语义为「可能有值的快照」而非「权威目录」**；权威目录唯一来源是 `get_engine_models`（`provider-model-catalog-refresh` / `cache-first-engine-model-catalog` 管辖，本 change 不碰其函数体）。前端 `refreshEngines` 现有「先 set status.models 再 `loadModelsForEngine`」逻辑天然兼容：models 空时直接走 load 路径。

探测集合还受两条铁律约束（详见 D9 / D10）：只探测供应商页面开启的引擎；单引擎故障与其他引擎完全隔离。

### D2 事件通道与顺序语义

- 事件名 `ccgui:engine-status-updated`（对齐 `src/services/events.ts` 的 `ccgui:*` 命名），payload `{ detectRunId: number, status: EngineStatus }`；后端在 `detect_all_engines` 每路 future 完成处 emit（`tokio::join!` 改为逐路 wrap：`join!` 前每路先 `.then(|s| emit + return s)`，保持并行语义不变）。
- `detectRunId` 由 manager 内 `AtomicU64` 单调递增；前端维护 `lastAppliedDetectRunId`，**丢弃 runId 更小的迟到事件**（旧 run 的 per-engine 结果不得覆盖新 run 结果；同 runId 按 engineType last-wins）。
- 事件频率 = 每引擎每轮 1 次（≤9 次/轮），低频；前端 merge 走 CatalogHost 既有 slice 发布 + host bus 字段级订阅，不新增根链 setState（Render Perf Baseline ①③ 合规）。同一轮的连续 per-engine 事件在前端**同 tick 合批**（microtask 内收集后单次 setState merge），避免菜单展开时 9 次连续事件触发 9 轮菜单 signature 重算。订阅按窗口各挂一个（detached 窗口需要各自状态），窗口内防 StrictMode 双注册。
- remote/daemon：detect_engines 在 remote 模式转发给 daemon（`commands.rs:1163-1168`），事件同样由 daemon 侧 emit、前端统一 listen，双侧同版本发布，无兼容矩阵负担（serde 新增字段 default 向后兼容）。web service 降级路径（`webServiceCodexOnlyStatuses`）忽略新参数、行为不变。

### D3 缓存契约（TTL + per-engine + SWR + last-good 落盘）

- `engine_statuses` 值升级为 `{ status: EngineStatus, detected_at_ms: u64 }`；manager 新增 `last_full_detect_at_ms`。
- `detect_engines(options)`，`DetectOptions { force: bool = false, engines: Option<Vec<EngineType>> = None }`（Tauri `Option` 参数 + serde default，daemon 同签名）：
  - `engines = Some(list)`：只探列表内引擎（force 语义强制应用于该子集），与缓存 merge 后返回；emit 事件同样只发子集。
  - `engines = None && !force`：cache 全新（`now - last_full_detect_at < DETECT_CACHE_TTL = 60s`）→ 直接返回缓存，0 spawn；
  - cache 过期/不存在：
    - **有 last-good 落盘** → SWR：立即返回 last-good（stale），同时 spawn 后台单飞 revalidate（`detect_revalidate_inflight: Mutex<Option<()>>` 防并发重复），逐引擎 emit + 覆写缓存 + 重写落盘；
    - **无 last-good（全新环境）** → 同步全量探测（现状路径），逐引擎 emit，返回完整 Vec。
  - `force = true`：同步全量重探（菜单「刷新全部」语义）。
- per-engine 防中毒：重探单引擎失败（error 非空 / installed 翻转）时**保留旧缓存值**并合入新 error 标注，不整体覆盖（与 `fix-pi-fallback-catalog-poison` 的 last-good 思路对齐）；仅「探测成功」才覆写。
- last-good 落盘：`<app_home_dir>/engine-status-last-good.json`（app_home_dir 与既有 client store 同目录，`lib.rs` setup 已有该目录引导），内容 = per-engine `{ status, detected_at_ms }`；写入时机 = 每次探测成功 merge 后（低频，不涉及用户存储改写，纯缓存文件）；读取容忍损坏/缺字段（serde default + 损坏即视为无 last-good）；**年龄超过 7 天的条目按「无该引擎 last-good」处理**，防止长期陈旧误导。
- **revalidate 触发面**（覆盖「用户绕过客户端卸载/安装 CLI」的场景）：① 启动 mount / coordinator 各入口；② **打开新建会话菜单时**若缓存已过 TTL → fire-and-forget 后台 revalidate（显式用户动作入口，不阻塞菜单弹出，结果经事件逐项翻转，不违反切会话红线）；③ 显式刷新按钮 / 引擎开关切换。**明确不做**秒级轮询与文件系统 watch（渲染红线 + nvm/npm 自定路径下监听点不可靠，误报成本高）——「重启 + 菜单打开」覆盖用户实际查看引擎状态的时机。被卸载引擎的探测 spawn 即 ENOENT 立即失败，不产生满额超时等待。
- `detect_preferred_engine`（auto 默认引擎解析，`status.rs:2401`）复用裁剪后的轻量探测，自动受益，不改签名。

### D4 环境解析缓存

- `build_search_paths`（含 `npm config get prefix` 阻塞 spawn，`app_server_cli.rs:112-126`）结果缓存：`tokio::sync::OnceCell` 不适用（需 TTL），用 `RwLock<Option<(PathBuf, Instant)>>`，TTL 30s；失效条件：TTL 到期，或「本轮 detect 全部引擎 not_installed」时主动清空重试一轮（覆盖「用户刚装好 CLI」场景）。
- `resolve_claude_via_login_shell`（`$SHELL -lic` 阻塞 spawn，`:513-541`）同款缓存（TTL 30s）。
- Claude 候选去重：`find_claude_code_binary` 内部的候选 `--version` 循环与 `probe_cli_version` 重复探测收敛——`detect_claude_status` 直接消费 `find_claude_code_binary` 返回的已验证 bin + version，不再二次 spawn `--version`（同轮 ≤1 次）。
- 这些函数是阻塞 `std` 调用在 async 上下文执行——本 change 不改执行模型（维持现状语义），仅消除重复次数；执行模型改造属 `unify-engine-send-core` 后续范畴。

### D5 前端 failed 态 + 超时 + coordinator

- `availabilityState` 扩展：`"loading" | "ready" | "requires-login" | "unavailable" | "failed"`；controller 新增 `detectFailed: boolean`。
- `detectEngines` invoke 包守卫：`Promise.race([invoke, timeout(25s)])`——25s 覆盖裁剪后最坏链（OpenCode 20s）+ 余量；超时后 controller 置 `isInitialized=true + detectFailed=true`（**必置位，根除永久「检测中」**），晚到的真实结果仍按事件/正常返回 merge 恢复 ready。超时不 abort 后端（Tauri invoke 无 abort；后端继续跑完并 emit，前端静默收货）。
- 失败 UI：菜单 statusLabel = `workspace.engineStatusFailed`（新增 i18n key × 全 locale），refreshable = true（点重试走 per-engine force）。
- `engineDetectionCoordinator`（新模块 `src/features/engine/hooks/engineDetectionCoordinator.ts`）：模块级 `inflightPromise` 单飞 + `requestEngineDetection(options)` 唯一入口；`useEngineController.refreshEngines` / `setActiveEngine` 兜底重测、`useFirstRunSetup`、`useProjectMapGenerationOptions` 全部改走该入口。controller 仍持有状态（CatalogHost 单实例不变，见 proposal Non-Goals），coordinator 只收敛「谁发起检测」。
- 菜单单引擎刷新（`useSidebarMenus` refresh 按钮）改调 `onRefreshEngineOptions(engineType)` → controller → `detect_engines({ engines: [engineType], force: true })`，不再全量；`useSidebarMenus.test.tsx` 既有「单引擎刷新不关菜单」用例保持。

### D6 登录态二段式

- `EngineStatus` 新增 `auth_state: AuthState`，`#[serde(default)]`，枚举 `unknown | authenticated | requires_login`（TS 侧 union 同名）。
- phase 1（detect 内，同步）：只做凭据存在性检查（Qoder：`qoder_has_pat_credential_for_distribution` / auth 文件 / env；其他引擎 `unknown`），**不 spawn 任何登录命令**。
- phase 2（detect invoke 返回后，后端 tokio spawn）：对 `installed && auth_state != authenticated` 的引擎跑 spawn 型登录探测（`qodercli status -o json`，10s 预算），完成后覆写缓存 + emit 事件；前端 merge 后菜单显示「需登录」（`workspace.engineStatusRequiresLogin` 已存在）。phase 2 随 revalidate 单飞执行（并入 D3 的 `detect_revalidate_inflight` 守卫，不单独重复 spawn）。
- `buildAvailableEngines`：`auth_state === "requires_login"` → `requires-login` 态（此前该态从不产出、只有 opencode 走独立路径）；opencode 既有 `workspaceOpenCodeLoginState` 逻辑不动。
- 范围控制：本期 phase 2 仅接 Qoder（唯一有 spawn 登录探测的引擎）；其余引擎 `unknown` 行为与现状一致，后续接入无契约变更。

### D7 联动同源（菜单 ⇄ 模型下拉）

- 数据通路：composer 域新增 `useEngineAvailabilityProjection()`：经 app-shell host bus **字段级订阅** `catalog.engineOptions`（既有 `useHostFields` 通道），映射 `Readonly<Record<EngineType, AvailabilityState>>`；不新增 prop-drill、不进根链。
- atomic 分组投影（`useProviderTargetCatalogOwners` groups 投影，`:749-847`）：
  - `loading` → 组 chip「检测中」、条目 disabled；
  - `failed` → 组 chip「检测失败」、条目 disabled、组级「重试」入口（调 per-engine force detect）；
  - `unavailable` → disabled + 「未安装」（叠加既有 `disabledCliEngineIds` 过滤，二者取交集）；
  - `requires-login` → **可选**（不禁止选择），条目带「需登录」标注；
  - `ready` → 现状行为。
  - **边界**：只改分组可用性展示投影；`fix-model-picker-send-authority` 的 picker 提交 / resolver / override 语义零触碰。
- 统一失效通道（状态翻转驱动，双向）：
  - detect merge 时 diff prev/next 的 `installed` / `auth_state`：发生翻转 → dispatch 既有 `PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT`（atomic 缓存已有监听自动失效）+ controller 侧 `refreshEngineModels(engine, { phase: "idle-prewarm" })` 重算 legacy 投影——均为事件驱动低频动作，不在切会话路径上；
  - 供应商 CRUD 事件（既有监听 `:897-912`）补齐 controller 侧：清除 `lastGoodModelsByScopeRef` 对应 scope，使 legacy `engineModelCatalogsAsOptions` 不再吃旧列表。
- 红线保持：`useProviderModelCatalogSync` 的 no-op 现状与「切会话零 catalog IPC」断言不变；联动全部挂在「detect 完成事件」与「CRUD 事件」上。

### D8 兼容与对齐

- `detect_engines` 参数/返回扩展与 remote daemon 双侧同仓库同版本发布；`cli-execution-backend-parity` 的对齐 requirement 通过「同一 change 内同步改双侧」满足，PR 描述附说明。
- `webServiceCodexOnlyStatuses` 降级路径（`appServer.ts:92-107`）不变。
- `EngineStatus` serde 新增字段全部 `#[serde(default)]`，历史落盘 last-good 与 remote 旧 payload 读取兼容。

### D9 启用范围过滤（铁律：开启的引擎才进入检测）

现状缺口：供应商页面引擎开关写 `AppSettings.disabledCliEngines`（黑名单，`types.rs:944-945`，后端 settings 已有该字段），但 `detect_engines` 只特判 Gemini gate，**不读黑名单**——关掉的引擎照样全量 spawn 探测。

设计：

- `detect_engines` / `detect_preferred_engine` 的探测集合 = 静态引擎全集 − `settings.disabled_cli_engines`；黑名单引擎 **0 spawn、不出现在返回 Vec**（消费端 `enabledEngineTypes` filter 与菜单 visibility 过滤已兼容缺失项）；`get_engine_status` 对黑名单引擎返回 `None`（调用方按未安装处理）。
- Gemini 既有 `gemini_enabled` + `GEMINI_RUNTIME_ENABLED` gate 保留，作为黑名单之外的运行时策略 gate（二者取并集排除）。
- 开关切换即时生效：设置保存路径（`update_app_settings`）检测到 `disabled_cli_engines` 变化 → 清 detect TTL 缓存（`last_full_detect_at_ms` 归零）+ 该轮起排除集合按新黑名单计算；前端设置面板保存回调（`VendorSettingsPanel → onUpdateAppSettings`，显式用户动作，非切会话路径）触发一次 coordinator detect，使菜单/下拉即时收敛。
- 前端 `refreshEngines` 的 active-engine fallback（persisted/detected 未安装时选第一个 installed）叠加黑名单过滤：被禁用引擎不得被自动选为 active；**当前 active 引擎被禁用时，按「不可用」处理并 fallback 到第一个开启且已安装的引擎**（复用既有 fallback 逻辑，仅加 enabled 判断，fallback 所需的黑名单从 `appSettings.disabledCliEngines` 读取）。
- 手动刷新能力全保留：菜单每引擎刷新按钮、设置页检测、向导重测入口不变；手动刷新一律走 force 语义（绕过缓存），期间保留既有进行中反馈（按钮 spinner / disabled）。
- 落盘 last-good 对黑名单引擎条目：读取时按黑名单过滤（设置晚于落盘变化的窗口不回灌禁用引擎状态）。

### D10 引擎间隔离（铁律：单引擎故障不传染）

现状隐患：`detect_all_engines` / `detect_preferred_engine` 用单层 `tokio::join!`——任一引擎 future panic 会 abort 整个 join，**全部引擎检测结果一起丢**（前端表现即全员「检测中」或 invoke 报错）。

设计：

- per-engine 独立 task：`detect_all_engines` 改为对每个引擎 `tokio::spawn`（B1 裁剪后参数 clone 为 owned），`JoinError`（panic/cancel）→ 该引擎落 `EngineStatus { installed: false, error: "detection task failed: …" }`，**其他引擎结果照常返回**。
- 隔离边界按层声明：
  - 探测层：单引擎 error / 超时 / panic → 仅该引擎 `EngineStatus.error`；缓存写入、per-engine last-good、事件 emit 全部按引擎粒度独立；
  - 前端层：B4 事件按引擎 merge（单条事件异常不碰其他条目）；B5 `failed` 全局态**仅用于传输层失败**（invoke reject / 25s 通道超时——这是通道问题，不是引擎问题）；单引擎探测失败在 UI 上只影响该引擎条目（error 标注 + 可重试），其他条目照常 ready；
  - 缓存层：单引擎失败保留该引擎 last-good（D3 防中毒），MUST NOT 触发整体缓存清除；D4「全引擎 not_installed 清环境缓存重试」是修复性重探、非错误传播，语义保留但重试结果仍按 D10 隔离写入。
- 铁律测试锚点：注入「某引擎探测必 panic / 必超时」的 fake probe，断言其余引擎结果、缓存、事件完整不受影响（B1 红测试）。

## 红线对照

| Gate | 对照 |
| ---- | ---- |
| Session Switch Catalog Fetch Gate | B7 联动不挂切会话路径；`useProviderModelCatalogSync` no-op 现状保持；既有红线测试作为回归锚点保持绿 |
| Render Perf Baseline | per-engine 事件每轮 ≤9 次低频事件驱动；merge 走 CatalogHost slice + host bus 字段订阅；无根链 setState、无数组追加型根 dispatch、无轮询 |
| Format Discipline Gate | `useSidebarMenus.ts` / `ModelSelect.tsx` / `useProviderTargetCatalogOwners.ts` 为多人常改文件：只动本次 hunk、禁止全文件重排、每批 `git diff --stat` 自查；改过的 `.rs` 过 `rustfmt --check` |
| Engine Onboarding Gate | 本 change 变更既有 engine 检测接入面：按 `docs/research/mossx-new-cli-onboarding-guide.md` §0 核对矩阵逐层勾选（§8 收口项），PR 描述附矩阵完成度 + 渲染目视验收 + CI gate 结果 |
| ADR 校准回写 Gate | 收口 / archive 前回写基石文档「最近校准」与「零、当前实现校准」表（检测流水线行），事实源 = 本 change id + `status.rs` / `manager.rs` / `engineDetectionCoordinator.ts` 路径 |
| AppShell Structure Gate | 不新增 domain bag key、不改 `src/app-shell/assembly/AppShell.tsx`；`useEngineAvailabilityProjection` 为消费面 hook，`npm run check:app-shell:governance` 作为回归项 |

## 不触碰清单（别人的在途代码）

- 工作区在途未提交文件（属 `fix-session-switch-jank-red-lines` 实施）：`src/features/session-activity/hooks/useSessionRadarFeed.ts`、`src/features/threads/utils/sharedQueuedFollowUpStore.ts(+test)`、`src/features/threads/utils/sidebarSnapshot.ts(+新test)`、`.tmp-changes-list.txt`。
- 在途 change 管辖域：`get_engine_models` 函数体与缓存语义（`cache-first-engine-model-catalog`）、ModelSelect 提交 / authority / overlay（`fix-model-picker-send-authority`）、`selectedComposerSession` 草稿选择（`fix-composer-cross-engine-draft-selection-leak`）、engine send core（`unify-engine-send-core`）。
- 与上述文件发生 git 冲突时：按 Merge Guardrails 列 capability matrix 做 semantic merge，禁止整文件 `--ours/--theirs`。

## 测量与验收口径

- 每批 TDD：红测试先在现实现跑出失败 → 实现转绿 → `npm run typecheck`（前端批次）/ `cargo test -p` 对应面（后端批次）→ `git diff --stat` 自查 → 中文 Conventional Commits 独立 commit。
- B7 后真机对照（A9）：全新环境 + 有 last-good 两种场景打开「新建会话」菜单，录屏核对逐项 reveal 与「检测中」单调递减；结果记入 tasks 收口项。
