---
type: research
status: active
date: 2026-08-27
---

# PI CLI 适配深度研究：强点、遗留与未释放能力（2026-08-27）

> 校准:pi@0.84.3（本机 `@earendil-works/pi-coding-agent`，含 `docs/` 官方文档实测）× mossx @ `bump-version-0.9.3`（`29dc592ed`）
> 事实源:pi 官方 `docs/*.md`（rpc.md 1595 行 / extensions.md / packages.md / settings.md / security.md 等）+ 仓库代码（`pi.rs` / `pi_rpc.rs` / `pi_history.rs` / `pi_auth.rs` / `pi_models_config.rs` / `src/features/pi-session/**`）+ 基石设计「当前实现校准」表 + onboarding guide §0 矩阵 + gap 权威口径 [`docs/analysis/pi-cli-feature-parity-gap-2026-08-24.md`](../analysis/pi-cli-feature-parity-gap-2026-08-24.md)（v3）
> 性质:现状研究报告。**不是实施计划**——gap v3 已明确「不再把 pi 协议有、mossx 没调当缺口」，本文尊重该口径，只在 §五 把差集摆全并标注每项的处置状态。

---

## 〇、一句话结论

**PI 的会话主干能力已经基本完全释放，部分维度是九引擎里最深的；未释放的能力集中在三块「面」上——扩展 UI 交互、发现面（slash / prompt templates / 扩展命令）、治理面（packages / settings 调优 / 工具开关）——其中绝大多数有 gap v3 的产品决策在案（不做 / 冻结），真正的静默短板很小**：fire-and-forget 扩展事件被静默丢弃、slash 发现面缺 extension commands 与 prompt templates、capability 双源口径不一致、OpenSpec change 收尾卫生。

一个此前文档没有明确说过、本次核实的**关键事实**：RPC resident 不带 `--no-extensions` 启动（`pi_rpc.rs:79-138`，只有 catalog 探测才加 `--no-session --no-extensions`），所以 **pi 扩展生态在 mossx 里默认是「活的」**——用户装的 pi-lens / pi-memory / pi-search / pi-condense / pi-background-tasks 等工具型扩展在 mossx 会话内照常生效（自定义工具照常出现在工具卡里）。被降级的只有**依赖 `extension_ui_request` 对话框的 UI 型扩展**和**扩展管理面**。

---

## 一、pi cli 0.84.3 能力全景（本体盘点）

### 1.1 三种运行形态

| 形态 | 说明 | mossx 使用 |
|---|---|---|
| TUI | 交互终端（fullscreen / regular、themes、keybindings、tree view） | 不适用（GUI 客户端） |
| `--print --mode json` | spawn-per-turn 非交互 JSON 输出 | ✅ 降级路径 |
| `--mode rpc` | 长驻 JSONL RPC 进程（stdin 命令 / stdout 事件） | ✅ 主路径 |

### 1.2 RPC 协议面（32 命令 / 17 类事件 / extension UI 子协议）

命令全集（按官方 rpc.md 分组）：

| 分组 | 命令 |
|---|---|
| Prompting | `prompt` / `steer` / `follow_up` / `abort` / `new_session` |
| State | `get_state` / `get_messages` |
| Model | `set_model` / `cycle_model` / `get_available_models` |
| Thinking | `set_thinking_level` / `cycle_thinking_level` / `get_available_thinking_levels` |
| Queue Modes | `set_steering_mode` / `set_follow_up_mode` |
| Compaction | `compact`（含 customInstructions）/ `set_auto_compaction` |
| Retry | `set_auto_retry` / `abort_retry` |
| Bash | `bash` / `abort_bash`（宿主侧执行、输出进 LLM 上下文） |
| Session | `get_session_stats` / `export_html` / `switch_session` / `fork` / `clone` / `get_fork_messages` / `get_entries`（增量 cursor）/ `get_tree` / `get_last_assistant_text` / `set_session_name` |
| Commands | `get_commands`（列出 extension commands + prompt templates + skills，可经 `/name` 经 `prompt` 调用） |

事件全集：`agent_start/end/settled`、`turn_start/end`、`message_start/update/end`（text/thinking/toolcall delta）、`bash_execution_update`、`tool_execution_start/update/end`、`queue_update`、`compaction_start/end`、`auto_retry_start/end`、`summarization_retry_*`、`extension_error`。

