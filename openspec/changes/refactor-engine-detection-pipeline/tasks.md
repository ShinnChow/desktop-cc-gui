# Tasks: refactor-engine-detection-pipeline

按批次 TDD（先红后绿），每批次结束跑验证并独立 commit（中文 Conventional Commits），供按批次 review。红测试必须先在现实现上跑出失败。**不触碰 design.md「不触碰清单」内的文件与管辖域。**

## Batch 1 检测轻量化——解耦 + 启用范围 + 引擎间隔离（后端）

- [x] 1.1 红测试（rust，`src-tauri/src/engine/status.rs` tests 或 `src-tauri/tests/`）：Qoder detect 断言——`detect_qoder_distribution_status` 不再发起 ACP 握手 / `session/new`（注入 probe 或 spawn 计数为 0），返回的 `models` 仅含便宜来源且 `installed/version` 语义不变。现实现下红。
- [x] 1.2 红测试（rust）：OpenCode detect 断言——不再 spawn `opencode models`（`OPENCODE_MODELS_TIMEOUT` 链移出 detect），models 快照为空/静态；PI detect 断言——`detect_pi_status` 不再运行 RPC models 链（`get_pi_models` 不被 detect 调用），version 语义不变；`get_pi_models` 本体及其测试零改动（`cache-first-engine-model-catalog` 管辖域不触碰）。现实现下红。
- [x] 1.3 红测试（rust，启用范围铁律）：`disabledCliEngines` 黑名单引擎 0 spawn 且不出现在 `detect_engines` 返回结果；其余开启引擎照常探测；黑名单变化使 TTL 缓存失效、下一轮按新集合执行；active fallback 不选中被禁用引擎；**当前 active 引擎被禁用时 fallback 到第一个开启且已安装的引擎**。现实现下红。
- [x] 1.4 红测试（rust，隔离铁律）：注入某引擎探测必 panic / 必超时的 fake probe——该引擎落带 error 状态，其余引擎探测结果、缓存写入、事件 emit 完整不受影响。现实现下红（现 `tokio::join!` 一炸全丢）。
- [x] 1.5 实现：裁剪 `detect_qoder_distribution_status` / `detect_opencode_status_with_options` / `detect_pi_status`；`EngineStatus.models` 字段保留、只填便宜来源（静态 generated catalog / 配置文件）；探测集合按 `settings.disabled_cli_engines` 过滤（Gemini gate 保留）、黑名单变化清 TTL 缓存；`detect_all_engines` / `detect_preferred_engine` 改 per-engine `tokio::spawn`（owned 参数，JoinError 落该引擎 error）；`detect_preferred_engine` 自动受益。
- [x] 1.6 回归：`cargo test` engine 面（含 `cache-first-engine-model-catalog` 的 catalog 测试、`types.rs` 黑名单往返测试）全绿；`rustfmt --edition 2021 --check` 过（仅本次改动文件）；commit `perf(engine): 检测轻量化——移除慢目录探测、启用范围过滤、per-engine 隔离`。

## Batch 2 环境解析缓存（后端，独立可先行 review）

- [x] 2.1 红测试（rust，`src-tauri/src/backend/app_server_cli.rs` tests）：spawn 计数断言——`npm config get prefix` 每进程 ≤1 次（30s TTL 内多次 `build_search_paths` 仅 1 spawn）；`resolve_claude_via_login_shell` 同款 ≤1 次；「本轮 detect 全引擎 not_installed」时缓存失效重试。现实现下红。
- [x] 2.2 红测试（rust）：`detect_claude_status` 同一轮内 `claude --version` spawn ≤1 次（候选验证复用 find 结果）。现实现下红。
- [x] 2.3 实现：`build_search_paths` / login shell 解析加 `RwLock<Option<(T, Instant)>>` TTL 缓存（30s）+ 全失败失效条件；Claude version 去重。不改执行模型（design D4）。
- [x] 2.4 验证：`cargo test` 相关面全绿；rustfmt check；commit `perf(engine): npm prefix/login-shell 搜索路径进程级缓存，消除每轮 ~18 次冗余 spawn`。

## Batch 3 检测缓存 + per-engine + last-good SWR（后端）

