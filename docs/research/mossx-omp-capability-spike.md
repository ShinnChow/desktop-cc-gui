---
type: research
status: active
---

<!-- DOC-LIFECYCLE: active-research -->

# OMP Capability Spike（Phase S）

> 日期：2026-09-01
> 实测环境：Windows 11 x64，omp **v18.0.11**（`%LOCALAPPDATA%\omp\omp.exe`）
> 上游流程：`mossx-new-cli-onboarding-guide.md` §二 Phase S
> 结论先行：**omp 是 pi 的 fork，协议面与 pi 全等（print-json NDJSON + RPC resident），历史存储布局全等（`~/.omp/agent/sessions/**.jsonl`）；差异仅在身份面（bin/home/thread prefix）、RPC 命令子集（无 fork/tree/thinking-levels 查询）与配置存储（config.yml + SQLite，非 auth.json/models.json）。接入按 pi-family 参数化复用，禁止复制 pi 实现。**

## A. 二进制与协议身份

| 维度 | 实测结论 | 证据 |
|---|---|---|
| Binary identity | `omp`；`omp --version` → `omp/18.0.11` | E1 |
| 安装渠道 | Windows 官方安装目录 `%LOCALAPPDATA%\omp\omp.exe`（本机实装）；`~/.omp/bin`、`~/.bun/bin`、`~/.local/bin`、PATH（对齐 jetbrains `CliStatusDetector`/`cli-path.js` 的候选集） | E1 + jetbrains 参考实现 |
| 环境变量覆盖 | `OMP_BIN` / `OMP_PATH` / `OMP_CLI_PATH`（jetbrains 约定，desktop 沿用） | jetbrains 参考实现 |
| 协议形态 | ① headless：`omp --print --mode json`，stdout NDJSON；② 长驻：`omp --mode rpc`（JSONL typed command/response + event 流） | E2/E4 |
| RPC 握手 | 首行 `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}` —— 与 pi_rpc 握手全等 | E4 |
| 控制面 | RPC resident 支持 mid-turn prompt / abort / set_model / compact / new_session / switch_session（见 D 节命令表）；extension_ui_request 会出现在事件流（须按 B12 纪律 auto-cancel，pi_rpc 已有该处理，复用即继承） | E4/E5 |
| Schema fingerprint | 无独立 schema 文件；用 binary version + RPC protocolVersion 兜底（同 pi 现状） | E1/E4 |

## B. Session 生命周期

| 维度 | 实测结论 | 证据 |
|---|---|---|
| 创建 | 首个 prompt 隐式创建；`session` 事件（version 3, id, timestamp, cwd）回报 identity | E3 |
| Resume | `--resume <id>`（支持 id 前缀/路径）；RPC `switch_session`（sessionPath）命令被识别（对不存在路径报 `File not found` 而非 Unknown command） | E2 help / E6 |
| Fork/Tree | **RPC 不支持**：`get_tree` / `get_fork_messages` → `Unknown command`。print 层无 fork flag。**首期 session.fork/session.tree = unsupported** | E5 |
| Session id 唯一性 | UUID v7 形态（`01a0563e-…`），单分发（无区域版），raw id 即可作 durable identity（不走 A7 profile-qualified） | E3 |
| 派生关系 | 无 fork → 无派生行治理义务（G8 不适用）；compact 为原地事件（compaction_start/end），参照 pi events.rs 翻译路径复用 | E5 |

## C. Input / Output 通道

| 维度 | 实测结论 | 证据 |
|---|---|---|
| User input | print 模式：positional prompt（`safePromptArg` 同款 dash-guard 需注意）；RPC：`{"type":"prompt","message","images"[]}` | E2/E4 + pi_rpc.rs:361 |
| 图片输入 | 与 pi 同协议（RPC `images[]` / print 模式 @file）；omp `--help` 声明 `MESSAGES` 支持 `@` 文件前缀 | E2 |
| Output 事件 | NDJSON：`session` / `agent_start` / `turn_start` / `message_start` / `message_update`（`text_delta`、`thinking_delta`、`thinking_start` 等，`contentIndex` 字段）/ `message_end`（含 `usage`）/ `tool_execution_start` / `tool_execution_end` —— 与 pi.rs 头注释的事件面逐项一致 | E3 |
| 附件路径非 ASCII | 本机实测 cwd 含中文（`github项目`），session 目录编码 `-Desktop-github项目-desktop-cc-gui` 正常落盘、可读 | E7 |

## D. ACK 语义

| 维度 | 实测结论 | 证据 |
|---|---|---|
| Input ACK | RPC：`{"type":"response","command":"prompt","success":true}` = request-response ACK（仅 accepted，非 terminal——pi_rpc.rs:824 已有同款纪律测试） | pi_rpc 既有测试 + E4 同协议 |
| Run Started | 显式 `agent_start` / `turn_start` | E3 |
| Terminal | typed `message_end` + `agent_end`/`turn_end`（含 errorMessage）；进程退出仅表 cleanup——typed terminal 优先于退出码（红线 15） | E3 + pi.rs 头注释 |
| RPC 命令面实测 | ✅ `get_state` / `get_session_stats` / `get_available_models` / `new_session` / `compact`（空调会话报 `Nothing to compact`，命令本身存在）/ `abort` / `set_model` / `switch_session` / `get_last_assistant_text`；❌ `get_available_thinking_levels` / `get_tree` / `get_fork_messages`（Unknown command） | E5/E6 |
| Cancel | RPC `abort` ✅ | E6 |
| Pending Probe | 可读 `~/.omp/agent/sessions/**.jsonl`（append-only）按 session id 对账 | E7 |
| response 与 stream 交错 | 与 pi 同 pump（stream_lines.rs / session_rpc.rs），复用即继承 B13 drain 纪律 | 复用 |

