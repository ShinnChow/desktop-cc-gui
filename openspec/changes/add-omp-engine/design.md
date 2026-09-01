# add-omp-engine — Design

> 事实源：Phase S Spike `docs/research/mossx-omp-capability-spike.md`（omp v18.0.11，2026-09-01 实测）；接入矩阵 `docs/research/mossx-new-cli-onboarding-guide.md` §0。
> 参照实现：jetbrains-cc-gui `OmpCliBridge` / `OmpHistoryReader` / `ai-bridge/services/omp/*`（协议身份与候选目录清单的对齐依据）。

## 1. 核心决策：pi-family 参数化，而非复制

omp 与 pi 的协议面全等（Spike A–E）。因此 omp 的 Rust 运行时**零新增协议代码**，全部差异收敛到一个 identity spec：

```rust
// src-tauri/src/engine/mod.rs（或 engine/pi_family.rs）
pub(crate) struct PiFamilySpec {
    pub engine: EngineType,                 // Pi | Omp
    pub bin_name: &'static str,             // "pi" | "omp"
    pub home_dir_name: &'static str,        // ".pi" | ".omp"
    pub display_name: &'static str,         // "PI CLI" | "OMP CLI"
    pub detect_env_keys: &'static [&'static str], // ["PI_BIN",…] | ["OMP_BIN","OMP_PATH","OMP_CLI_PATH"]
    pub local_profile_id: &'static str,     // "__local_pi__" | "__local_omp__"
}

impl EngineType {
    pub(crate) fn pi_family_spec(self) -> Option<PiFamilySpec> { … }
}
```

thread prefix 直接复用 `engine.as_str()`（`"pi"` / `"omp"`），不入 spec。

### 参数化清单（身份硬编码点 → spec 驱动）

| 现状硬编码 | 位置 | 改造 |
|---|---|---|
| `~/.pi/agent` | `status/pi.rs get_pi_home_dir()` | → `get_pi_family_home_dir(engine)`（`PI_CODING_AGENT_DIR` env 优先不变；fallback 用 spec.home_dir_name） |
| `~/.pi/agent/sessions` | `pi_history.rs resolve_pi_sessions_root()` | → 增加 engine 参数（`PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR` / home_override 优先级不变，仅 fallback 目录名按 spec） |
| `engine: Some("pi")` | pi_history.rs 两处 summary | → `engine.as_str()` |
| `find_cli_binary("pi")` | `pi/session.rs` | → `find_cli_binary(spec.bin_name, …)` |
| `EngineType::Pi` 事件标签 | `pi/session_rpc.rs` / `pi/session_send.rs` | `PiSession` 增加 `engine: EngineType` 字段，事件用 `self.engine` |
| `pi-external-` 唤醒前缀 | `pi/gates.rs` | 参数化 `{spec.bin_name}-external-`（omp 外部唤醒 turn 同形） |
| `"pi"` receipt/binding/thread id | `commands_send.rs` / `commands_send_sync.rs` / `commands_pi_rpc.rs` | → `engine.as_str()` / `format!("{}:{id}", engine.as_str())` |
| `matches!(engine, EngineType::Pi)` | `events.rs`（compaction 翻译、agent_settled）、`commands.rs`（fallback poison guard 等） | → `matches!(engine, EngineType::Pi \| EngineType::Omp)` 或 spec 判定 |
| `PI_STANDARD_THINKING_LEVELS` / catalog 探测链 | `status/pi.rs` | 保持共享；omp 复用 `supported_thinking_levels_for_pi_model` / `probe_pi_models_chain` / `promote_pi_default_from_settings`（omp 无 settings.json → `read_pi_default_model_selection` 返回 None，天然容错，无需特判） |

### 不参数化（omp 无对应面）

- `pi_auth.rs` / `pi_models_config.rs`：omp 无 auth.json / models.json（Spike F）。omp 不获得这两个命令面。
- `get_available_thinking_levels` RPC 调用（pi_rpc.rs:488）：omp Unknown command。核对该调用点的 Err 分支容错；若不容错，omp 路径跳过该调用（thinking levels 从 catalog `thinking[]` 取，Spike F）。

## 2. 检测（status/omp.rs）

复用 status 模块共享 helper（`find_cli_binary`、version probe、login-shell fallback——以现有 pi/qoder 检测的公共件为准），omp 专属候选集：

