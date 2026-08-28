# pi RPC 首包延迟诊断（2026-08-28）

> 范围：mossx 客户端使用 pi CLI 作为 Native engine 时，「对话首包」超过 10s 才出数据流，而终端直跑 pi / 其它工具 ~2s 反应。给出一份**重新梳理**的诊断与设计落点，方便后续按计划落地。

> 数据来源：① 本机直跑 `pi --mode rpc` 实测时间线（绕过客户端，spawn + handshake + prompt + 事件流全打点）；② mossx 客户端 `~/.ccgui/error-log/2026-08-2*.jsonl` 里 `engine=pi` 的 `turn-diagnostic:terminal-settlement` 事件（含 `firstDeltaAtMs`、`elapsedMs`、`usage.input/cacheRead` 等字段）。

> **校准记录（2026-08-28 第二轮，逐项核对客户端代码后）**：
> 1. **C1/D2 事实修正**：初版「bar 不带已等待 Ns / 终端 spinner 等价物缺失」不成立——`WorkingIndicator` 已内置 `WorkingClock` 秒表（ref 直写、无 React 重渲染），pi 静默期已经点亮走动。真实缺口收窄为「专属文案 + 长静默安抚提示」，见 §三C1 / §四D2 修订版。
> 2. **D2 方案作废重写**：初版「reducer 维护 1s tick」方案比现有 ref 直写模式更差，且蹭 `Render Perf Baseline` 红线③，作废。改为复用现有指示器，只补引擎名单与 presentation profile。
> 3. **范围裁定（用户决策 2026-08-28）**：kimi cache 调研（原 D3 / 杠杆 A1）及一切 upstream 事项**不做**，本批只做客户端内部（D1 / D2 / D4）。接受「客户端动作撼动不了 p50 = 34.8s 的主因」这一预期。

---

## 一、TL;DR（结论）

首包慢的**主因**（80%+）来自**模型端的 prefill 与思考静默**，不是客户端独有：

- kimi-coding k3 thinking=high 下，**API prefill + 思考期间 RPC 完全无事件**；agent_start 之后到首个 `message_update` 之间是真正的「死寂窗口」。
- 实测恢复 2.4MB 大会话：`input: 181,294 tokens, cacheRead: 0, cacheWrite: 0` —— 每 turn 全量冷 prefill 18 万 token，**零缓存命中**。这是 TTFT 被推到 22s / 50s 的根因。
- 客户端 error-log 10 个 pi turn 的 `firstDeltaAtMs`：**min 3.2s，p50 = 34.8s，6/10 超 30s，max 148s** —— 与直测完全吻合，说明大头不在客户端管线。
- "别的工具 2s 有反应"的对比大多不公平：① 同等长会话也会有相同静默；② 终端 pi 在静默期渲染 "✻ Thinking… 12s" 的 spinner，被感知为「有反应」；③ 用户大概率对比的是新会话 + 短上下文场景。

客户端**可修的加成**（~2.5-3s + 体感差）：

- `ensure_resident` **懒加载**：第一条消息才 spawn pi + handshake + `refresh_thinking_levels`，冷启 ~2-2.8s 全计入首包。其它工具 pi 早已跑着，2.5s 被打字时间掩盖。
- **静默期反馈已有底座，只剩文案缺口**：agent_start 之后 6ms 到，之后 20-50s 无事件，但 `WorkingIndicator` 的 spinner + `WorkingClock` 秒表在此窗口已经点亮并逐秒走动（校准详情见 §三C1）。体感问题真实存在，但形式不是「零反馈」，而是「只有泛化的『响应中...』、没有针对 pi 长静默的解释性反馈」。

杠杆排序（**校准后，仅客户端内部**）：**① 静默期反馈补齐（体感修复，几小时级，成本最低）> ② 预热 resident（省 ~2.5s 实际首包）> ③ 思考档按需降档**。kimi 缓存命中仍是理论上最大杠杆（可能 10x），但属 upstream，已裁定范围外——接受客户端动作撼动不了 p50 主因的预期。

---

## 二、实测数据

### 2.1 直跑 `pi --mode rpc`（绕过客户端）

