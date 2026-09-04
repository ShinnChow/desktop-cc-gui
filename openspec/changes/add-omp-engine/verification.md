# add-omp-engine — Verification

> 日期：2026-09-01 · 环境：Windows 11 x64 · omp v18.0.11（实装于 `%LOCALAPPDATA%\omp\omp.exe`）

## 门禁与编译

| 项 | 结果 |
|---|---|
| `cargo check --all-targets`（app lib + tests + cc_gui_daemon bin） | ✅ 0 error |
| `tsc --noEmit` | ✅ 0 error |
| `check:engine-capability-matrix` | ✅ ok（15 capabilities，含 omp 行） |
| `check:engine-adapter-registry` | ✅ ok（10 built-ins） |
| `check:model-provider-catalog` | ✅ valid（omp = pi 同形态 runtime-only，决策记录于设计文档） |
| `check:capability-aware-policy-router` | ✅ rc=0 |
| `check:engine-controller-facade` | ❌ **存量红**（useEngineController.ts 947 行 vs 阈值 600，HEAD 即 947——本 change 未触碰该文件） |
| `cargo test` | ⚠️ **本机环境阻塞**：测试二进制启动即 `STATUS_ENTRYPOINT_NOT_FOUND`（0xc0000139），对任意 filter（含未改动测试）均复现 → 与本 change 无关；CI 侧需跑 pi 既有套件零回归 |
| vitest 目标套件 | ✅ 13 files / 295 tests：realtimeAdapters（含 omp parity）、threads/loaders（含 ompHistoryLoader 与 pi 同 fixture 断言）、sharedSessionEngines、CodexSection.test、SettingsView.test |
| i18n parity | ✅ 11/11 files（85 tests）+ i18n/index 6/6 |

## 真实 omp 端到端 smoke（release daemon `cc_gui_daemon --insecure-no-auth`，TCP NDJSON 直驱）

| 步骤 | 证据 |
|---|---|
| `detect_engines {engines:["omp"]}` | ✅ `installed:true, version:"omp/18.0.11", binPath:%LOCALAPPDATA%\omp\omp.exe, homeDir:~/.omp/agent`，features = pi 同面 |
| `add_workspace` + engine gate | ✅ 通过（检测走新注册候选目录） |
| `engine_send_message engine:"omp"` | ✅ 返回 `engine:"omp"` + `omp-turn-<uuid>` started |
| 流式幕布事件 | ✅ `thread/started` → `turn/started` → `item/reasoning/textDelta` ×N → `item/agentMessage/delta` ×N（正文 "OMP_SETTLE_OK" 逐 delta 到达）→ `item/completed` → `turn/completed` |
| 会话续聊 | ✅ 第二 turn `continueSession:true` 复用同一 omp session id `01a05d14-…` |
| canonical thread id | ✅ `omp:01a05d2c-…`（omp: 前缀契约） |
| `engine_interrupt` | ✅ RPC abort → `turn/completed`（空 result，`assistantFinalBoundary:true`） |
| 历史落盘 | ✅ `~/.omp/agent/sessions/--C--tmp-omp-smoke-ws--/<ts>_<sessionId>.jsonl`（title 行 + session v3 header + message 条目） |
| 生命周期标记 | ✅ `omp/raw` kind=`agent_settled` 送达（omp 无原生 agent_settled → 投影层将 agent_end 映射为 settle；与 pi 的 pi/raw 同构） |
| daemon `get_engine_models` | ⚠️ pi / omp 均返回缓存空表——daemon 侧 models 走 cached status（pi 亦然，存量语义；模型目录主通道在 app 侧 `commands.rs` on-demand 探测链，omp 臂已接，RPC `get_available_models` 实测可用） |

### smoke 驱动的实测修正（omp ≠ pi 的协议差异）

1. **omp RPC 无 `agent_settled`**（v18.0.11 实测事件流以 `agent_end` 收尾）→ `session_rpc.rs` 对 omp 将 `agent_end` 映射为 run settle（带 errorMessage 时作 fatal），`pi_rpc.rs` pump 在 `agent_end` 同点清 streaming 标志。
2. omp RPC `get_tree` / `get_fork_messages` / `get_available_thinking_levels` = Unknown command → 不注册 fork/tree 命令与 UI；thinking levels 走 catalog `thinking[]` 容错链（`refresh_thinking_levels` Err 分支既有容错，核对通过）。

## 双路径纪律（Engine Forwarder Dual-Path Gate）

- app 进程转发器（`commands_send.rs`）与 daemon 转发器（`daemon_state/engine_send.rs`）两份拷贝同步改造为 pi-family 参数化；判定函数保持在 `engine/pi/gates.rs` 共享（`is_pi_family_external_wakeup_allowed` 等），bin 层零复制。
- 验证血缘：smoke 直接驱动 `target/release/cc_gui_daemon`（安装版形态）。

## 环境性发现（非本 change 引入，已实证）

- **debug 版 daemon 在本机任何客户端请求下主线程栈溢出崩溃**（current_thread runtime + 巨型 dispatch future）：HEAD baseline worktree 构建对照组同样崩溃 → 存量问题，与 omp 接入无关。release 构建正常。
- daemon 分发缺口存量补齐：`pi_doctor`/`omp_doctor` arm、`parse_engine_type_string` 的 `pi`/`omp`、`sync_engine_configs` 的 pi/omp bin 同步。
- HEAD 在 Windows 编译被 `workspaces/open_app.rs` 的 macOS-only import 阻断（`get_open_app_icon_inner` cfg 缺失）——对照组打补丁后才可构建；主工作树不受影响（用户侧已有修复）。

## 存量防回归

- pi 全部既有单测与 fixtures 未改动语义（参数化为纯重构；`cargo check --all-targets` 绿；vitest pi/omp parity 用例绿）。
- Shared 双集合未含 omp；`sharedSessionEngines.test.ts` 绿。
- 渲染白名单只追加不重排（agents 全部 additive 编辑）。
