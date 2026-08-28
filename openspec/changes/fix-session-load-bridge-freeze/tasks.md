# Tasks: fix-session-load-bridge-freeze

> 状态：**proposed / await 对齐后启动**（用户拍板实施顺序后开工）

## 1. F1+F4 raw-string 通道 + 计时分段（pi，TDD）

- [ ] 1.1 红测试（Rust）：`pi_history` tests——`load_pi_session` 返回 `payload_json` 单字符串；parse 后与既有对象图投影 deep-equal；非法/空会话语义不变。
- [ ] 1.2 红测试（JS）：`session.ts` `loadPiSession` 返回 parse 后对象；`perf.thread-switch` 增补 `ipcMs`/`hydrateMs` 分段。
- [ ] 1.3 实现：Rust `to_string` + 包装层；前端 parse；`useThreadActionsResumeThread` 计时分段。
- [ ] 1.4 验证 + commit；真机 dev 快速对照（同会话 durationMs 应显著下降）。

## 2. F2 窗口化 + 二次 prepend（TDD）

- [ ] 2.1 红测试（Rust）：`limit` 尾部投影（≤400 条 + hasMore/before 游标；JSONL 边界行处理）。
- [ ] 2.2 红测试（JS）：resume 首载带 limit；「更早/All」经 `load(before)` prepend，终态与全量 deep-equal。
- [ ] 2.3 实现 + 与 `rememberFullHistoryForWindow` 兼容对齐（或明确 fallback 语义）。
- [ ] 2.4 验证 + commit；真机对照 A4（<1500ms dev，无同刻 suspend-gap）。

## 3. F3 逐引擎推广（pi 达标后另评）

- [ ] 3.1 gemini/dsh 载荷形态实测（找最大会话文件体积）→ 同款改法排期。
- [ ] 3.2 claude（已有 limit）/codex 按实测决定是否跟进。

## 收口

- [ ] 4.1 `openspec validate --strict`；索引更新；A4 真机数据回填 tasks。