环境：macOS、`pi 0.84.3`、cwd 分别为空目录与 codemoss 仓库根（项目有 `AGENTS.md`）、prompt 内容详见下表。模型来自 `~/.pi/agent/settings.json`：`defaultProvider=kimi-coding`、`defaultModel=k3`、`defaultThinkingLevel=high`。

| 场景 | spawn+握手 | prompt→agent_start | **静默期**（零事件） | 首个 message_update |
| --- | --- | --- | --- | --- |
| 新会话 · 空目录（run 1） | ~1.9s | 7ms | 3.5s | 5.4s |
| 新会话 · 空目录（run 2） | ~1.9s | 6ms | 11.6s | 13.6s |
| **恢复 2.4MB 大会话**（run 1） | ~2.8s | 6ms | **22.3s** | 25.1s |
| **恢复 2.4MB 大会话**（run 2） | ~2.4s | 1ms | **50.8s** | 53.2s |

补充事件拓扑（recovery run 2，截取）：

```
pid=…@+2ms
extension_ui_request#1@+2366ms        ← pi 扩展加载期间请求 UI（plugin-lock 中 6 个 npm 包）
extension_ui_request#5@+36ms
hs_ok=true@+8ms                       ← handshake (get_state) 完成
msg_sent@+0ms                         ← prompt 写入 stdin
agent_start#1@+1ms                    ← pi 已把 prompt 派给 API
turn_start#1@+0ms
message_start#1@+0ms                  ← user message echo
message_end#1@+1ms                    ← user message 关闭
─────────────────────────────────────
                **静默 50.8s**       ← 期间无任何 message_update / thinking_start
─────────────────────────────────────
message_update#1@+50785ms
first_update_body={"type":"message_update",
                   "usage":{"input":181294,"output":0,
                            "cacheRead":0,"cacheWrite":0,
                            "totalTokens":181294},
                   "assistantMessageEvent":{"type":"thinking_start","contentIndex":0}}
message_update#5@+26ms                ← 之后 thinking_delta 才开始流
turn_end#1@+9685ms
agent_end#1@+1ms
agent_settled#1@+1ms
```

**关键观察**：

1. **首发 message_update 是 `thinking_start`，不是正文**。pi 的 RPC 协议在 `agent_start` 之后、`message_update(thinking_start)` 之前**没有事件流**。
2. **`cacheRead:0, cacheWrite:0` + `input:181,294`** 是决定性证据：kimi-coding 每 turn 冷 prefill 18 万 token。即使模型侧理论吞吐 ~3k tok/s，纯 prefill 也需 ~60s；实测 50.8s 全在静默期里。
3. boot 期间 `extension_ui_request` 持续出现（每会话 15-36 次），来自 pi 加载 `pi-memory / pi-lean-ctx / pi-condense / pi-lens / pi-background-tasks / pi-search` 等 npm packages；不直接拖累首包，但增加 boot 时长。

### 2.2 客户端真实数据

`~/.ccgui/error-log/2026-08-2*.jsonl` 中 `engine=pi` 且 `firstDeltaAtMs` 非空的 turn：

| 指标 | 值 |
| --- | --- |
| 样本数 | 10 |
| min | 3,244 ms |
| p50 | 34,769 ms |
| p90 | 148,673 ms |
| max | 148,673 ms |

分布：

| 区间 | 占比 |
| --- | --- |
| <3s | 0 / 10 |
| 3-5s | 2 / 10 |
| 5-10s | 2 / 10 |
| 10-30s | 0 / 10 |
| >30s | 6 / 10 |

模型分布：`kimi-coding/k3`、`kimi-coding/k3-256k`（256k 上下文是重灾区，p50 = 34.8s、最大 148s 几乎都在 256k turn）。

> 直测 ~25s 的恢复首包，客户端 error-log 给到 ~34.8s —— 多出的 ~10s 由客户端管线开销（spawn 2.5s + reconcile 往返 + IPC 序列化 + 前端 reducer/渲染）+ 用户实际 session 多半比 2.4MB 更大共同造成。

---

## 三、根因分层

按时间线从早到晚排列，每层独立可观测：

### A. 模型端 prefill + 思考静默（占比 ≈ 80%+，**upstream**，非客户端引入）