**Extension UI 子协议**（RPC 模式下扩展与宿主交互的标准通道）：

- Dialog 类（阻塞等响应）：`select` / `confirm` / `input` / `editor`；
- Fire-and-forget 类（不等待）：`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`。

### 1.3 扩展系统（pi 的一等能力核心）

- **事件钩子**：startup / resource / session（`session_before_switch`、`session_before_fork` 等可取消钩子）/ agent / model / tool / user-bash / input 全生命周期事件；
- **自定义工具**：扩展可注册工具，且可**覆写 built-in 工具**（`read` / `bash` / `powershell` / `edit` / `write` / `grep` / `find` / `ls`）；
- **自定义 provider**：注册/注销 provider、OAuth 支持、自定义 streaming API——models.json 之外的另一条 provider 扩展路径；
- **自定义 compaction / branch summarization**；
- **containerization**：官方示例 gondolin 扩展把 built-in 工具和 `!` 命令路由进 micro-VM（主机保 auth）——pi 生态「无内建 sandbox」哲学下的隔离方案。

### 1.4 packages 生态与 CLI 管理面

- `pi install/remove/update/list/config` 子命令；源支持 npm / git / local path；`pi update` 可更新 self / extensions / model catalogs；
- convention directories：包内 `extensions/` / `skills/` / `prompts/` / `themes/` 自动发现，`pi config` TUI 可按资源粒度启用/禁用；
- 本机实例（用户已装）：pi-lens（LSP 诊断 / autoformat / autofix / tests / read-guard / opengrep 安全扫描 / context injection）、pi-background-tasks、pi-memory、pi-search、pi-condense、pi-lean-ctx。

### 1.5 会话系统

append-only entry tree（`get_tree` / `get_entries(since)` 稳定 cursor）、fork（从历史 user message 分叉到新文件）、clone、label、branch summary、compaction（自动 + 手动 + `reserveTokens` / `keepRecentTokens` 调优）、session naming（`set_session_name` / `--name`）、`export_html`。

### 1.6 模型与安全模型

- 多 provider：`auth.json`（API key + 部分 OAuth）+ `models.json` 自定义 provider + 扩展注册 provider；thinking levels `off..max` + `thinkingBudgets` 逐档 token 预算；model cycling（`--models` / `enabledModels`）；
- 工具开关：`--tools` / `--exclude-tools` / `--no-tools` / `--no-builtin-tools` / settings `defaultTools`；
- 安全：project trust（`--approve` / `-na` / `defaultProjectTrust`），**无内建 sandbox、无审批弹窗（哲学：靠扩展做隔离）**，官方反 MCP 立场（matrix `tool.mcp: unsupported` 是正确口径）。

---

## 二、客户端适配现状：强点盘点

按 onboarding guide §0 八层矩阵（A–H）核对，PI 已达 **L2 级完整接入 + Shared 支持集合成员**（F 组），且是 B12 / B13 / D11 / G6 / G8 五行矩阵纪律的实证来源。以下强点按「深度」排序。

### 2.1 传输层：双传输 + 全套健壮性纪律（九引擎最深档）

- **RPC 长驻主路径**（`enhance-pi-native-rpc-session` 收口）：resident per workspace × session 真并行、idle `prompt` / streaming `steer`（`input.mid-turn = supported`，与 codex/claude 同档）、`abort` + 2s 宽限、`set_model` reconcile、`set_thinking_level`（模型白名单来自 `get_available_thinking_levels`）、`switch_session` 对齐；
- **print-json 降级路径**：spawn-per-turn、同 session busy 互斥、stdout-EOF 宽限（孙进程滞留类问题）、`@file` argv 提取（含空格/去重/防 prompt 整体变文件路径）；
- **故障纪律**：RPC 失败 60s 冷却闩 + 存活 resident 复用优先 + 冷却后放行试探自愈（禁止 app 生命周期不可逆）；turn 结算看门狗对账（30s tick / 900s 静默预算，覆盖 compact 500s）而非墙钟 timeout；missed `agent_settled` 自愈；orphan run adoption（外部 turn / 后台任务自唤醒收养）；send gate 双证据快速失败（`pi_engine_unavailable` 结构化错误）。

### 2.2 会话树 / 分叉 / 压缩：matrix 独有档位

