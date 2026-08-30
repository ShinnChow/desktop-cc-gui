# Delta: engine-detection-pipeline

## ADDED Requirements

### Requirement: Engine Detection MUST Be Metadata-Lightweight And Decoupled From Model Catalog Probing

启动/后台引擎检测（`detect_engines`）MUST 只回答「是否安装、版本、登录态」，MUST NOT 在检测链内运行模型目录探测——Qoder ACP 握手（`--acp` + `session/new`）、OpenCode `opencode models`、PI RPC models 回退链、以及任何 spawn 型登录探测 MUST 全部移出 detect，只保留在按需的 `get_engine_models` 路径。`EngineStatus.models` 字段 MUST 保留且仅填便宜来源（静态 generated catalog / 配置文件读取），其语义是「可能有值的快照」而非权威目录；权威模型目录唯一来源是 `get_engine_models`。本 requirement 将 `engine-environment-doctor` 的 Codex metadata-only 先例推广到全部引擎。

#### Scenario: Qoder detection does not run ACP handshake

- **WHEN** backend 执行 Qoder 引擎检测
- **THEN** 检测链 MUST NOT 发起 `--acp` 握手或 `session/new` 探测
- **AND** `installed` / `version` 语义与裁剪前一致
- **AND** Qoder 权威模型目录仍可经 `get_engine_models` 的 ACP 路径获取

#### Scenario: OpenCode and PI detection do not spawn model listing

- **WHEN** backend 执行 OpenCode 或 PI 引擎检测
- **THEN** 检测链 MUST NOT spawn `opencode models` 或 PI RPC models 回退链
- **AND** 两条链在 `get_engine_models` 按需路径中保持既有行为与预算（`provider-model-catalog-refresh` 既有 requirement 不变）

#### Scenario: detection worst-case is bounded by version probing

- **WHEN** 全部 CLI 已安装且单个 CLI 挂死
- **THEN** 任一引擎 detect 链最坏耗时 MUST 以单次版本探测预算（10s）与其 help 回退为上界
- **AND** 单个引擎的慢探测 MUST NOT 延长其他引擎的检测完成时间

### Requirement: Detection MUST Be Scoped To Engines Enabled In Vendor Settings

检测探测集合 MUST 由供应商页面引擎开关（`AppSettings.disabledCliEngines` 黑名单）推导：黑名单内引擎 MUST NOT 进入检测环节（0 spawn、不出现在 `detect_engines` 返回结果中）；Gemini 既有运行时 gate（`gemini_enabled` + `GEMINI_RUNTIME_ENABLED`）MUST 保留为额外排除条件。`disabledCliEngines` 变化时 MUST 使检测缓存失效，下一轮检测 MUST 按新集合执行；active-engine fallback MUST NOT 自动选中被禁用引擎；last-good 落盘读取 MUST 按当前黑名单过滤。

#### Scenario: disabled engine is never probed

- **WHEN** 用户在供应商页面关闭某引擎后触发检测
- **THEN** 该引擎 MUST NOT 产生任何探测子进程
- **AND** 该引擎 MUST NOT 出现在返回结果中
- **AND** 其余开启引擎的检测 MUST 不受影响

#### Scenario: toggle change takes effect on next detection

- **WHEN** 设置保存导致 `disabledCliEngines` 变化
- **THEN** 检测缓存 MUST 失效
- **AND** 随后一次检测（由设置保存这一显式动作触发）MUST 按新集合执行
- **AND** 新近禁用的引擎状态 MUST NOT 经 last-good 回灌到菜单/下拉

#### Scenario: disabling the active engine falls back safely

- **WHEN** 用户禁用当前 active 引擎
- **THEN** 该引擎 MUST 被视为不可用且不再对其探测
- **AND** active 引擎 MUST fallback 到第一个开启且已安装的引擎
- **AND** fallback MUST NOT 自动选中任何被禁用引擎

### Requirement: Engine Detection Failures MUST Be Isolated Per Engine

