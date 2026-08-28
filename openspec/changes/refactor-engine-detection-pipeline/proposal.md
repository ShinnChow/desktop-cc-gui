# Change: refactor-engine-detection-pipeline

## Why

用户反馈（2026-08-28）：客户端启动后「新建会话」菜单里所有 CLI 长时间停留在「检测中...」，体感非常慢；且菜单里的 CLI 可用状态与 composer 模型下拉「做不到联动，两边状态容易不同步、滞后」。全链路代码核实，三类结构性根因：

### 1. 全量打包、无进度事件——最慢引擎绑架所有引擎

`detect_engines` 一次 invoke 返回 9 个引擎的完整 `Vec<EngineStatus>`（`src-tauri/src/engine/status.rs:2345` `detect_all_engines` 的 `tokio::join!`，`manager.rs:281` `detect_engines_with_gates` 整体覆盖缓存）；`engine/status.rs` / `manager.rs` grep `emit` 零命中。前端在整个返回前对**所有**引擎渲染「检测中...」（`engineControllerAvailability.ts:37-39` `!isInitialized` 恒 loading；`useSidebarMenus.ts:1320-1326`）。结果：codex 这类纯文件探测（毫秒级）的引擎也要陪最慢的引擎等满全程。

### 2. 轻活重活耦合——检测内嵌慢目录探测，单引擎串行链最坏 55s

`EngineStatus` 内嵌 `models: Vec<ModelInfo>`（`engine/mod.rs:218`），把「是否安装/版本」（10s 级版本探测）与「拉模型目录」（重活）绑进同一次检测：

- Qoder 串行链最坏 **55s**：`--version`(10s) → 登录探测 spawn `qodercli status`(10s)（`status.rs:960-980`）→ ACP 握手(20s) + `session/new`(15s)（`status.rs:982-1045` `get_qoder_models`）；
- OpenCode 串行链最坏 **50s**：version(10s) → help(10s) → `opencode models`(30s)（`status.rs:746-800`）；
- Claude 检测 spawn `$SHELL -lic "command -v claude"`（login+interactive shell，`app_server_cli.rs:513-541`，nvm/zsh 插件多时秒级~十秒级），且同一轮里 `--version` 重复探测 3 遍以上；
- 每引擎每次检测 `resolve_bin_path` 与 `build_codex_path_env` 各构建一次搜索路径，内部用**阻塞的** `std::process::Command` spawn `npm config get prefix`（`app_server_cli.rs:112-126`），无缓存 → 一轮最多 ~18 次 npm 子进程，且阻塞 tokio worker；
- 而前端 `detectEngines()` 的 invoke **没有任何超时**（`appServer.ts:92-107`）——UI 卡「检测中」直到最慢链返回。

对照：PI 已做过一轮并行化（version ∥ models，最坏 ~20s，`status.rs:908` 注释）与 `engine-environment-doctor` 的「Codex Startup Detection MUST Be Metadata-Only」先例——**metadata-only 检测是既有方向，本 change 将其推广到全部引擎**。

### 3. 无缓存、无失败态、无持久化

- `detect_engines_with_gates` 无 cache-first 分支（`manager.rs:281-355`）：已有缓存命令 `get_engine_status` 不被检测路径使用，每点一次菜单单引擎刷新就是 9 引擎全量 spawn 风暴（`useSidebarMenus.ts:1259` → 全量 `refreshEngines`）；
- 检测结果零落盘，每次冷启动必然全量重探；内存缓存无 TTL 且全量覆盖，一次坏结果覆盖 per-engine last-good（`manager.rs:349-352`）；
- 前端 catch 块只写 debug 日志、不置 `isInitialized`（`useEngineController.ts:349-356`）→ **一旦失败，所有引擎永久停在「检测中...」**；`availabilityState` 无 `failed` 态、无重试入口；
- 检测入口多且跨模块无去重：CatalogHost mount（`useEngineController.ts:564-571`）、首启向导（`useFirstRunSetup.ts:188-258`）、project-map 面板（`useProjectMapGenerationOptions.ts:227`）各自裸调，单飞只在 useEngineController 内部；`setActiveEngine` 直接 `await detectEngines()` 绕过单飞（`useEngineController.ts:395`）。

### 4. 菜单与模型下拉两条状态链源头分叉

