# Delta: thread-history-hydration-render-budget

## ADDED Requirements

### Requirement: Engine History Load MUST NOT Freeze The Main Thread Via Object-Graph Bridge

engine history read 通道（`load_pi_session` 等）的返回载荷 SHALL 以单一 pre-stringified JSON string 过桥（Rust `payload_json: String`，前端一次 `JSON.parse`），MUST NOT 把消息结构体数组作为嵌套对象图直接返回——WKWebView 桥按对象数逐个同步转换，是会话切入主线程秒级冻结的实测来源（2026-08-28：2140 条 / ~3MB 对象图，同刻 rAF 停摆 6683ms；同构先例 client store 274KB 对象图 3338ms）。

#### Scenario: 大会话切入不再整段冻结

- **WHEN** 切入一个 2000+ 条消息的 pi 会话
- **THEN** IPC 返回以单一 JSON string 送达，前端 `JSON.parse` 一次性还原
- **AND** `perf.thread-switch` 时段不再出现同刻 `perf.suspend-gap`

#### Scenario: 载荷结构等价

- **WHEN** 同一会话分别经对象图（旧）与 raw-string（新）通道加载
- **THEN** 前端得到的解析结果 MUST deep-equal

### Requirement: History Load Window SHALL Match The Render Window

resume 首载 SHALL 按首屏渲染窗口（≤ `THREAD_ITEMS_FIRST_PAINT_MAX_DISPLAYED` = 400）请求历史（`limit` 参数），Rust 侧按尾部窗口投影并返回 `hasMore`/`before` 游标；全量语义仅限显式调用方（fork / late-merge / 用户点「All」）。窗口外旧消息经二次 `load(before)` prepend，终态 MUST 与全量加载 deep-equal。

#### Scenario: 首载只拉窗口

- **WHEN** resume 切入大会话
- **THEN** 首次 load 携带窗口 limit，IPC 载荷只含尾部 ≤400 条
- **AND** 磁盘上的全量历史不进首载载荷

#### Scenario: 旧消息按需补齐

- **WHEN** 用户点「更早的消息」或「All」
- **THEN** 以 `before` 游标二次加载并 prepend
- **AND** 展开终态与一次性全量加载 deep-equal
