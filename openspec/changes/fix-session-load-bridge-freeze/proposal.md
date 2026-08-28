# Change: fix-session-load-bridge-freeze

## Why

2026-08-28 真机（dev 客户端）频繁切 session 实测，`perf.thread-switch` 计时证据抓到当前切会话卡顿的**主因**：

```
14:41:32 dur=8488ms items=2140 displayed=300 mode=tail-first engine=pi
         同刻 perf.suspend-gap gapMs=6683（rAF 停摆 6.7s = 主线程整段冻结）
```

**换个角度的归因（关键推理）**：`await invoke(...)` 期间主线程空闲、rAF 正常运行——冻结不可能发生在 IPC 等待期，必然发生在某个**同步段**。排除渲染段（displayed=300，tail-first 窗口生效）后，冻结段锁定在「IPC 返回值处理 + 前端 parse/组装」。

**根因定位（代码 + 磁盘实证）**：

1. **IPC 返回值以嵌套对象图过 WKWebView 桥，桥按对象数同步逐个转换**。`load_pi_session`（`src-tauri/src/engine/pi_history.rs:1247`）把 JSONL 逐行 parse 成 `PiSessionMessage` 结构体数组（id/role/text/images/timestamp/kind…）整体返回；Tauri 桥在 JS 侧把 ~2140 条 × ~8 字段 ≈ **1.7 万+ 对象**同步转换。实测该会话文件 **2.9~3.3MB**（`~/.pi/agent/sessions/.../2026-08-26T06-05-41-*.jsonl`）。
   - **同构先例**：`fix-client-store-ipc-jank-and-markdown-worker-churn` F1 实测 274KB 对象图过桥同步段 **3338ms**（该 change 已把 write 方向改 raw-string 通道，但 read 方向的 `client_store_read` 与 engine history load 是**两条未修的 read 通道**——当时 Non-Goal 明确留白「不改 client_store_read 响应方向（启动期 async 读，非本次实测慢点）」，engine load 更未覆盖）。
   - 本例载荷是先例的 **10 倍**（3MB vs 274KB），6.7s 冻结量级吻合。
2. **全量加载与渲染窗口脱节**：渲染只需尾部 300 条（tail-first 首屏 + 500/页按需 prepend），但 load 无窗口参数，全量 2140 条（3MB）全部过桥、全部前端组装（`hydrateHistory` → `prepareThreadItems` 全量遍历）。claude 引擎已有 `limit/before` 窗口参数（`load_claude_session` options），pi/gemini 无。
3. **次要成本**：前端 `piHistoryParser`（224 行）+ reducer 全量 merge——在桥冻结消除后占比会浮出，但先例证明字符串 `JSON.parse`（V8，3MB 约 10~30ms）+ 结构体数组组装远小于对象图转换。

旁证：同轮测试 281/261 条会话切换也需 1276~1581ms（中会话仍有数百 KB~1MB 级对象图过桥 + 固定底座）；上午生产日志大会话切换时 366/395ms 掉帧与之相符。追加实测（15:19–18:01 轮）：**3 条 items 的 pi 会话切换也需 1563ms**——存在与体量无关的固定链路成本（嫌疑 `resolve_session_file` 全目录扫描），F1 只救大头，固定成本另立调查（tasks 3.5）。

## What Changes

- **F1 raw-string 返回通道（治本，pi 先行）**：`load_pi_session` 返回类型从 `PiSessionLoadResult`（对象图）改为 `payload_json: String`（单一 pre-stringified JSON）；前端 `loadPiSession` 一次 `JSON.parse`。Rust 侧序列化用 `serde_json::to_string`（异步 tokio 线程，不占 UI/IPC 转换），磁盘读取与逐行投影逻辑不变。对齐 client store F1 先例（同 bundle 发版、无版本偏差）。
- **F2 会话加载窗口化（与渲染窗口对齐）**：`load_pi_session` 增加 `limit: number | null` 参数（默认 null=全量，保持 fork/merge 等既有调用方兼容）；resume 链传 `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED`（400）+ 前端把窗口外条目记为 pending older（复用既有 `rememberFullHistoryForWindow` 语义：旧消息已在 Rust 侧丢弃时，按需二次 `load_pi_session(before)` prepend——JSONL 天然 append-only，Rust 侧从尾部计数投影即可，无需全文件解析后截断）。
- **F3 逐引擎推广（pi 验证后）**：`load_gemini_session` / `load_dsh_session` 等无窗口 read 通道同款改法；`load_claude_session`（已有 limit）/`load_codex_session`（载荷形态单独评估）按实测决定是否跟进。
- **F4 计时证据增强（顺手，量级成本）**：`perf.thread-switch` payload 增补 `ipcMs`（loader 发起→snapshot 返回）与 `hydrateMs`（snapshot 返回→items 落库）分段，下次直接区分「桥/IO 慢」与「前端组装慢」。