- `session.tree = supported`（只读树 + fork）、`session.fork = supported`（fork-to-new-file + `parentSession` 派生族）、`rpc.server = supported`——capability matrix 15 键中 PI 是唯一树/分叉/RPC 三键全绿的引擎；
- 前端 `src/features/pi-session/**` 全套：会话树面板（磁盘 family root + derived lanes 合并）、分叉气泡 + 派生会话侧栏隐藏（带权威 reconcile）、branch chip / badge、compact 弹窗（并入上下文圆圈锚定 popover）、session stats；
- 深树防护：`get_tree` 2000 层深 JSON 在 32MB 栈线程上深度路由解析 + flatten/slim（serde 128 层递归限制的实证加固，B13 纪律来源）。

### 2.3 pi-background-tasks 扩展：上游扩展协议的深度适配

- 工具面（`bg_run` / `bg_delegate` / `bg_run_pi_attested` / `fusion_*`）→ 任务卡启动；receipt（structured + text fallback）→ 运行态；terminal notification → 折叠卡 + pill——canonical `backgroundTask` item 三路状态表；
- post-settle orphan 通知被 per-turn forwarder 丢弃的已知缺口，已由 **registry watcher B 通道兜底**落地（`useBackgroundTaskRegistryWatcher.ts`，读 `.pi/tasks/` 终态 metadata，单组件级 interval、只在状态变化时 apply，遵守 Render Perf 红线）。

### 2.4 模型 catalog 与 auth

- 三层探测：RPC `get_available_models`（`--no-session --no-extensions`，~1s，预算 15s）→ `--list-models --no-extensions` → bare `--list-models`（旧版）→ 生成式兜底；cache-first + **fallback 防中毒守卫**（PI 专属：合成 `auto` 兜底不回写缓存毒化 L1）；
- thinking levels 档位是 pi 上游 `getSupportedThinkingLevels` 的 Rust 移植（xhigh/max 仅在模型声明时出现）；
- `auth.json` 36-provider CRUD（对齐 pi `env-api-keys.ts`，masked、原子 0600 写、损坏 fail-closed、OAuth 条目保全拒删）+ `models.json` JSONC 保格式 raw-text 编辑器；设置页 11 locale parity。

### 2.5 Shared 层与工程反哺

- PI 在 `SHARED_SESSION_SUPPORTED_ENGINES` 内；Shared/Atomic 思考档位联动已扩到 PI（`d0706f545`，前端-only，复用既有 RPC `set_thinking_level`）；多 agent orchestration 接受 PI 为 collab target；
- ~80 个 Rust 单测 + ~15 个 FE 套件，锚定真实 pi 0.83–0.84 抓包 fixture；onboarding 矩阵五行纪律（resident 作用域 / watchdog / 非 ASCII 路径切片 / 派生会话治理 / 深嵌套防护）以 PI 事故实证回写，成为后续引擎接入的通用规范。

---

## 三、遗留点（有决策/文档在案，未完全收尾）

| # | 遗留点 | 事实源 | 性质 |
|---|---|---|---|
| L1 | **OpenSpec 卫生**：11 个 pi 相关 change 未 archive，多数剩 1–2 个收尾 task；`expand-shared-atomic-reasoning-linkage-to-pi` 实现已落地（commit `d0706f545` + verification.md + 测试）但 tasks.md 39 项 checkbox 全未勾 | `openspec/changes/` 各 tasks.md | 流程债，非功能缺口 |
| L2 | **registry 元数据失真**：`engineIds.json` / `adapter_registry.rs` 仍标 `stream-json-cli` / `one-shot`，与 RPC 长驻主路径不符（对运行无影响，对治理脚本与心智模型有误导） | `adapter_registry.rs:167-180` | 良性失真，建议随下次 registry 变更顺手改 |
| L3 | **capability 双源口径不一致**：runtime `capability_state` 对 `input.mid-turn` / `session.fork` / `session.tree` / `rpc.server` 返回 `unknown`，而 spec-generated matrix 标 `supported`（前端以 generated 为权威，实际不影响行为） | `capability_matrix.rs:54-56` vs `.generated.rs:131-152` | 诚实性 hygiene |
| L4 | **post-settle orphan 通知**：per-turn forwarder 丢弃行为仍在（根治需 A 通道改造），registry watcher 兜底已上线；「兜底 ≠ 根治」的口径需保持 | 基石设计校准行 + `useBackgroundTaskRegistryWatcher.ts:76-90` | 已缓解，观察项 |
| L5 | **降级路径能力天花板**：print-json 不能 steer；同 session 并发发送被拒绝（消息留队列）；RPC-only 命令（stats/tree/fork/compact）在 RPC 不可用时直接失败，树面板靠 last-good 快照 | `pi.rs:2092-2096` | 设计内降级 |
| L6 | **catalog 探测仍是启发式三层链**，慢环境有降级风险（已用 `--no-extensions` + 15s + 防中毒大幅缓解）；auth catalog 对齐 0.84.1，本体已 0.84.3（小漂移） | `status.rs:1249-1294` | 版本跟进项 |

