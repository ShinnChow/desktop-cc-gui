# add-omp-engine — Tasks

> 实施顺序 = §0 矩阵 A → B → C → D → E → G → H（F = 显式不进，决策记录于 proposal/design）。

## 1. Phase S（已完成）

- [x] 1.1 Capability Spike 落档 `docs/research/mossx-omp-capability-spike.md`（omp v18.0.11 实测）

## 2. A 层：Identity

- [x] 2.1 `src/types/engine.ts` EngineType union + `"omp"`
- [x] 2.2 `src/features/engine/engineIds.json` + omp entry（adapterId `builtin.omp`，protocolFamily `pi-rpc`，executionModel `persistent`）
- [x] 2.3 `src/features/engine/engineRegistry.ts` BUILTIN_ENGINE_REGISTRY + omp
- [x] 2.4 `src-tauri/src/engine/mod.rs` EngineType::Omp + display_name/icon/enabled/EngineFeatures::omp + ALL_ENGINES + pub mod omp_provider_profile
- [x] 2.5 `src-tauri/src/bin/cc_gui_daemon/engine_bridge.rs` 平行枚举 + matches + payload struct 对齐核对
- [x] 2.6 `src-tauri/src/engine/adapter_registry.rs` with_builtins + engine_id + PiRpc/Persistent 路由 + 既有断言扩展
- [x] 2.7 pi-family identity spec（PiFamilySpec + EngineType::pi_family_spec）落地

## 3. B 层：Rust Runtime

- [x] 3.1 pi-family 参数化：`get_pi_home_dir` / `resolve_pi_sessions_root` / `find_cli_binary("pi")` / PiSession.engine / gates 前缀 / events EngineType::Pi 分支 / commands_send(s) "pi" 字符串
- [x] 3.2 `engine/status/omp.rs`：detect_omp_status（候选矩阵 env/~/.omp/bin/~/.bun/bin/%LOCALAPPDATA%\omp/~/.local/bin/PATH + version parse），复用 pi-family catalog 探测链
- [x] 3.3 `engine/omp_provider_profile.rs`：`__local_omp__` + runtime key
- [x] 3.4 manager.rs：omp_sessions 集合 + get_or_create/interrupt/drop + detect match + 启动预热（state.rs）
- [x] 3.5 commands.rs / commands_send.rs / commands_send_sync.rs / commands_pi_rpc.rs：Omp dispatch 臂（send/send_sync/interrupt/models + omp_compact/omp_get_session_stats）
- [x] 3.6 events.rs：Omp→"omp" envelope + compaction/agent_settled 分支扩展
- [x] 3.7 command_registry.rs：list/load/delete_omp_sessions + omp_get_session_stats + omp_compact + omp_doctor 注册 + re-export
- [x] 3.8 workspaces/commands.rs add_workspace match + ompBin 检测 gate
- [x] 3.9 session_management 系（types/catalog_projection/delete_core/session_delete_v2）+ omp 分支
- [x] 3.10 daemon：engine_bridge 枚举外 + daemon_state.rs 转发器 omp 臂（双路径同步）
- [x] 3.11 codex/installer.rs CliInstallEngine::Omp + codex/doctor.rs omp_doctor
- [x] 3.12 pi_rpc.rs get_available_thinking_levels Err 路径核对（omp Unknown command 不阻断）

## 4. C 层：Capability 治理

- [x] 4.1 matrix.json fixture + omp 行（按 Spike 实测填 15 key）
- [x] 4.2 check-engine-capability-matrix.mjs ENGINE_VARIANTS + omp → --write 重新生成双生成物
- [x] 4.3 check-engine-adapter-registry.mjs expectedBuiltins + "omp"
- [x] 4.4 check-model-provider-catalog.mjs：omp 决策记录（与 pi 同，不进双列表）
- [x] 4.5 scan-engine-name-branches.mjs 核对新增分支归治理

## 5. D 层：幕布渲染

- [x] 5.1 ompRealtimeAdapter + realtimeAdapterRegistry +omp
- [x] 5.2 piHistoryLoader/piHistoryParser 参数化 engine；ompHistoryLoader 薄封装；historyLoaderFactory + `omp:` 分支
- [x] 5.3 conversationCurtainContracts：ConversationEngine + NORMALIZED_EVENT_DICTIONARY
- [x] 5.4 TimelineRowRenderer streaming 白名单 + omp
- [x] 5.5 MessagesCore 白名单（working label / user-input / heartbeat / reasoning-run）+ omp
- [x] 5.6 useAppServerEvents / appServerEventExtractors：`omp/raw` + threadId 前缀推断 + engineHint
- [x] 5.7 presentationProfile pi heartbeat 分支 omp 同享；useMessagesRuntimeState pi 分支核对

## 6. E/G 层：Composer / Settings / Sidebar

- [x] 6.1 ChatInputBoxAdapter：engineToProvider / engineDisplayName / enabled/statusLabel/version maps + omp
- [x] 6.2 ChatInputBox/types.ts：ProviderId + AVAILABLE_PROVIDERS + omp；modelOptions/sessionLifecycleController local profile sentinel `__local_omp__`
- [x] 6.3 EngineIcon + omp 图标资产（omp.sh favicon mark）；model-select/icon.tsx；providerBrandIcon.ts
- [x] 6.4 engineImageInput.ts ENGINE_IMAGE_LABEL + omp；modelSelection.ts reasoning effort 分支
- [x] 6.5 VendorSettingsPanel + omp tab（CLI 检测/路径/doctor，无 auth editor）；CliCustomPathDialog CliCustomPathEngine + omp；cliEngineNav
- [x] 6.6 SettingsView doctor handler + resolveSessionEngine + session counts
- [x] 6.7 useSidebarMenus / Sidebar / ThreadList / TopbarSessionTabs + omp 条目与徽章（无 fork tree badge——omp 无 fork）
- [x] 6.8 SessionManagementSection + omp filter label / loader 分支；sessionManagementSectionUtils
- [x] 6.9 HomeChat getEngineLabel + PromptEnhancerDialog 同名函数；turnBadge / codexProviderLabel / sessionQuotaTargets / onboarding / quick-switcher / commit-message / sessionIndex service 的引擎枚举核对
- [x] 6.10 app-shell domains（selectedAgentSession/selectedComposerSession 等）引擎 union 核对

## 7. F 层：Shared（显式不进）

- [x] 7.1 双集合确认不含 omp；Shared picker omp disabled + reason 文案接线

## 8. H 层：i18n

- [x] 8.1 10 locale × workspace.ts `engineOmp` + providers.ts `"omp".label`
- [x] 8.2 settings.ts / sidebar.ts / runtimeNotice.ts 相关 omp key 补齐
- [x] 8.3 locale parity 测试全绿

## 9. 验收

- [x] 9.1 `pnpm check:engine-adapter-registry && pnpm check:engine-capability-matrix && pnpm check:model-provider-catalog && pnpm check:capability-aware-policy-router && pnpm check:engine-controller-facade`
- [x] 9.2 `cargo test`（engine 域）+ pi 既有套件零回归
- [x] 9.3 `pnpm vitest run src/features/threads/adapters/realtimeAdapters.test.ts src/features/threads/loaders src/features/shared-session/utils/sharedSessionEngines.test.ts`
- [x] 9.4 渲染层目视验收七项（真实 omp 会话）
- [x] 9.5 存量防回归清单（指南 §五）逐项核对
- [x] 9.6 ADR 校准回写：基石设计文档「零、当前实现校准」表 +omp 行（命中 engine registry / provider binding 更新触发器）