## E. History 能力

| 维度 | 实测结论 | 证据 |
|---|---|---|
| 存储 | `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl`；首行可含 `{"type":"title"}`，次行 `{"type":"session","version":3,"id","cwd","timestamp"}`；正文 `message` / `model_change` 等条目与 pi_history.rs 解析面一致 | E7 |
| 环境覆盖 | `PI_CODING_AGENT_DIR` **被 omp 遵守**（实测 session 落入覆盖目录）；`PI_CODING_AGENT_SESSION_DIR` 同 pi 谱系 | E8 |
| arbitrary import | 无官方 import 协议 → 不做（红线 21） | — |
| stable cursor | 文件 append-only；L3 NativeHistoryReader 后置（不在首期） | 决策 |

## F. Provider / Model / 配置

| 维度 | 实测结论 | 证据 |
|---|---|---|
| 配置存储 | **`~/.omp/agent/`：`config.yml`（modelRoles、providers 等）+ `models.db` / `agent.db` / `history.db`（SQLite）；无 `auth.json` / `models.json` / `settings.json`（仅遗留 `settings.json.bak`）** → pi_auth.rs / pi_models_config.rs 对 omp **不适用**，首期不接 omp 凭据/provider 物化管理 UI | E9 |
| Model 列表 | `omp models --json` → `{models:[{provider,id,selector,name,contextWindow,maxTokens,reasoning,thinking[],input[],cost}]}`；RPC `get_available_models` ✅ —— pi 三跳探测链（RPC → `--list-models` → fallback）整体复用 | E10/E5 |
| Model roles | `omp config get modelRoles --json` → `{value:{default:"kimi-code/k3",…}}`；roles 是 omp 配置面概念，desktop 侧**不做** jetbrains 式 role-as-mode 统一（desktop pi 亦无此概念；omp 走与 pi 一致的 model catalog + thinking level 路径） | E10 + 决策 |
| Thinking levels | `--thinking off\|minimal\|low\|medium\|high\|xhigh\|max\|auto`；catalog 每模型自带 `thinking[]` 列表 → 复用 `supported_thinking_levels_for_pi_model`；`get_available_thinking_levels` RPC 不存在，调用处必须容错（pi_rpc.rs:488 已是 match Err 分支，复用前核对 Err 路径不阻断 send） | E2/E5 |
| 凭据优先级 | omp 凭据存于 models.db/config.yml（omp 自管），mossx 不注入 → B11 凭据遮蔽风险面不适用 | E9 |
| 隔离 | `--profile=<value>` 提供 auth/session/settings 隔离（多 profile 能力存在，首期只用 default profile） | E2 |

## G. Usage 报告

| 维度 | 实测结论 | 证据 |
|---|---|---|
| per-turn usage | `message_end.message.usage`（input/output/cacheRead/cacheWrite/totalTokens/cost）；RPC `get_session_stats` 返回累计 tokens + contextUsage | E3/E5 |

## 分档结论

- **首期档位：L1+（pi-family RPC resident 复用）**。omp 与 pi 共用同一进程/session/history/事件实现，经 pi-family identity spec 参数化；print-json 降级路径随复用自动获得。
- **Shared 资格：首期不进** `SHARED_SESSION_SUPPORTED_ENGINES`。理由：① omp RPC 命令面与 pi 有实测差异（无 fork/tree），pending-probe / 恢复语义需独立验收；② 本仓库已有「先 Native 后 Shared」成熟后置流程（`enable-qoder-shared-target`），omp Shared 准入作为独立 follow-up change；③ 控制本 change 爆炸半径。UI 侧 omp 在 Shared target picker 中 disabled + reason（不静默隐藏）。
- **显式排除项（决策记录）**：omp auth.json/models.json 管理 UI（omp 无此文件）；omp fork/tree 命令注册（RPC 无此命令）；role-as-mode 统一（desktop 无此交互概念）；L3 Native continuation（后置）。

## 证据索引

| # | 命令 / 观察 |
|---|---|
| E1 | `which omp` → `C:\Users\Administrator\AppData\Local\omp\omp.exe`；`omp --version` → `omp/18.0.11` |
| E2 | `omp --help`：flags `--print --mode json\|rpc\|rpc-ui --resume --model --thinking --session-dir --profile --no-extensions --no-session` |
| E3 | `omp --print --mode json "say OK only"`（/tmp）：完整 NDJSON 事件序列（session v3 → agent_start → turn_start → message_start/update(thinking_delta)/…） |
| E4 | `omp --mode rpc --no-session --no-extensions`：ready 握手 + extension_ui_request + available_commands_update |
| E5 | RPC 批量探测：`get_state`✅ `get_session_stats`✅ `get_available_thinking_levels`❌ `get_tree`❌ `get_fork_messages`❌ |
| E6 | RPC 批量探测：`get_available_models`✅ `new_session`✅ `compact`✅(空会话报错但命令存在) `abort`✅ `set_model`✅ `switch_session`✅(识别，报 File not found) `get_last_assistant_text`✅ |
| E7 | `~/.omp/agent/sessions/-Desktop-github项目-desktop-cc-gui/*.jsonl`：title 行 + session v3 header + model_change 条目 |
| E8 | `PI_CODING_AGENT_DIR=/tmp/omp-spike-agent omp --print …` → session 落入 `/tmp/omp-spike-agent/sessions/--C--tmp--/` |
| E9 | `ls ~/.omp/agent/`：config.yml / models.db / agent.db / history.db / settings.json.bak；无 auth.json/models.json/settings.json |
| E10 | `omp models --json` 与 `omp config get modelRoles --json` 实际输出（形状与 pi 一致） |