引擎检测 MUST 逐引擎隔离执行：单引擎探测的 error / 超时 / panic MUST 只落该引擎的 `EngineStatus.error`，MUST NOT 影响其他引擎的探测执行、返回结果、缓存写入、last-good 与事件推送（探测层铁律；现状单层 `tokio::join!` 下任一 future panic 会丢失全部引擎结果，MUST 修复）。缓存 MUST 按引擎粒度独立写入与保留；单引擎失败 MUST NOT 触发整体缓存清除。前端 `failed` 全局态仅用于传输层失败（invoke reject / 通道超时）；单引擎探测失败 MUST 只影响该引擎条目的展示与重试。传输层失败（通道问题）不视为引擎间影响。

#### Scenario: one engine's panic does not lose other engines' results

- **WHEN** 注入某引擎探测必 panic（或必超时）的故障
- **THEN** 该引擎 MUST 落为带 error 的状态
- **AND** 其余引擎的探测结果、缓存写入与事件 MUST 完整不受影响

#### Scenario: single-engine failure only affects its own UI entry

- **WHEN** 某引擎探测返回 error（如 CLI 损坏）
- **THEN** 菜单与模型下拉中仅该引擎条目呈现错误态并可单独重试
- **AND** 其他引擎条目保持各自状态
- **AND** 该引擎的失败 MUST NOT 清除任何其他引擎的缓存或 last-good

### Requirement: Detection Results MUST Be Cached With TTL And Support Force And Per-Engine Refresh

`detect_engines` MUST 默认 cache-first：缓存自上次完整检测起算 TTL（60s）内直接返回缓存且 0 spawn；MUST 支持可选参数 `force: bool`（全量强刷）与 `engines: Option<Vec<EngineType>>`（仅探测指定引擎并与缓存 merge）。**用户手动发起的刷新（菜单每引擎刷新按钮、设置页检测、向导重测等既有入口）是必须保留的能力：入口 MUST 全部保留，且手动刷新 MUST 以 force 语义执行、MUST NOT 返回未刷新的缓存，刷新期间 MUST 呈现进行中反馈。**per-engine 重探失败（error 或 installed 翻转）时 MUST 保留该引擎旧缓存值并合入 error 标注，MUST NOT 让一次失败结果整体覆盖缓存；仅探测成功才覆写。

#### Scenario: manual refresh always bypasses cache

- **WHEN** 用户手动发起刷新（单引擎按钮或全局入口）
- **THEN** 请求 MUST 以 force 语义执行并真实重探目标引擎
- **AND** 刷新期间 UI MUST 呈现进行中反馈（loading/spinner），完成后呈现新结果
- **AND** 既有手动刷新入口数量与可达性 MUST 不因本 change 减少

#### Scenario: repeated detection within TTL spawns nothing

- **WHEN** TTL 内第二次调用 `detect_engines`（无 force）
- **THEN** 后端 MUST NOT spawn 任何 CLI 子进程
- **AND** 返回结果与缓存一致

#### Scenario: per-engine refresh probes only the target engine

- **WHEN** 以 `engines = [X], force = true` 调用 `detect_engines`
- **THEN** 后端 MUST 仅探测引擎 X（单引擎子进程链）
- **AND** 返回结果 = X 的新探测结果与其余引擎缓存 merge

#### Scenario: failed re-probe preserves last-good per engine

- **WHEN** 引擎 X 重探失败（探测 error 或 installed 状态翻转异常）
- **THEN** 缓存中 X 的旧可用状态 MUST 保留
- **AND** 新 error 信息 MUST 合入标注
- **AND** 其余引擎缓存不受影响

### Requirement: Detection MUST Push Per-Engine Progress Events

检测 MUST 通过 Tauri 事件 `ccgui:engine-status-updated`（payload `{ detectRunId, status: EngineStatus }`）在**每个引擎**探测完成时立即推送，MUST NOT 等待全部引擎完成后一次性返回才可见；`detectRunId` MUST 由后端单调递增。前端 MUST 订阅该事件逐引擎 merge 状态，MUST 丢弃 `detectRunId` 小于已应用值的迟到事件；merge MUST 为按 engineType 的条目级更新，MUST NOT 整体替换 `engineStatuses`。事件频率为每引擎每轮 1 次，状态发布 MUST 走既有 CatalogHost slice + host bus 字段级订阅，MUST NOT 新增根 hook 链高频 setState 或轮询（Render Perf Baseline）。

#### Scenario: engines reveal progressively during one detection run