## Capabilities

### Modified Capabilities

- `thread-history-hydration-render-budget`（fix-session-switch-jank-red-lines 新立的 capability）：
  - ADDED requirement「Engine History Load MUST NOT Freeze The Main Thread Via Object-Graph Bridge」——history read 通道载荷 MUST 以单一 JSON string 过桥；
  - ADDED requirement「History Load Window SHALL Match The Render Window」——resume 首载 MUST 按首屏窗口（≤400）请求，全量语义仅限显式调用方（fork/late-merge/All 展开）。

## Non-Goals

- **不做 parse 移 worker / 分片**（原 P0 备选方案）：F1+F2 后剩余前端组装成本预计 <100ms，先实测再决定是否需要；避免一次改两层。
- **不动 `client_store_read`**（启动期 async、无实测冻结证据）。
- **不动 resume 链的 dispatch/commit 结构**（fix-session-switch-jank-red-lines 已覆盖）。
- **不引入流式/分块 IPC 协议**——raw-string + 窗口参数已覆盖实测痛点，协议级流式属过度设计。

## 影响面

| 维度 | 说明 |
| ---- | ---- |
| Backend | `src-tauri/src/engine/pi_history.rs`（`load_pi_session` 返回 `payload_json` + `limit` 参数 + 尾部投影）、`session_history_commands.rs` 包装层 |
| Frontend | `src/services/tauri/session.ts`（loadPiSession parse + limit）、`useThreadActionsResumeThread.ts` pi 分支（传窗口 + pending older 二次加载）、`perf.thread-switch` 增补分段字段 |
| 预期收益 | 2140 条会话切换：~8.5s → 首屏 <1s（400 条 ≈ 600KB 字符串过桥 + V8 parse 几十 ms）；中会话 1.3~1.6s → 数百 ms |
| 风险 | pi「All 展开旧消息」路径改为二次加载（磁盘再读）——需保留 `rememberFullHistoryForWindow` 兼容或明确 fallback；Rust 侧 `to_string` 3MB 在 tokio 线程（~10ms 级）；JSONL 尾部计数实现需处理行缓冲边界 |
| 验证方式 | TDD 先红后绿：Rust 单测（尾部投影/limit/非法值）+ 前端 vitest（parse 通道/窗口请求/二次 prepend）+ 真机 thread-switch 计时对照 |

## Acceptance

- **A1（F1）**：`load_pi_session` invoke 返回 `{ payloadJson: string }`；前端 `JSON.parse` 后结构与现对象图 deep-equal；Rust 单测覆盖序列化。
- **A2（F2）**：resume 首载 pi 会话时 invoke 携带 `limit=400`；Rust 侧仅投影尾部 ≤400 条 + `hasMore`；点「All/更早」触发二次 `load(before)` prepend，终态与全量加载 deep-equal。
- **A3（F4）**：`perf.thread-switch` 含 `ipcMs`/`hydrateMs` 分段。
- **A4（真机对照）**：同一 2140 条 pi 会话切入，`durationMs` 从 8488ms 降到 <1500ms（dev）/ <800ms（prod 预期），且不再出现与 thread-switch 同刻的 suspend-gap。
- **A5（回归）**：pi resume / history 相关 vitest + Rust `cargo test`（pi_history 模块）全绿；`npm run typecheck` 0；rustfmt 改动文件 clean。

## 实施顺序建议（对齐后启动）

1. F1 raw-string（pi）——单一改动、收益立现、风险最低；
2. F2 窗口化 + 二次 prepend——依赖 F1 的载荷形态（before 游标语义一起定）；
3. F4 计时分段——随 F1 落（同一 hunk）；
4. F3 逐引擎推广——pi 真机验证达标后另开任务。