- [x] 3.1 红测试（rust，manager 层）：TTL 内二次 `detect_engines` spawn 计数为 0 且返回缓存；`force=true` 全量重探；`engines=Some([X])` 仅探 X 并与缓存 merge。现实现下红。
- [x] 3.2 红测试（rust）：last-good 落盘——探测成功后写 `engine-status-last-good.json`；损坏/缺字段/超 7 天按无 last-good 处理；重启（新 manager 实例）加载后 `detect_engines` 立即返回 stale 结果且后台 revalidate 单飞（并发第二次调用不重复 spawn）、完成后覆写缓存 + 重写落盘。现实现下红。
- [x] 3.3 红测试（rust）：per-engine 防中毒——重探单引擎失败（error/翻转）时保留该引擎旧缓存值并合入 error 标注；探测成功才覆写。现实现下红。
- [x] 3.4 实现：`engine_statuses` 值升级 `{ status, detected_at_ms }` + `last_full_detect_at_ms`；`DetectOptions { force, engines }`（serde default）；SWR：有 last-good 先返回 stale + 后台单飞 revalidate（`detect_revalidate_inflight`）；`commands.rs` 仅扩 `detect_engines` 签名（不碰 `get_engine_models` 函数体）；remote/daemon 双侧同步。
- [x] 3.5 验证：`cargo test` engine 面全绿；rustfmt check；commit `feat(engine): 检测结果 TTL 缓存 + per-engine 强刷 + last-good 落盘 stale-while-revalidate`。

## Batch 4 逐引擎事件推送 + 前端逐项 reveal（跨端）

- [x] 4.1 红测试（rust）：`detect_all_engines` 每路完成后 emit `ccgui:engine-status-updated`（payload `{ detectRunId, status }`），`detectRunId` 单调递增；SWR revalidate 路径同样逐引擎 emit。现实现下红。
- [x] 4.2 红测试（vitest，`appServer` / `useEngineController.test.tsx`）：前端订阅事件并 merge——单引擎事件只更新对应 engineStatuses 条目（逐项 set，非整体替换）；`detectRunId` 小于已应用值的事件被丢弃；事件 merge 后 `engineOptions` 逐项从 loading 翻转。现实现下红。
- [x] 4.3 实现：后端 `tokio::join!` 各路 wrap `.then(emit)`（保持并行）；`appServer.ts` 新增 `listenEngineStatusEvents`；controller 订阅 + `lastAppliedDetectRunId` 守卫 + merge；订阅去重（多窗口/多实例单监听）。
- [x] 4.4 验证：cargo + vitest 相关面全绿；typecheck；commit `feat(engine): 逐引擎检测事件推送，菜单逐项 reveal 不再全量等待`。

## Batch 5 前端 failed 态 + 25s 超时 + coordinator（前端）

- [x] 5.1 红测试（vitest，`engineControllerAvailability.test.ts`）：`failed` 态投影——`isInitialized && detectFailed` → failed（非 loading）；`useEngineController.test.tsx`：detect reject / 25s 超时后 `isInitialized=true + detectFailed=true`，晚到的正常返回/事件恢复 ready；「检测中」不再永久停留。现实现下红。
- [x] 5.2 红测试（vitest，新增 `engineDetectionCoordinator.test.ts`）：三入口（mount / 首启向导 / project-map）并发调用仅一次底层 IPC；`setActiveEngine` 兜底重测并入单飞。现实现下红。
- [x] 5.3 红测试（vitest，`useSidebarMenus.test.tsx`）：菜单单引擎刷新仅触发 `engines=[X]` 的 detect 且带 force 语义（断言 invoke 参数，绕过缓存），不全量；既有手动刷新入口全部保留；failed 项显示「检测失败」且可点击重试。现实现下红。
- [x] 5.4 实现：`appServer.ts` detect 25s 守卫；`engineDetectionCoordinator.ts`（模块级单飞）；controller/`useFirstRunSetup`/`useProjectMapGenerationOptions` 接入；`engineControllerAvailability` failed 分支 + `useSidebarMenus.resolveEngineActionMeta` failed 标签（只动相邻 hunk）；i18n `workspace.engineStatusFailed` × 全部 locale。
- [x] 5.5 红测试（vitest，`useSidebarMenus.test.tsx`）：打开新建会话菜单 fire-and-forget 发起一次 detect（由后端缓存裁决：fresh 即时返回 0 spawn / stale 走 SWR，前端不自行判断 TTL），不阻塞菜单渲染。现实现下红。
- [x] 5.6 实现：菜单打开钩子接入 coordinator 的 fire-and-forget detect（后端缓存裁决 fresh/stale，事件驱动翻转）。
- [x] 5.7 验证：vitest 相关面全绿（含 useSidebarMenus 既有用例）；typecheck；`git diff --stat` 自查无噪音；commit `fix(engine): 检测失败态 + 超时守卫 + 跨模块检测单飞，根除永久「检测中」`。