- 菜单消费 `engineStatuses`（detect 快照）的 `availabilityState`；而 atomic 模型下拉的分组 `enabled: true` 硬编码（`useProviderTargetCatalogOwners.ts:760-761`），**完全不读 installed/availabilityState** → 菜单「检测中/未安装」时下拉照样列模型，反之亦然；
- 两套模型 catalog 缓存互不失效：`useEngineController.engineModels`/`lastGoodModelsByScopeRef`（`useEngineController.ts:87,154`）vs `useProviderTargetCatalogOwners.modelCatalogCache`（`:146`）；`PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT`（`:897-912`）只清 atomic 一侧；
- `useProviderModelCatalogSync` 因切会话红线已降级纯记录（`useProviderModelCatalogSync.ts:47-86`），切会话后无任何对齐动作 → 下拉滞后到「打开菜单/发送前」才补，用户感知「滞后」；
- detect 只跑一次、菜单打开不重探 → CLI 装好后菜单仍显示旧状态直到手动刷新。

## What Changes

一个 change 内分 7 个 Batch 实施（TDD，每批先红后绿、独立可交付可回滚）：

- **B1 检测轻量化（解耦）+ 启用范围 + 引擎间隔离（铁律）**：
  - detect 链移除全部慢目录探测——Qoder ACP 握手 + `session/new`、OpenCode `opencode models`、PI RPC models 链全部移出 detect（只保留在既有 `get_engine_models` 按需路径）；Qoder 登录 spawn 探测移出 phase 1（见 B6）；`EngineStatus.models` 保留字段但只填便宜来源（静态 catalog / 配置文件），消费方不破坏；`detect_preferred_engine` 自动受益。
  - **启用范围铁律**：detect 探测集合 MUST 从 `AppSettings.disabledCliEngines`（`types.rs:944`，后端 settings 已有、现状 detect 不读）推导——黑名单内引擎 **0 spawn、不出现在返回结果**；Gemini 既有 `gemini_enabled` + `GEMINI_RUNTIME_ENABLED` gate 保留为额外 gate；`disabledCliEngines` 变化时 detect TTL 缓存失效，下一轮检测即时生效。
  - **引擎间隔离铁律**：`detect_all_engines` 从单层 `tokio::join!`（任一引擎 future panic 会炸掉整个 join、全部引擎一起丢）改为 per-engine 独立 task（owned 参数），单引擎 error/timeout/panic 只落该引擎 `EngineStatus.error`，MUST NOT 影响其他引擎的探测、结果、缓存与事件。
- **B2 环境解析缓存**：`build_search_paths`（含 `npm config get prefix`）与 `resolve_claude_via_login_shell` 结果进程级缓存（短 TTL + 失效条件），Claude 同轮重复 `--version` 收敛为 1 次。
- **B3 检测缓存 + last-good 落盘（SWR）**：Rust 侧缓存加 `detected_at` + TTL（60s）；`detect_engines` 扩展可选参数 `{ force?: bool, engines?: EngineType[] }`，默认 cache-first，支持 per-engine 强刷；检测结果 last-good 落盘 app 数据目录，冷启动先立即返回 last-good 并后台单飞 revalidate（stale-while-revalidate）；重探失败保留 per-engine last-good + error 标注（防缓存中毒对称）。
- **B4 逐引擎事件推送**：后端每完成一个引擎 emit `ccgui:engine-status-updated`（`detectRunId` + 单条 `EngineStatus`）；前端订阅 merge，菜单逐项 reveal；`detectRunId` 单调守卫防旧 run 事件覆盖新结果。
- **B5 前端失败态 + 检测收敛**：`availabilityState` 增加 `failed` 态 + i18n；detect invoke 包 25s 超时守卫，失败/超时必置 `isInitialized` 并可重试，根除永久「检测中」；新增模块级 `engineDetectionCoordinator`（跨 mount / 首启向导 / project-map / `setActiveEngine` 共享单飞）；菜单单引擎刷新改走 per-engine 参数，不再全量；**既有手动刷新能力全部保留（菜单每引擎刷新、设置页检测、向导重测），手动刷新一律 force 绕过缓存并保留进行中反馈**；打开新建会话菜单时 fire-and-forget 发起一次 detect（后端缓存裁决 fresh/stale），外部卸载的 CLI 无需重启即可被识别。
- **B6 登录态二段式**：`EngineStatus` 增加 `auth_state`（serde default，向后兼容 daemon 对齐）；phase 1 只做同步凭据检查（PAT/env/配置文件），spawn 型登录探测（`qodercli status`）延后到 phase 2 异步补推事件；`buildAvailableEngines` 统一产出 `requires-login`，菜单显示「需登录」（i18n key 已存在）。
- **B7 联动同源**：atomic 模型下拉分组可用性改读 `availabilityState`（经 app-shell host bus catalog slice 字段级订阅，不进根链）；检测状态翻转（installed/auth 变化）通过统一事件通道同时失效菜单与下拉两侧缓存；供应商 CRUD 失效事件补齐 engineController 侧投影失效；切会话路径零 catalog IPC 红线保持不变。