- **机制**：kimi-coding k3 thinking=high 时，每 turn 全量 prefill `input tokens`，期间无 thinking delta（API 与 pi RPC 都无事件）。
- **观测**：首发 message_update 的 `assistantMessageEvent.type` 是 `thinking_start`，且 `usage.cacheRead=0` 直接证实无缓存。
- **杠杆点（按优先级）**：
  - **A1. 启用 kimi context cache**（理论最大杠杆，可能 10x，**已裁定范围外**）：Moonshot 提供 cache 控制（请求体 `cache_control` 标记），但 pi 上游对 kimi-coding 是否落 `cache_control` 待查。**用户决策（2026-08-28）：三方 / upstream 事项不做**，此项保留仅作归因记录，不列入本批任何落地项。
  - **A2. 思考档按需降档**：k3 high 在琐碎消息（"回复一个字"）上仍 ~11s 静默。新会话首条消息可默认 `low` 或 `none`，由用户在 composer 显式提升。低风险，纯客户端配置，保留为本批 D4。
  - **A3. 短消息路径**：检测 prompt 极短 + 历史空时直接走 non-thinking 通道。需 pi 上游 + mossx composer 两端联动，**已裁定范围外**（依赖 upstream）。
- **Non-Goal**：本批不动模型本身、不重排 pi 上游路由、不做 kimi cache 调研与 upstream issue（A1 / A3 均范围外）。

### B. 客户端可省的固定开销（~2.5-3s）

- **B1. Resident 懒加载**：`src-tauri/src/engine/pi.rs:1088 ensure_resident` 仅在 `send_message` 路径被调。冷启动包含 `spawn pi` + `get_state` 握手 + `refresh_thinking_levels` 一次额外 RPC（`pi_rpc.rs:262`），实测 1.9-2.8s。这段时间发生在用户**已经按下回车之后**，全部计入「首包」。
  - **杠杆点**：在会话**打开/聚焦/创建**时即预热（spawn + handshake 完成），把 2.5s 藏进用户阅读/打字时间窗口。改动面小、风险低。
  - **接入面待核**：
    - 打开会话：`useAppShellSessionsSection` / `useActiveThreadBoot` 等路径能否在 `engine_send_message` 之前触发 `engine_prewarm(pi, session_id_hint)` IPC；需新增 backend `prewarm_pi_resident` command。
    - 创建会话：composer focus 时预热当前 scratch（用户大概率会用这个 scratch）。
    - 切换模型：set_model 期间不能让旧 resident 死、否则用户切换完又付一次 boot。
  - **边界**：rpc_disabled 闩冷却期内禁止预热（避免闩外触发起 spawn 又触发闩自愈失败连锁）；同一个 workspace 多 PI 标签**真并行**（已是事实，预热是 per-resident key，不是单飞）。已存活的 resident 不得被预热破坏（`ensure_resident` 已有早退检查）。
- **B2. 发送前 reconcile 往返**：每 send 串行 `set_model` / `set_thinking_level`（`pi.rs:1476-1495`），每项 ~5-50ms。可忽略，不在杠杆项内。**若 B1 预热成功，set_thinking_level 在 spawn 期间直接灌入 handshake 后即可**，进一步省 ~50ms（微优化）。

### C. 感知层放大（体感修复，成本最低）