## Batch 6 登录态二段式（跨端）

- [x] 6.1 红测试（rust）：phase 1——Qoder detect 不 spawn `qodercli status`（spawn 计数 0），`auth_state` 仅由凭据同步检查产出；phase 2——detect 返回后异步探测完成时覆写缓存并 emit `auth_state=requires_login/authenticated`。现实现下红。
- [x] 6.2 红测试（vitest）：`EngineStatus.auth_state` 反序列化 default `unknown`（旧 payload 兼容）；`buildAvailableEngines` 对 `requires_login` 产出 `requires-login` 态；菜单显示「需登录」（`workspace.engineStatusRequiresLogin` 复用）。现实现下红。
- [x] 6.3 实现：`AuthState` 枚举（serde default）；Qoder phase1/phase2 拆分；`engineControllerAvailability` requires-login 分支；opencode 既有登录路径不动。
- [x] 6.4 验证：cargo + vitest 全绿；typecheck；rustfmt check；commit `feat(engine): 登录态二段式——detect 不等 spawn 探测，异步补推 requires-login`。

## Batch 7 联动同源——菜单 ⇄ 模型下拉（前端）

- [x] 7.1 前置：对齐在途 change 边界——重读 `fix-model-picker-send-authority` spec 确认 picker 提交/authority 边界；重读 `cache-first-engine-model-catalog` 确认 catalog 缓存语义；本批只动分组可用性投影与失效事件，冲突即停。
- [x] 7.2 红测试（vitest，新增 `useEngineAvailabilityProjection.test.ts`）：经 host bus 字段订阅 catalog.engineOptions 产出 `Record<EngineType, AvailabilityState>`；bus 更新不引发无关域重渲染（字段级订阅断言）。现实现下红。
- [x] 7.3 红测试（vitest，`useProviderTargetCatalogOwners.test.tsx`）：分组态映射——loading/failed/unavailable/requires-login/ready 五态投影；`disabledCliEngineIds` 交集语义；picker 提交/resolver/override 相关既有断言全部保持。现实现下红。
- [x] 7.4 红测试（vitest）：状态翻转联动——detect merge 发现 `installed`/`auth_state` 翻转时 dispatch `PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT` 且 controller 侧以 idle-prewarm phase 重算（非切会话路径断言）；供应商 CRUD 事件清除 `lastGoodModelsByScopeRef` 对应 scope。现实现下红。
- [x] 7.5 红测试（回归锚点）：`useProviderModelCatalogSync.test.tsx` 既有「切会话零 catalog IPC」断言在本批改动后保持绿（先跑一遍确认现基线）。
- [x] 7.6 实现：`useEngineAvailabilityProjection` + groups 投影接入 + 双向失效通道（design D7）；`useProviderTargetCatalogOwners.ts` 只动 groups 投影 hunk。
- [x] 7.7 验证：vitest 相关面全绿（含 ModelSelect 提交/authority 既有测试零回归）；typecheck；`npm run check:app-shell:governance`；commit `feat(engine): 模型下拉与新会话菜单可用性同源，状态翻转统一失效两侧`。

## 收口

- [ ] 8.1 真机量化验收（A9）：全新环境（清 last-good）与有 last-good 两种场景打开「新建会话」菜单，核对逐项 reveal、codex 等 ≤1s 亮起、全部 ≤15s、「检测中」单调递减；菜单单引擎刷新只起 1 引擎子进程；结果记录到本 tasks。
- [ ] 8.2 Engine Onboarding Gate：按 `docs/research/mossx-new-cli-onboarding-guide.md` §0 核对矩阵逐层勾选（⚠ 静默失败点全人工核对）；PR 描述附矩阵完成度 + 渲染目视验收结果 + CI gate（typecheck / cargo test / vitest 相关面 / check:app-shell:governance / openspec validate strict）。
- [x] 8.3 `openspec validate refactor-engine-detection-pipeline --strict --no-interactive` 通过；`openspec/changes/README.md` 进度状态更新。
- [ ] 8.4 ADR 校准回写：刷新 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`「最近校准」标注与「零、当前实现校准」表检测流水线行（事实源 = 本 change id + `status.rs` / `manager.rs` / `engineDetectionCoordinator.ts`），未回写不得标记收口 / archive。
- [ ] 8.5 全批次 `git log` review：每批独立 commit、diff 限于本 change hunk、无全文件重排、未触碰「不触碰清单」。