- **WHEN** 一次 detect 运行中某引擎（如纯文件探测的 Codex）率先完成
- **THEN** 该引擎的菜单状态 MUST 在事件到达后立即从「检测中」翻转
- **AND** 其余仍在探测的引擎 MUST 保持「检测中」且互不阻塞

#### Scenario: late events from an older run are dropped

- **WHEN** 前端已应用 `detectRunId = N` 的事件后又收到 `detectRunId = M < N` 的事件
- **THEN** 该迟到事件 MUST 被丢弃，MUST NOT 覆盖新 run 的结果

### Requirement: Cold Start MUST Serve Persisted Last-Good Then Revalidate

每次探测成功 merge 后 MUST 将 per-engine 结果（含 `detected_at`）落盘到 app 数据目录（缓存文件，非用户存储改写）；冷启动时 `detect_engines` MUST 立即返回落盘的 last-good（stale-while-revalidate），同时后台单飞 revalidate 并逐引擎 emit 事件刷新。revalidate 触发面 MUST 包含：启动/coordinator 入口、**打开新建会话菜单且缓存已过 TTL 时（fire-and-forget，不阻塞菜单打开）**、显式刷新与引擎开关切换；MUST NOT 引入秒级轮询或文件系统 watch。落盘读取 MUST 容忍损坏/缺字段（视为无 last-good）；超过 7 天的条目 MUST 按「无该引擎 last-good」处理。后台 revalidate MUST 有单飞守卫（并发调用不重复 spawn）。

#### Scenario: warm start shows statuses immediately

- **WHEN** 应用冷启动且存在未过期的 last-good 落盘
- **THEN** 首次 `detect_engines` MUST 在无 CLI spawn 的前提下立即返回上次结果
- **AND** 新建会话菜单 MUST 即时呈现各引擎状态
- **AND** 后台 revalidate 完成后经事件逐项修正

#### Scenario: externally uninstalled CLI is caught without restart

- **WHEN** 用户绕过客户端本地卸载某 CLI 后打开新建会话菜单（缓存已过 TTL）
- **THEN** 后台 revalidate MUST 自动触发且 MUST NOT 阻塞菜单弹出
- **AND** 该引擎探测因二进制缺失 spawn 立即失败，MUST NOT 产生满额超时等待
- **AND** 菜单该项 MUST 在探测返回后翻转为「未安装」并回写 last-good

#### Scenario: stale entry beyond retention is ignored

- **WHEN** 某引擎 last-good 条目年龄超过 7 天或落盘文件损坏
- **THEN** 该引擎 MUST 按「无 last-good」走同步探测路径
- **AND** 损坏文件 MUST NOT 导致 detect 失败

### Requirement: Detection Failure MUST Surface A Failed State With Retry, Never A Permanent Detecting State

可用性状态机 MUST 包含 `failed` 态；`detect_engines` 失败或前端超时守卫（25s，覆盖裁剪后最坏探测链）触发时，前端 MUST 置位 `isInitialized` 并呈现 `failed`（statusLabel「检测失败」+ 可重试），MUST NOT 停留在 `loading`（「检测中...」不得永久停留）。晚到的真实结果（事件或迟返 invoke）MUST 将 failed 恢复为 ready。超时守卫 MUST NOT 中止后端探测（Tauri invoke 无 abort，后端跑完经事件收货）。

#### Scenario: invoke failure shows failed with retry

- **WHEN** `detect_engines` invoke reject 或超过 25s 前端守卫
- **THEN** `isInitialized` MUST 置位且各引擎呈现 `failed`
- **AND** 重试入口 MUST 触发 per-engine force detect
- **AND** 后续真实结果到达 MUST 恢复 ready

### Requirement: Shared Environment Resolution MUST Be Cached Process-Wide

`npm config get prefix` 搜索路径构建与 `$SHELL -lic` 登录 shell 解析（阻塞 spawn）MUST 做进程级缓存（短 TTL，30s）；「本轮 detect 全部引擎 not_installed」时 MUST 主动失效缓存重试一轮（覆盖用户刚装好 CLI 的场景）。同一轮检测内 Claude 的版本探测 MUST ≤1 次（候选验证复用二进制定位结果）。缓存 MUST NOT 改变这些函数的既有执行模型与返回语义。

#### Scenario: npm prefix is spawned at most once per TTL window