- **C1. 静默期反馈缺口（初版描述有误，已校准）**：初版称「bar 不带已等待 Ns 的动态反馈、终端 `✻ Thinking… 12s` 等价物缺失」——**不成立**。逐环核对的代码事实：
  - `WorkingIndicator.tsx:105` 已有 `WorkingClock`：每秒 tick、**ref 直写 `textContent` 不触发 React 重渲染**（组件内注释明确此设计为避开秒级 setState），渲染条件 `isThinking && processingStartedAt`，这就是终端 spinner + 计时的等价物。
  - `processingStartedAt` 由 reducer `markProcessing` 落（`useThreadsReducer.ts:1033`）；`useThreadItemEvents.ts:1031` 的 `markProcessingIfNeeded` 对所有非终态 realtime 事件触发，且 `canProgressEventStartProcessing`（`useThreadItemEvents.ts:105`）仅排除 codex，**pi 返回 true**——按 §二.1 时间线，agent_start 后 ~6ms 指示器即点亮。
  - `messagesTimelineProjection.ts:255` 无条件插入 `workingIndicator` 行，无引擎门槛。
  - **真实缺口**（收窄后）：
    1. 「等待首段文本」专属文案（`waitingForFirstTextLabel`，`useMessagesRuntimeState.ts:405`）引擎名单只有 `codex/qoder/dsh`，pi 静默期只有泛化的「响应中...」，用户无法区分「pi 没起来」和「模型在 prefill」。
    2. 12s 无首包安抚提示（「该模型可能非流式返回，或网络暂不可达」）由 `heartbeatWaitingHint` 门控，`presentationProfile.ts` 默认 false、仅 opencode 为 true（`MessagesCore.tsx:1870` 的心跳 pulse 驱动同源门控）——pi 的 20-50s 长静默没有任何解释性反馈。
    3. 首条 `message_update(thinking_start)` 到达后 reasoning 行接管渲染是**现状已具备**（`dockedReasoning` 行 + `isPiEventThread` 的 reasoning delta 通路），无需改动。

### D. 次要非主因（确认无影响，写出来排除）

- **`@file` 展开 / 附件传输**：实测 prompt 是纯文本，无 attachments；即使有，base64 编码开销 < 100ms。
- **Session Index 写入**：`~/.ccgui/session-index.sqlite3` 同步不阻塞 IPC，与首包无关。
- **前端 reducer 归一化 / 渲染节流**：chunkCadenceAvgMs=5.1（来自 error-log）说明流到后渲染正常；不在静默窗口内起作用。
- **`rpc_disabled` 闩 / 失败回退 print-json**：本批首包慢数据均来自 RPC 成功路径，与回退无关。

---

## 四、设计要点（落地方向）

> 仅记录**设计点**与**取舍**。具体落地走后续 OpenSpec change + 配套 doc。

### D1. Pi Resident 预热（核心）

**目标**：把 spawn + handshake 的 ~2.5s 藏进用户阅读/打字/聚焦时间，使首包延迟单调下降。

**接入点**（待最终落 OpenSpec 时确认）：

1. **会话打开时预热**（主路径）：会话从 sidebar 选中 → 已有 `useActiveThread` / `useEngineBoot` 一类 hook；新增 IPC（仅 thread 已经存在的 scratch），后端 `pi.rs::prewarm_resident` 直接调 `ensure_resident`，**同步等待** spawn + handshake 完；失败按现有闩逻辑走。
   - **校准（2026-08-28 第二轮）——command 形态改 engine-neutral**：初版提的 `engine_prewarm_pi_resident` 专名 command 改为通用 `engine_prewarm(thread_id)`，按 engine 分发臂实现（pi 臂调 `prewarm_resident`；无 resident 模型的引擎返回 no-op）。理由：① codex 已有同款先例 `prewarm_codex_disk_runtime`（`runtime/commands.rs:187`，前端 `useWorkspaces.ts:262` workspace connected 后延迟触发 + per-key completed/in-flight 去重 + fire-and-forget + debug 遥测），预热不是 pi 特权而是向 codex 看齐；② claude 是 per-turn spawn（`claude.rs:1701`），无 resident 可预热，范式天然不适用；③ 与 `adapter_registry` / `capability_matrix` / Engine Onboarding Gate 架构对齐，未来 resident 型引擎接入时顺带获得预热。
2. **Composer 聚焦时预热**（补强）：composer textarea focus → 若当前 scratch 还没有 resident → 触发同上的 prewarm。覆盖「打开了 thread 但还没打字」的常见窗口。
3. **创建新会话前预热**：新会话 composer → 创建前若上一个同 scratch 的 resident 还活着，复用（已经具备），无需预热。

**契约 / 红线**：

- 预热是 fire-and-forget 友好，但**首次发送仍走 ensure_resident**（以免预热失败但用户已发）。这条双轨 = 不增加新失败路径。
- `rpc_disabled_blocks_spawn` 必须先检查（与 `ensure_resident` 一致），否则闩外触发预热会搅动闩自愈逻辑。
- 不得给同一 `(session_id, scratch)` 起两个 resident（与现有 `pi_resident_map_key` 行为一致）。
- 不得破坏 `session.switch` 的 `capability_switch` 限制（发红线的 `Session Switch Catalog Fetch Gate`：切换独立配置禁止 switch L1）。
- 不得在 `composerDraftStore` / 渲染链路上引诱高频重渲染（与 `AppShell Structure Gate` 一致；预热是 IPC 触发，不在根 setState 链上）。