## Capabilities

### Added Capabilities

- `engine-detection-pipeline`：引擎检测流水线契约——metadata-only 轻量检测、TTL 缓存 + per-engine 刷新、逐引擎事件、冷启动 last-good SWR、failed 态、环境解析缓存、登录态二段式、菜单与模型下拉可用性同源。

### Modified Capabilities

- `provider-model-catalog-refresh`：MODIFIED requirement「On-Demand Catalog Timeout MUST Cover Backend Probe Chain」——detect 不再运行目录探测后，on-demand timeout 覆盖对象重锚定为 catalog 探测链（`get_engine_models` 各引擎回退链），删除已失效的 `detect_pi_status` 内并行探测场景。

## Non-Goals

- **不动 `get_engine_models` 的 cache-first 语义**：在途 change `cache-first-engine-model-catalog` 正在实施该域，本 change 仅保证 detect 与其解耦，不触碰其函数体。
- **不动 ModelSelect 的提交 / authority / overlay 逻辑**：`fix-model-picker-send-authority` 管辖；B7 只改分组可用性投影（`useProviderTargetCatalogOwners` groups 投影），不改 picker 提交写 resolver 的边界。
- **不做切会话触发的 catalog 对齐**：Session Switch Catalog Fetch Gate 红线保持——联动一律走「事件 + 共享状态源」，切会话路径零 catalog IPC。
- **不引入引擎状态轮询 / 文件系统 watch**：CLI 安装状态的外部变化（绕过客户端卸载/安装）靠「重启 SWR + 打开菜单时 TTL 外后台重验 + 显式刷新」三个入口覆盖，不做秒级轮询（渲染红线）与 fs watch（nvm/npm/自定路径下监听点不可靠）；「send 时 spawn 失败自动翻转菜单状态」涉及 send 主路径（`unify-engine-send-core` 在途），列为后续 change。
- **不把 engine 状态上移为新全局 store / 不重写 `useSidebarMenus`**：CatalogHost 已是单实例 owner，`engineDetectionCoordinator` + 事件 + TTL 已解决重复检测与滞后；大迁移会触碰多人常改文件，违反最小触碰原则。
- **不拆分 per-engine 独立 Tauri command**：用 `detect_engines` 可选参数扩展，保持 `cli-execution-backend-parity` 的 daemon 对齐面最小。
- **不改 Codex metadata-only、PI catalog probe 预算等既有契约**（`engine-environment-doctor` / `provider-model-catalog-refresh` 既有 requirement 原样保持）。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend（`src-tauri/src/engine/`） | `status.rs`（各 `detect_*_status` 去 models 慢链、`detect_all_engines` 逐引擎 emit）、`manager.rs`（TTL 缓存 + `DetectOptions` + SWR + last-good 落盘 + 后台 revalidate 单飞）、`commands.rs`（`detect_engines` 参数扩展，仅此 command 签名，不碰 `get_engine_models`）、`backend/app_server_cli.rs`（搜索路径 / login shell 缓存） |
| Frontend services | `src/services/tauri/appServer.ts`（`detectEngines` 参数 + 事件订阅 `listenEngineStatusEvents` + 25s 超时守卫） |
| Frontend engine | `useEngineController.ts`（事件 merge、failed 态、coordinator 接入、单引擎刷新）、`engineControllerAvailability.ts`（failed / requires-login 态）、新增 `engineDetectionCoordinator.ts` |
| Frontend 消费面 | `useFirstRunSetup.ts` / `useProjectMapGenerationOptions.ts`（改走 coordinator）、`useSidebarMenus.ts`（failed/requires-login 标签 + 单引擎刷新走 per-engine，仅动 resolveEngineActionMeta 相邻 hunk）、`useProviderTargetCatalogOwners.ts`（分组可用性投影） |
| i18n | `workspace.engineStatusFailed` 等 key × 全部 locale 文件（`engineStatusRequiresLogin` 已存在复用） |
| 性能收益 | 全新环境首次检测：逐项 reveal（codex 等 ≤1s 亮起），最慢单引擎 ≤10s（version 上界）且不再拖累其他项（原 Qoder 55s 全局绑架）；冷启动（有 last-good）：菜单状态即时呈现、0 spawn 等待；菜单单引擎刷新：1 引擎子进程链（原 9 引擎全量）；`npm config get prefix`：每进程 ≤1 次（原每轮 ~18 次）；「永久检测中」根除 |
| 风险 | B1 改变「detect 返回完整 models」的既有行为（FE 有 `get_engine_models` 权威路径兜底，`refreshEngines` 已先 set 后 load）；B3 SWR 短暂展示过期状态（卸载 CLI 后 last-good 仍 installed，后台 revalidate ≤15s 修正，send 路径本有运行时错误兜底）；B4 新事件通道需防窗口多实例重复订阅；B6 `EngineStatus` 加字段需与 daemon/remote 对齐（serde default 双侧同版本发布）；B7 触及多人常改文件，遵守 Format Discipline 只动本次 hunk |