- **WHEN** TTL 窗口内多次引擎检测触发 `build_search_paths`
- **THEN** `npm config get prefix` 子进程 MUST ≤1 次
- **AND** 缓存失效后（到期或全引擎 not_installed 重试）允许再次 spawn

#### Scenario: claude version is probed once per detection round

- **WHEN** 一轮 detect 执行 Claude 检测
- **THEN** `claude --version`（含候选验证与最终探测）MUST ≤1 次

### Requirement: Login State MUST Be Resolved In Two Phases Without Blocking Detection

`EngineStatus` MUST 新增 `auth_state`（serde default，向后兼容 daemon/remote 与历史落盘）。检测 phase 1 MUST 只做同步凭据存在性检查（PAT/env/配置文件），MUST NOT spawn 登录探测命令；spawn 型登录探测（如 `qodercli status -o json`）MUST 延后到 phase 2（detect 返回后异步执行），完成后覆写缓存并 emit 事件。可用性投影 MUST 对 `auth_state = requires_login` 产出 `requires-login` 态；`unknown` MUST 保持与现状一致的行为。

#### Scenario: qoder phase 1 does not spawn login probe

- **WHEN** backend 执行 Qoder 检测 phase 1
- **THEN** 检测链 MUST NOT spawn `qodercli status` 命令
- **AND** `auth_state` 由凭据同步检查直接产出或为 `unknown`

#### Scenario: phase 2 login probe updates via event

- **WHEN** phase 2 异步登录探测完成且结果为未登录
- **THEN** 缓存 MUST 被覆写为 `requires_login` 并 emit 事件
- **AND** 菜单该引擎 MUST 显示「需登录」而非「未安装」

### Requirement: Engine Availability MUST Be Single-Sourced Across New-Session Menu And Model Picker

新建会话菜单与 composer 模型下拉（atomic picker）的引擎可用性 MUST 同源于同一份 `availabilityState`（detect 快照投影）；atomic 分组可用性 MUST NOT 硬编码 `enabled: true`。分组态映射：`loading` → 「检测中」disabled；`failed` → 「检测失败」disabled + 组级重试；`unavailable` → disabled + 「未安装」（与 `disabledCliEngineIds` 取交集）；`requires-login` → 可选但标注「需登录」；`ready` → 现状。数据通路 MUST 走 host bus catalog slice 字段级订阅，MUST NOT 新增根链订阅面。本 requirement MUST NOT 触碰模型选择器的提交 / resolver / override 边界（`fix-model-picker-send-authority` 管辖）。

#### Scenario: picker groups reflect detection states

- **WHEN** 菜单某引擎显示「检测中」或「未安装」
- **THEN** 模型下拉该引擎分组 MUST 呈现一致的检测中/未安装 disabled 态
- **AND** 两边状态来源 MUST 是同一份 availabilityState 投影

#### Scenario: picker submit authority is untouched

- **WHEN** 用户在分组态变化的下拉中选择模型并提交
- **THEN** picker 提交 / resolver / override 语义 MUST 与本 change 之前一致

### Requirement: Engine Status Flips MUST Invalidate Both Surfaces Through One Unified Channel

检测 merge 发现 `installed` 或 `auth_state` 翻转时，MUST 通过统一事件通道（既有 `PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT` + controller 侧 idle-prewarm 重算）同时失效新建会话菜单与模型下拉两侧的派生缓存；供应商 CRUD 失效事件 MUST 同步清除 controller 侧 per-scope last-good models 缓存。上述失效 MUST 全部挂在「detect 完成事件」与「CRUD 事件」上，MUST NOT 挂在会话切换路径（Session Switch Catalog Fetch Gate：切会话零 catalog IPC 保持）。

#### Scenario: install flip refreshes both surfaces

- **WHEN** 某引擎从 not_installed 翻转为 installed（用户后台安装了 CLI）
- **THEN** 菜单与模型下拉两侧 MUST 在同一失效通道下同时刷新
- **AND** 刷新请求 MUST NOT 由会话切换触发

#### Scenario: session switch red line remains intact

- **WHEN** 用户切换会话
- **THEN** 切会话路径 MUST 保持零 catalog IPC（`useProviderModelCatalogSync` no-op 现状与既有断言不变）