---

## 四、未释放能力全景（差集 + 处置状态）

### 4.1 RPC 命令差集：32 命令中 16 个未调用

已用 16 个：`prompt` / `steer` / `abort` / `new_session` / `get_state` / `get_available_models` / `set_model` / `set_thinking_level` / `get_available_thinking_levels` / `compact` / `get_session_stats` / `switch_session` / `fork` / `get_fork_messages` / `get_tree` / `get_last_assistant_text`。

未用 16 个及处置（处置列 = gap v3 §三/§五 口径）：

| 命令 | 能力 | 处置 |
|---|---|---|
| `follow_up` | 回合结束后排队投递（带图） | **撤销**——mossx 跨引擎 `MessageQueue` 已是同功能 |
| `set_follow_up_mode` / `set_steering_mode` | 队列投递节奏（one-at-a-time / all） | 未评估——mossx 用 pi 默认值（`one-at-a-time`）；若 mossx 队列融合语义与 pi 默认节奏冲突才需碰 |
| `get_messages` | 全量消息拉取 | 明确不做（重复事实源，mossx 有自己的 transcript 管线） |
| `cycle_model` / `cycle_thinking_level` | TUI 快捷循环切换 | 明确不做（TUI 专属；mossx 有选择器） |
| `set_auto_compaction` | 自动压缩开关 | batch-4 撤销（pi 默认自动压缩，mossx compact 入口已有） |
| `set_auto_retry` / `abort_retry` | 瞬时错误自动重试控制 | **撤销**——Shared `useSharedProviderRetry` 已有倒计时/熔断，禁止双层重试 |
| `bash` / `abort_bash` | 宿主 bash 输出进 LLM 上下文 | **撤销**——TerminalDock 已有；独占价值（进上下文）是 P2 边角 |
| `export_html` | 会话导出 HTML | P2——应做成 mossx 级「全引擎导出」，不标 PI 特性 |
| `clone` | 当前分支原样复制 | P2（fork 已有） |
| `get_entries`（`since` cursor） | 增量 entry 同步（跨重启稳定 cursor，含 pre-compaction 与废弃分支） | 冻结——历史管线内部增强，用户无感；**若未来做 mossx ↔ pi 双向同步/游标对账，这是唯一官方通道** |
| `set_session_name` | 会话命名（跨端 `pi -r` 可见） | P2（mossx 有标题系统） |
| `get_commands` | 列出 extension commands / prompt templates / skills | **半静默短板**——见 4.4 |

### 4.2 事件差集（`pi.rs` / `pi_rpc.rs` grep 零命中）

| 事件 | 说明 | 处置 |
|---|---|---|
| `tool_execution_update` | 工具流式输出（bash 实时块） | 不做功能——Render Perf 红线（禁高频 setState / 数组追加打根）；capability 已诚实改为 `streaming.tool-output: unsupported`。若做必须单独 perf spike + coalesce |
| `bash_execution_update` | RPC bash 输出流 | 随 `bash` 命令一起撤销 |
| `queue_update` | pi 内部队列状态 | 不接（mossx 队列是事实源） |
| `auto_retry_start/end`、`summarization_retry_*` | pi 内部重试/摘要重试 | 不接（双层重试禁令） |
| `extension_error` | 扩展运行错误 | 未单独按名消费（通用 `isError` 行有解析）——**扩展炸了用户不知道**，小观察项 |

### 4.3 Extension UI 协议：dialog 全 auto-cancel + fire-and-forget 静默丢弃