## Acceptance

- **A1（B1）**：rust 测试断言 detect 链不再 spawn Qoder ACP / OpenCode `models` / PI RPC models 探测（probe 注入或 spawn 计数）；`EngineStatus.models` 仅含便宜来源；**黑名单引擎（`disabledCliEngines`）0 spawn 且不出现在返回结果**；**单引擎探测 panic/超时只落该引擎 error，其余引擎结果不受影响**。
- **A2（B2）**：spawn 计数测试断言 `npm config get prefix` 每进程 ≤1 次、login shell 解析每进程 ≤1 次、Claude 同轮 `--version` ≤1 次。
- **A3（B3）**：TTL 内二次 `detect_engines` 0 spawn；`force: true` 全量重探；`engines: [X]` 仅探 X；重探失败保留该引擎 last-good 且带 error；last-good 落盘 → 重启加载 → SWR 立即返回 + 后台 revalidate 单飞。
- **A4（B4）**：每引擎完成即 emit；前端 merge 逐项更新（hook 测试断言逐项 setEngineStatuses 合并而非整体替换）；旧 `detectRunId` 事件被丢弃。
- **A5（B5）**：detect 失败/25s 超时后 `isInitialized=true` + `failed` 展示 + 重试成功恢复；三入口并发调用仅一次 IPC（coordinator 测试）；菜单单引擎刷新只触发 per-engine force detect；**手动刷新入口全部保留且 force 绕过缓存**；打开菜单 fire-and-forget detect 不阻塞渲染；外部卸载 CLI 后打开菜单秒级翻转为未安装（rust 端 ENOENT 快速失败测试）。
- **A6（B6）**：Qoder phase 1 不 spawn `status` 命令；phase 2 异步 emit `auth_state`；`buildAvailableEngines` 对 `requires_login` 产出 requires-login，菜单显示「需登录」。
- **A7（B7）**：atomic 分组态随 `availabilityState`（detecting 灰态 / unavailable disabled / failed 重试）；installed 翻转触发统一失效事件且两侧同时刷新；`useProviderModelCatalogSync` 既有「切会话零 catalog IPC」断言保持绿。
- **A8（回归）**：既有测试面全绿（useEngineController / useSidebarMenus / engine availability / cargo engine tests / cache-first catalog 测试）；`npm run typecheck` 0 error；改过的 `.rs` 过 `rustfmt --check`；`openspec validate --strict` 过；每批 `git diff --stat` 无格式化噪音。
- **A9（量化验收，真机）**：全新环境打开菜单，纯文件探测引擎 ≤1s 亮起、全部引擎 ≤15s 完成且逐项呈现；有 last-good 冷启动菜单状态 ≤1s 可读；「检测中」项数量随完成单调递减（不再 9 项同时卡满最慢链）。
