# Tasks: fix-session-load-bridge-freeze

> 状态：**proposed / await 对齐后启动**（用户拍板实施顺序后开工）

## 1. F1+F4 raw-string 通道 + 计时分段（pi，TDD）

- [ ] 1.1 红测试（Rust）：`pi_history` tests——`load_pi_session` 返回 `payload_json` 单字符串；parse 后与既有对象图投影 deep-equal；非法/空会话语义不变。
- [ ] 1.2 红测试（JS）：`session.ts` `loadPiSession` 返回 parse 后对象；`perf.thread-switch` 增补 `ipcMs`/`hydrateMs` 分段。
- [ ] 1.3 实现：Rust `to_string` + 包装层；前端 parse；`useThreadActionsResumeThread` 计时分段。
- [ ] 1.4 验证 + commit；真机 dev 快速对照（同会话 durationMs 应显著下降）。

## 2. F2 窗口化 + 二次 prepend（**数据驱动暂缓**）

> 决策（2026-08-28 实施中）：F1 raw-string 落地后，前端本就走 tail-first 首屏
> （2140 条只 dispatch 300 条），窗口化的边际收益只剩 parse/组装段 ~100-200ms，
> 但要动「All 展开」语义（回归面不划算）。新落的 loadMs/assembleMs 分段计时
> 是决策输入：下轮真机数据若显示 assembleMs 显著（>300ms）再按原方案实施。

- [ ] 2.1（暂缓）红测试（Rust）：`limit` 尾部投影（≤400 条 + hasMore/before 游标；JSONL 边界行处理）。
- [ ] 2.2（暂缓）红测试（JS）：resume 首载带 limit；「更早/All」经 `load(before)` prepend，终态与全量 deep-equal。
- [ ] 2.3（暂缓）实现 + 与 `rememberFullHistoryForWindow` 兼容对齐（或明确 fallback 语义）。
- [ ] 2.4 真机对照 A4：同会话 durationMs 对照（B1 后预期 <1500ms dev）；assembleMs 数据回填本节决策。

## 3. F3 逐引擎推广（pi 达标后另评）

- [ ] 3.1 gemini/dsh 载荷形态实测（找最大会话文件体积）→ 同款改法排期。
- [ ] 3.2 claude（已有 limit）/codex 按实测决定是否跟进。

## 3.5 F5 pi 固定链路成本调查（2026-08-28 真机新证据补入）

- [ ] 5.1 实测：3 条 items 的 pi 会话切换也需 1563ms（perf.thread-switch 17:32:15）——与体量无关的固定成本；嫌疑 `resolve_session_file`（全 sessions 目录扫描）与 pi loader 固定往返。TDD：为 resolve 路径加计时/缓存断言。
- [ ] 5.2 若证实目录扫描：会话文件 resolve 加内存索引（session_id → path 直查），对齐 2026-08-27 complete-native-sidebar-session-index 方向。

## 4. F6 worker scope 错误回传（Phase C，已实施）

- [x] 4.C.1 红测试：worker 作用域 error/unhandledrejection 回传结构化 detail（message/stack/filename/位置）；主线程指纹落盘（worker-scope-error）且不 dispose worker。
- [x] 4.C.2 实现：`fastMarkdown.worker.ts` 作用域监听 + `workerAdapter.ts` 处理分支（sourceModule/Line/Col + stackHash）。
- [ ] 4.C.3 下一轮真机：`fast-markdown-worker/failed` 的 worker-scope-error 条目携带完整 stackHash/sourceModule → 定位 chunk-GNJJE6OE.js:64:23 的 1wt84ny 真凶。

## 收口

- [ ] 4.1 `openspec validate --strict`；索引更新；A4 真机数据回填 tasks。