**度量 / 验收**：

- 改造前 vs 改造后 `firstDeltaAtMs` 分布（新会话与恢复会话各 ≥ 20 个样本）。
- 客户端 error-log 中 `pendingVisibleTextSinceDeltaAtMs` 字段在 spawn 阶段应接近 0（即 spawn 不再挤占首包）。
- 单测：`prewarm_resident` 幂等性（连发 3 次只起 1 个进程）；rpc_disabled 期间拒绝；session_id_hint 通过校验；现有 `ensure_resident` 单测零回归。

### D2. 静默期反馈补齐（体感修复，校准后收窄）

**目标**：pi 长静默窗口（agent_start → 首个 `message_update`，实测 20-50s）内，用户能看到可解释的、与 pi 场景匹配的反馈。**不新建任何组件 / timer / 通道**——秒表底座现状已具备。

**改动点（全部为小改动）**：

1. **pi 加入「等待首段文本」文案名单**：`useMessagesRuntimeState.ts:405-410` 的 `waitingForFirstTextLabel` 引擎名单从 `codex/qoder/dsh` 扩入 `pi`。静默期主文案从泛化「响应中...」变为「pi 已启动，正在等待首段文本...」（zh 文案 `messages.waitingForFirstText` 已存在，含 `{{engine}}` 插值）。
2. **pi 开启 12s 安抚提示**：`resolvePresentationProfile`（`presentationProfile.ts`）为 `pi` 增加分支返回 `heartbeatWaitingHint: true`。这一处同时点亮 `WorkingIndicator` 的 `showNonStreamingHint`（12s 后显示「该模型可能非流式返回，或网络暂不可达，请稍候...」）与 `MessagesCore.tsx:1870` 的 heartbeat pulse。**只走 profile 路线，不改两处 inline 引擎 fallback 列表**（`WorkingIndicator.tsx:182` / `MessagesCore.tsx:1871`——两处 inline 默认本就不一致，不要扩大分歧面）。
3. **回归确认（非改动）**：`WorkingClock` 秒表、thinking_start 后 reasoning 行接管，均为现状已具备，验收时目视回归即可。

**契约 / 红线**：

- **禁止新增 reducer 秒级 timer / `thinkingMsSinceStart` 字段**（初版方案作废）：现有 `WorkingClock` ref 直写是正确范式，reducer 秒级 tick 蹭 `Render Perf Baseline` 红线③。
- 文案切换时机不变式：`waitingForFirstChunk` 为 false（首条 delta 落地产生 assistant item）即回到正常 label，不抢首帧、无闪烁（现有机制保证，无需新代码）。
- `pendingVisibleTextSinceDeltaAtMs` 保持仅 error-log 落盘，不进 UI 文案。
- i18n：`waitingForFirstText` / `nonStreamingHint` 文案已存在，若措辞需针对 pi 调整（如「模型正在处理较长上下文」），按现有 key 增补，不新增 key 结构。

**度量 / 验收**：

- 目视：pi 恢复大会话发送后，≤1s 内出现 spinner + 秒表走动 + 「等待首段文本」文案；12s 后出现安抚提示；首条 delta 到达无缝切换（无闪烁、无重复）。
- 单测：`resolvePresentationProfile("pi").heartbeatWaitingHint === true`；`waitingForFirstTextLabel` 对 pi 的选取分支；opencode/codex 等既有引擎 profile 零回归。

**工作量**：几小时级（初版估 1 天，按收窄后范围下调）。

### D3. kimi context cache 调研（**已裁定范围外，不落地**）

**范围裁定（用户决策 2026-08-28）**：三方 / upstream 事项不做，本批只做客户端内部。原调研路径（pi 上游 grep `cache_control` / 抓包确认请求体 / upstream issue）全部撤销。