- **Dialog 类（select/confirm/input/editor）**：`pi_rpc.rs:204-218` 一律回 `cancelled: true`（v1 刻意 headless）。后果：依赖对话框的扩展（权限闸类、Q&A 类、第三方 package 的交互流程）在 mossx 内**静默降级**——不是崩溃，是「永远被取消」。处置 = D2 产品决策：无 PI 扩展生态战略就维持现状；有方向时把 `extension_ui_request` 翻译成现有 `EngineEvent::RequestUserInput`（`UserInputQuestionCard` 已是跨引擎通道，纯接线零新 UI）。
- **Fire-and-forget 类（notify/setStatus/setWidget/setTitle/set_editor_text）**：同样无消费，但这类**不需要响应**——丢弃即静默。`notify`（info/warning/error 通知）与 `setStatus`（状态栏）丢弃意味着「扩展在后台做了什么」对用户完全不可见。这是 gap v3 没有点名的**半静默短板**（成本极低：映射到现有 toast/状态通道即可，无交互回路）。

### 4.4 发现面：slash 面板只列 skills，不列 extension commands 与 prompt templates

- G2 已补：`.pi/skills` 与 `~/.pi/agent/skills` 进 mossx slash 发现（`skills.rs:222-235`）；
- 仍缺：`~/.pi/agent/prompts/`、`.pi/agent/prompts/`（prompt templates）与扩展注册命令不在发现列表（`get_commands` 未调用）；
- 关键细节：这些命令**手输可达**——pi 的 `prompt` 命令原生展开 `/name` 形式的 skill / prompt template 调用（rpc.md Commands 节），mossx 把 composer 文本透传给 `prompt`，所以用户手输 `/skill:foo` 实际能执行。**缺的是可发现性，不是能力**。补法即 gap v3 F7 处置：`get_commands` 当 G2 同槽数据源，进现有 `CustomCommandOption` 面板，不要新 UI。

### 4.5 治理面：pi 自身管理能力全部无入口

- **packages 管理**：`pi install/remove/update/list/config` 无 UI（D2 前置；mossx 自己的 `extensions/` + `curated-skills/` 与 pi packages 是两套生态，产品决策未拍）；
- **settings 调优**：`compaction.reserveTokens/keepRecentTokens`、`thinkingBudgets`、`defaultTools`、`enabledModels`、`httpProxy`、`defaultProjectTrust` 等约 40 个 settings 键无入口（batch-4 撤销口径：没有用户在要）；
- **工具开关**：`--tools` / `--exclude-tools` / `defaultTools` 未接线——注意 `EngineFeatures.tools_control = true` 是九引擎通用标记，pi 路径实际从不传工具过滤 flag（仅 claude.rs:1217 传 `--tools`）；用户唯一逃生门是 per-engine `custom_args`（两传输都支持，置于协议 flag 之前）；
- **版本策略**：安装/更新永远 npm `@latest`（无 pinning），而 pi 自身有 `pi update self` / 扩展更新 / model catalog 更新通道——两边更新责任未划清（当前 npm @latest 够用）。

### 4.6 安全差异（D1，唯一用户可直接感知的哲学差）

Claude 有文件/命令审批闸；pi 哲学是**不弹窗、工具直接跑**，也无内建 sandbox。mossx 现状 = 接受哲学（`access_mode` 被 pi 路径忽略，无假权限 UI——这是诚实做法）。gap v3 给的第二条路（mossx 在 `tool_execution_start` 自拦走审批卡）与 pi 无弹窗哲学打架（拦了 pi 会当工具失败），没明确安全需求不做。**本次补充的上游事实**：pi 生态的官方隔离路径是扩展（gondolin micro-VM / lens-guard 挡 commit）而非审批闸——若未来要给 PI 用户安全选项，引导安装隔离扩展比自建审批闸更顺上游哲学，成本也低一个量级。

### 4.7 能力口径封顶项（正确的不支持）

`tool.mcp`（上游反 MCP 立场）、`collaboration.mode`（规划模式，PI 无此概念，控件已按 G1 直接不渲染）、`streaming.tool-output`（G1 已改诚实）、`session.switch = unknown`（pi RPC 无 lane-switch 命令，树面板跳 lane 靠 mossx thread 切换实现，已在 i18n 文案注明）。

---

## 五、结论：是否完全释放了 pi 的能力？