- env：`OMP_BIN` / `OMP_PATH` / `OMP_CLI_PATH`
- Windows：`%LOCALAPPDATA%\omp\omp.exe`（官方安装目录，Spike E1 本机实装）
- 跨平台：`~/.omp/bin`、`~/.bun/bin`、`~/.local/bin`、PATH
- version probe：`omp --version` → `omp/18.0.11`，parse `omp/<semver>`
- catalog 探测：复用 pi 三跳链（RPC `get_available_models` → `--list-models` → generated fallback）；omp 实测 `omp models --json` 亦可用，但**不新增第四跳**——`--list-models` omp 同样支持（与 pi 同 CLI 面）

## 3. 运行时

- `EngineManager` 增加 `omp_sessions` 集合 + `get_or_create_omp_session` / `interrupt_omp_sessions` / `drop_omp_resident_by_session_id`（对齐 pi 既有形状；manager 的 per-engine 字段模式是既有约定，不做 map 化大重构）。
- `PiSession::new` 增加 engine/spec 参数；omp session 与 pi session 同型（`PiSession`），按 workspace × session resident 隔离（B12 纪律随复用继承）。
- omp 事件链走 `engine=<"omp">`，thread id `omp:<sessionId>`；`omp-pending-` pending 前缀。
- daemon 双路径（Engine Forwarder Dual-Path Gate）：`engine_bridge.rs` 平行枚举 + `daemon_state.rs` 转发器 omp arm，与 app 内 `commands.rs` 同步演进；共享判定函数已下沉 `engine/pi*.rs`（如 `is_pi_external_wakeup_allowed`），omp 自动继承。

## 4. History

- 命令：`list_omp_sessions` / `load_omp_session` / `delete_omp_session`（`session_history_commands.rs` 内 omp 分支调用参数化后的 pi_family history 函数）；session_index writers / tombstone filter / empty prune 的引擎集合 +omp。
- SessionManagementSection / 侧栏 / ThreadList 的 omp 分支与 pi 同形（filter label、引擎徽章、baseEngineTitle）。

## 5. 前端

- `ompRealtimeAdapter` = `mapCommonRealtimeEvent("omp", input, { allowTextDeltaAlias: true })`（与 pi 同参）。
- `piHistoryLoader.ts` / `piHistoryParser.ts` 参数化 engine（`"pi" | "omp"`），registry / factory 加 `omp:` 分支；**禁止**落到 codex fallback。
- `ConversationEngine` union + `NORMALIZED_EVENT_DICTIONARY` + D4/D5/D6 白名单 +omp；presentationProfile 的 pi heartbeat 分支 omp 同享。
- composer：`engineToProvider("omp")→"omp"`、`AVAILABLE_PROVIDERS` +omp 条目、EngineIcon +omp（omp.sh favicon SVG，资产入 `src/assets/model-icons/`）、`ENGINE_IMAGE_LABEL`、reasoning effort 支持分支（omp 与 pi 同）。
- 模型 catalog：omp 与 pi 同为 runtime-only catalog（C4 决策：omp 与 pi 一样**不进** `STATIC_FALLBACK_ENGINES` / `RUNTIME_ONLY_ENGINES` 任一硬编码列表——static catalog JSON 仅 `auto` 占位条目，真实模型运行时探测；脚本本体若要求显式决策则按 pi 先例处理并记录）。

## 6. Shared（显式不进）

前后端双集合均不含 omp；Shared target picker 显示 omp disabled + reason（i18n key 复用既有 unsupported 文案通道）。

## 7. i18n

10 locale ×（`workspace.ts engineOmp`、`providers.ts "omp".label`、settings/sidebar 相关 key）；参照 pi key 形态逐语言补齐；parity 测试兜底。

## 8. 风险与防回归

- **pi 行为零变更**：参数化是纯重构；验收 = pi 既有单测全绿 + `cargo test pi` + realtimeAdapters/historyLoaders parity 测试。
- **omp RPC 命令子集**：capability matrix 按 Spike 实测填（fork/tree unsupported）；前端 fork/tree UI 入口由 capability 门控，不为 omp 渲染。
- **daemon 影子**：A5 核对包含 payload struct 字段对齐（ModelInfo 等）。
- **检测矩阵**：Windows 官方安装目录为必测项（Qoder 漏检前科）。

## 9. 验收

- §0 矩阵 A–H 逐行勾选（F 组 = 显式不进，写决策）；gate 自检命令全绿。
- 15 项 Contract Tests 中适用于本形态者（omp 复用 pi runtime，继承其既有覆盖；新增 omp 专属：检测矩阵单测、history 参数化单测、thread prefix 路由单测）。
- 渲染层目视验收七项（D 层清单）用真实 omp 会话执行。
- 存量防回归清单（指南 §五）逐项为零。