保留本节仅作归因记录：`cacheRead:0` 的 18 万 token 冷 prefill 是 p50 = 34.8s 的主因，客户端动作（D1/D2/D4）撼动不了它。若未来要追这个 10x 杠杆，走 pi upstream 路径，不在 mossx 范围内。

### D4. 思考档默认（轻度优化）

**目标**：composer 触发第一条发送时，若思考档为 high 且本次 prompt 极短（≤N 字符 + 无历史 / 短历史），自动降档到 `low` 或 `none`。

**边界**：用户在 composer 已手动设档 = 不覆盖；用户在前序消息已设档 = 不覆盖；只在「默认档 + 短消息」时降。

**度量 / 验收**：纯配置，单测覆盖降档 / 不降档分支。

---

## 五、风险与边界

1. **客户端预热与「冷启动 click freeze」的冲突**（`Windows Cold-Start Click Freeze Gate`）：预热是 IPC 异步，不进首屏 path；不增加 click freeze 风险。但启动期如果同时触发多个 prewarm（workspace 多 scratch），要 backpressure；与现有 `rpc_disabled_blocks_spawn` 同源即可。
2. **OpenSpec 必备**：`D1 / D2 / D4` 都是 behavior 变更（影响 UI 反馈状态、首包 SLA、默认配置），按 `AGENTS.md` OpenSpec 交付规则**必须**起 change；与本次诊断 doc 配套。`D3` 已裁定范围外，无 change。
3. **ADR 校准回写**：D1（prewarm 触及 resident lifecycle）属于「engine registry / Shared 支持集合」调整面，需回写 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 的「最近校准」与「零、当前实现校准」表。
4. **Format Discipline Gate**：未来落 OpenSpec 实现时严格遵守——只格式化本批改动文件，不做全仓 sweep；`rustfmt --edition 2021 --check <file>` 提交前必过。
5. **Native WebView / 平台差异**：D2 改动虽小（文案 + profile），但 `WorkingIndicator` 在三平台都有渲染路径，pi 静默期目视验收仍需覆盖 macOS / Windows / Linux（参考 `WebView Animation Compat Gate`；Windows 走 `GlyphFrameSpinner` 分支，顺带确认秒表与其共存正常）。
6. **预期管理**：kimi cache（p50 主因）已裁定范围外，D1/D2/D4 全部落地后 p50 仍将由上游 prefill 主导（大 session 依旧 20-50s 静默）。本批的验收口径是「客户端可省的 2.5-3s + 静默期可解释反馈」，不是「首包总数下降到秒级」。

---

## 六、建议落地顺序（校准后，仅客户端内部）

| 序号 | 项 | 工作量 | 风险 | 杠杆 |
| --- | --- | --- | --- | --- |
| 1 | D2 静默期反馈补齐（收窄版：文案名单 + profile，OpenSpec change） | 几小时 | 低 | ★★（体感） |
| 2 | D1 resident 预热（OpenSpec change） | 1-2 天 | 中 | ★★★（实际首包 -2.5s） |
| 3 | D4 思考档按需降档 | 半天 | 低 | ★ |

原 D3（kimi cache 调研，★★★★★）已裁定范围外，移出队列。D2 与 D1 相互独立可并行起 change；D2 先行——成本最低、直接回应「体感卡死」的用户痛点。

---

## 七、附：本批数据脚本（归档在 `/tmp/`，可重跑）

- `pi-rpc-timeline.js` —— 直跑 `pi --mode rpc` 打点全部事件类型与时间戳（绕过客户端，用于复现）。
- `pi_latency_stats2.py` —— 解析 `~/.ccgui/error-log/*.jsonl` 中 pi turn 的 `firstDeltaAtMs` 分布。
- `show_tl.py` —— 把 timeline JSON 折叠成单行（规避分析上下文压缩）。

复现命令示例：

```
node /tmp/pi-rpc-timeline.js /tmp/empty-dir "<session-id>" "prompt" > /tmp/result.json
python3 /tmp/show_tl.py /tmp/result.json
```

```
python3 /tmp/pi_latency_stats2.py
```

---

> 文末：本文件是 review + 设计点，不附 tasks / specs delta。后续 D1/D2 起 OpenSpec change 时复用本文 §三、§四 作为 problem statement 与 design rationale；§二 实测数据可作 verify 阶段的 baseline 引用。