| 能力域 | 释放度 | 依据 |
|---|---|---|
| 会话主干（发消息/steer/中止/续会/恢复） | **完全释放** | RPC 长驻 + 双传输 + 全套故障纪律，超出一般 GUI 壳 |
| 模型系统（provider/model/thinking/catalog） | **完全释放** | 三源 catalog + 防中毒 + 档位白名单 + auth.json/models.json 双配置面 |
| 会话树/分叉/压缩/统计 | **完全释放，九引擎最深** | matrix 三键独有；派生族治理 + 深树防护 |
| 上游扩展（工具型） | **事实已释放** | resident 带扩展启动，pi-lens/memory/search/condense 等照常生效 |
| 上游扩展（UI 型） | **未释放（决策在案：D2）** | dialog auto-cancel；fire-and-forget 静默丢弃 |
| 后台任务扩展 | **深度释放** | canonical item + 三路状态 + registry 兜底 |
| 发现面（slash/模板/扩展命令） | **半释放** | skills 已进；prompts/extension commands 可达不可发现 |
| 治理面（packages/settings/工具开关） | **未释放（决策在案：batch-4 撤销）** | custom_args 是唯一入口 |
| 安全模型 | **按上游哲学释放（D1 已拍：接受）** | 无假 UI；隔离扩展路径未引导 |
| MCP / 规划模式 / live tool 输出 | **正确不支持** | 上游立场 / 性能红线，capability 已诚实 |

**总评**：mossx 对 PI 的适配不是「能用」级，是「以 PI 事故反哺全仓库接入纪律」的标杆级——B12/B13/D11/G6/G8 五行通用规范源自 PI 实证。32 个 RPC 命令用了 16 个，但按 gap v3 口径，未用的 16 个里 11 个有明确不做决策、3 个 P2 冻结、真正值得重新看一眼的只有 2 个：`get_commands`（发现面，半天级）和 fire-and-forget 事件（扩展可见性，成本极低）。

---

## 六、建议行动（按优先级，均不构成立项）

1. **hygiene（随时可做）**：统一 capability 双源口径（L3）；11 个 pi change 逐个收尾 archive（勾 tasks / 补 verify，尤其 `expand-shared-atomic-reasoning-linkage-to-pi` 的 39 项 discrepancy）；auth catalog 对齐 0.84.x 当前版。
2. **半天级小活**：slash 发现面补 prompt templates + `get_commands` 数据源（G2 同槽，无新 UI）；fire-and-forget `notify`/`setStatus` 映射到现有 toast/状态通道（若判定值得）。
3. **待产品拍板（默认维持现状）**：D2 扩展生态（若做：dialog → `RequestUserInput` 翻译 + packages 管理面）；D1 已拍接受 PI 哲学，可补一行「隔离扩展（gondolin/lens-guard）」引导文案而非自建审批。
4. **观察项**：`extension_error` 事件消费（扩展故障可见性）；`get_entries` cursor（仅当未来做增量同步才动）；npm `@latest` 与 `pi update` 的版本责任划分；`set_steering_mode` 默认节奏与 mossx 队列融合语义的长期一致性。

---

## 附 A：研究方法与证据链

- pi 本体：`pi --help`（0.84.3）、`~/.hermes/node/lib/node_modules/@earendil-works/pi-coding-agent/docs/`（rpc.md / extensions.md / packages.md / settings.md / skills.md / session-format.md / security.md / custom-provider.md / prompt-templates.md / compaction.md / containerization.md）、本机 `~/.pi/agent/settings.json` 与已装 packages；
- 仓库：`src-tauri/src/engine/{pi,pi_rpc,pi_history,pi_auth,pi_models_config,pi_provider_profile}.rs`、`engine/{mod,status,commands,events,adapter_registry,capability_matrix}.rs`、`src/features/pi-session/**`、`src/features/engine/engineCapabilityMatrix*`、`skills.rs`；
- 基准文档：`docs/research/mossx-multi-cli-provider-session-foundation-design.md`（「最近校准」与「当前实现校准」表）、`docs/research/mossx-new-cli-onboarding-guide.md`（§0 矩阵）、`docs/analysis/pi-cli-feature-parity-gap-2026-08-24.md`（v3 权威口径）；
- 关键实证点：resident spawn 无 `--no-extensions`（`pi_rpc.rs:79-138`）；print `build_command` 无工具过滤 flag（`pi.rs:1960-2041`，仅 claude.rs 传 `--tools`）；6 类事件名在 pi 模块 grep 零命中；registry watcher 兜底已落地（commit `2eea1cfb8`）；gap v3 后无推翻其结论的新 pi 提交（git log 复核至 `29dc592ed`）。
