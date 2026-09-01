# add-omp-engine

## Why

mossx 当前支持 9 个 built-in CLI 引擎（claude / codex / gemini / grok / kimi / opencode / pi / dsh / qoder）。OMP CLI（`omp`，oh-my-pi，pi 的官方 fork）已在 jetbrains-cc-gui 完成接入（参照实现），desktop 侧尚不存在。Phase S Spike（`docs/research/mossx-omp-capability-spike.md`，omp v18.0.11 实测）确认：omp 与 pi **协议面全等**（print-json NDJSON 事件流 + `--mode rpc` 长驻控制面 + `~/.omp/agent/sessions/**.jsonl` 历史布局 + `PI_CODING_AGENT_DIR` 覆盖），具备按 pi-family 参数化复用接入的条件。用户需要：

- 在对话中选择 OMP 引擎发消息、流式渲染、中断、续聊历史 session。
- 浏览 / 加载 / 删除本机 OMP 历史会话，接入统一 session catalog。
- 在设置页完成 OMP CLI 的安装检测、版本检测与 doctor 诊断、自定义路径配置。
- 在 composer 选择 OMP 运行时 catalog 中的模型与 thinking level。

## What Changes

- 新增 `EngineType::Omp`（serde `"omp"`）全链路：engine 检测（`omp --version` + `OMP_BIN`/`OMP_PATH`/`OMP_CLI_PATH` env + `~/.omp/bin` / `~/.bun/bin` / `%LOCALAPPDATA%\omp` / `~/.local/bin` 候选矩阵）、session 管理（复用 `PiSession` RPC resident + print-json 降级）、interrupt（RPC abort + kill）、capability matrix、daemon 影子副本同步。
- **pi-family 参数化复用（核心设计决策）**：不复制 pi 实现。新增 pi-family identity spec（`EngineType::{Pi,Omp}` → bin name / home dir name `.pi`|`.omp` / thread prefix / display name / detect env keys），将 pi.rs / pi_history.rs / pi_rpc.rs / status/pi.rs 中的身份硬编码点参数化；omp 经同一实现路径运行。**顺手抽离**：`resolve_pi_sessions_root` / `get_pi_home_dir` / detect 探测链等身份相关函数改为 spec 驱动，pi 行为不变（纯重构，既有测试兜底）。
- 新增 `engine/omp_provider_profile.rs`（local profile sentinel `__local_omp__`，同 pi 形态：omp 用原生 `~/.omp` 配置，mossx 不物化多 provider 配置）与 `engine/status/omp.rs`（omp 专属候选目录检测，探测链复用 pi-family 共享实现）。
- 新增命令 `list_omp_sessions` / `load_omp_session` / `delete_omp_session` / `omp_get_session_stats` / `omp_compact` / `omp_doctor`（复用 pi-family history / RPC 实现，按 engine 分派）；**不注册** fork/tree/fork_messages（omp RPC 实测 Unknown command，Spike E5）。
- 前端引擎接线：`EngineType` 加 `"omp"`、`ompRealtimeAdapter`（复用 `mapCommonRealtimeEvent`）、omp history loader/parser（参数化 piHistoryLoader/piHistoryParser，**不复制**）、`omp:` thread id 前缀、渲染白名单（D4/D5/D6）、composer provider 接线、EngineIcon（omp.sh favicon mark）、10 locale i18n。
- CLI 生命周期：`CliInstallEngine::Omp` + `omp_doctor`。
- omp 专属 engine config key：`ompBin`（对齐 `piBin`）。

### 显式排除（决策记录，对应 Spike「显式排除项」）

- omp **不进** `SHARED_SESSION_SUPPORTED_ENGINES`（前后端双集合均不加）；Shared target picker 中 omp disabled + capability reason。后置 follow-up change 参照 `enable-qoder-shared-target`。
- 不接 omp auth.json / models.json 管理 UI（omp v18 配置面为 config.yml + SQLite，无此二文件）。
- 不注册 omp fork / session-tree / fork-messages 命令（RPC Unknown command 实测）。
- 不做 jetbrains 式 model-role-as-mode 统一（desktop composer 无此概念，omp 与 pi 同走 model catalog + thinking level）。

## Capabilities

### New Capabilities

- `omp-engine-runtime`: OMP CLI 作为第 10 个 Native Engine 的消息发送 / 流式渲染 / 中断 / session 续聊 / 模型与 thinking level 配置（RPC resident 主通道 + print-json 降级）。
- `omp-session-history`: OMP 历史会话的列表 / 加载 / 删除，接入统一 session catalog。
- `omp-cli-lifecycle`: OMP CLI 的检测 / 安装 / doctor 诊断与自定义路径。

### Modified Capabilities

- `engine-capability-matrix`: matrix fixture 与 Rust 推导增加 omp 条目（streaming.text / streaming.reasoning / tool.use / reasoning.effort / image.input / session.resume / rpc.server / input.mid-turn = supported；streaming.tool-output / session.fork / session.tree / collaboration.mode / session.switch = unsupported（Spike 实测或同 pi 诚实口径）；session.continuation = unsupported（L3 后置））。
- `engine-adapter-protocol-registry`: registry 增加 `builtin.omp`，protocolFamily 复用 `pi-rpc`，executionModel `persistent`。
- `cli-engine-visibility`: omp 默认可见（与 pi 同形态）。
- `shared-session-engine-selection`: 明确 omp **不在** Shared 支持集合（picker disabled + reason，与 gemini/dsh/qoder 同形态）。

## Impact

- Affected code: `src-tauri/src/engine/**`（pi-family 参数化 + omp 身份）、`src-tauri/src/bin/cc_gui_daemon/**`（影子副本）、`src-tauri/src/command_registry.rs`、`src-tauri/src/{state,session_management*}.rs`、`src-tauri/src/workspaces/commands.rs`、`src/types/**`、`src/features/{engine,threads,messages,composer,vendors,settings,app,home}/**`、`src/app-shell*/**`、`src/services/tauri/**`、`src/i18n/locales/*`、`scripts/check-engine-*.mjs`、`openspec/specs/engine-capability-matrix/fixtures/matrix.json`。
- APIs: 新增 Tauri 命令 `list_omp_sessions` / `load_omp_session` / `delete_omp_session` / `omp_get_session_stats` / `omp_compact` / `omp_doctor`；`cli_install_plan` / `cli_install_run` 的 `engine` 接受 `"omp"`。
- Data: 只读 `~/.omp/**`；mossx 自身 config 新增 `ompBin` key；**不写** omp 凭据 / config.yml。
- 既有 pi 行为零变更（参数化为纯重构；pi 既有测试套件 + golden fixtures 兜底）。
