# Tasks: perf-cold-start-click-storm-convergence

> TDD 纪律：每批先红（测试失败且失败原因正确）再绿（最小实现），重构不换行为。
> 批次顺序：F4 → F3 → F1 → F2 → F5。批内独立提交，`git diff --stat` 自查防格式化噪音。

## 1. 批次 F4：dsh 宿主离线快速失败

- [x] 1.1 红测试（Rust）：新建 `src-tauri/src/engine/dsh/breaker.rs` + `#[cfg(test)]`——状态机迁移用例：连续 2 次 transport error → open；open 期内 `check()` 拒绝；60s 后 half-open 放行一次；成功 → close、失败 → 重开。先确认用例编译失败/断言失败。
- [x] 1.2 红测试（Rust）：`host.rs` client 构造断言 `connect_timeout(800ms)` 生效（配置探测或注入 clock 的调用路径单测）。
- [x] 1.3 实现：`breaker.rs`（`AtomicU32` + `AtomicI64` 纯逻辑）接入 `dsh/host.rs` `describe` / RPC 调用点；transport error 计数，breaker-open 直接返回结构化 `Down { reason: "breaker-open" }`；`cargo test -p`（仓库惯例 scoped）绿。
- [x] 1.4 红测试（JS）：`dshHostStatus.test.ts` 扩展——breaker-open / 结构化 Down → `kind:"down"` 映射；loader Down 分支不重试断言（`useThreadActionsResumeThread` 路径或 loader factory 就近测试）。
- [x] 1.5 实现：前端识别结构化 Down → 单条状态事件替代 `thread/history loader error` 刷屏，走 V0/本地可读回退（`reopenOutcome:"recovered"` 链路不动）。
- [x] 1.6 验证：`rustfmt --edition 2021 --check` 过；`cargo check --lib` 过；breaker 10/10 绿（workspace `cargo test` 运行器环境损坏 STATUS_ENTRYPOINT_NOT_FOUND——存量问题，既有 `dsh::host` 测试同败；逻辑经独立 mini-crate 验证）。**commit 待用户拍板**。

## 2. 批次 F3：驱逐 recency 保护

- [x] 2.1 红测试：新建驱逐选择纯函数测试（`threadRuntimeOwnershipHelpers` 就近）——用例 A：20 会话、10 分钟内切换集含第 1 个会话 → `selectEvictableThreadIds` 不得返回它（现状实现返回 → 红）；用例 B：recent 集 >`THREAD_ITEM_CACHE_RECENT_PROTECT_MAX(8)` → 保护集内部按 activityTimestamp LRU 淘汰；用例 C：protected（active/pinned/in-flight）优先级仍高于 recent。
- [x] 2.2 实现：抽 `selectEvictableThreadIds(input)` 进 `threadRuntimeOwnershipHelpers.ts`；`useThreads.ts` 驱逐 effect 改为调用纯函数并维护 `recentSwitchThreadIds`（切换路径写入，10 分钟窗口、有界 Set）。测试转绿。
- [x] 2.3 接线：`recentThreadSwitchesRef` 切换路径写入已接（`useThreads.ts` handler）；专项集成断言待补（useThreads 无轻量挂载点，暂以 selector 单测 + 真机 evict 计数对照覆盖）。
- [ ] 2.4 验证 + commit；`npm run check:app-shell:governance` 过；既有 evict 测试群全绿（ref 清理协议用例零改动）。

## 3. 批次 F1：soft re-sync 让路

- [x] 3.1 红测试：`useWorkspaceThreadListHydration.test.tsx` 新增——场景 A：pointer defer 满 `MAX_DEFERS` 且 quiet 始终不满足 → soft resync **不执行**（现状强跑 → 红）；场景 B：defer 满进入 cooldown 后首个真实 quiet 窗口 → 恰好执行一次（防饿死语义）；场景 C：cooldown 内继续点击仍不执行、不再累积「强跑许可」。
- [x] 3.2 实现：`runPostFirstPaintIndexSoftResync` 调度改「冷却后必跑」——defer 满重置计数并要求真实 quiet；`MAX_WAIT` 仅作收敛兜底（其间出现过 quiet 仍未跑才放行）。注释更新：删除「force one run even while the user is still clicking」语义，写明 importer/显式 reload 兜底。
- [x] 3.3 验证 + commit：hydration 测试群全绿；`npm run check:app-shell:governance` 过。
- [x] 3.4 对照断言（离线可跑）：`threadSessionLog` 日志路径不变（`source:"session-index+sync"` 仍透传 `syncMs`），保证验收期能直接对时间线。

## 4. 批次 F2：first-paint 温读预算（归因先行）

- [ ] 4.1 红测试（Rust）：`session_index` 读侧单测——温读参数（`syncIfNeeded:false, forceSync:false`）不触发 writer rescan（锁既有语义）+ 返回体含可选 `timing { openMs, queryMs, totalMs }` 字段（新 → 红）。
- [ ] 4.2 实现：分段计时落返回体；前端 `thread/list session-index` 日志透传（可选字段，旧后端兼容）。
- [ ] 4.3 真机归因：Win 打包版冷启采集 5 次 first-paint 温读 `timing`，回填到本 tasks（数据决定是否需要 importer 让路 / 预热 / checkpoint 修法，**不预支修法**）。
- [ ] 4.4 若归因成立定向修：按发现项补红→绿（每项独立小批）；不成立则在本 tasks 记录「温读慢为环境抖动，不修」的裁定与数据。

## 5. 批次 F5：Windows 真机验收 + 收口

- [ ] 5.1 验收脚本（对齐 `windows-cold-start-click-freeze-pitfall.md` 验收矩阵第 5 条扩展）：0.9.4 打包版冷启动 5 秒内连点 ≥12 个会话（跨 pi/claude/grok，覆盖 >cacheMax）+ dsh daemon 停止态点开 dsh/shared 会话。期望：整窗可点、无整页导航逃生；`perf.thread-switch` durationMs 分布对照 proposal 基线（201~610ms）；`session-index+sync` 不落连续点击窗口；evict 次数 ≤3；dsh 可读回退 <300ms（熔断后 <50ms）。
- [ ] 5.2 证据回填：诊断 JSON / threadSessionLog 时间线摘录贴回本 tasks；对照数据不足项列明。
- [ ] 5.3 macOS 回归：跑或写明「未测」，禁止默认通过。
- [ ] 5.4 `openspec validate perf-cold-start-click-storm-convergence --strict` 通过；sync 相关 capability spec；确认未触碰 `fix-session-load-bridge-freeze` / `fix-session-switch-jank-red-lines` 管辖文件（`git diff --stat` 复核）。

## 6. Review 回填（2026-08-29）

- [x] 6.1 F3 补缺：recentThreadSwitchesRef 剪枝原在驱逐 effect 水位线 early-return 之后（低负载期永不执行 → Map 无界增长）；已移到 early-return 之前。回归：eviction+hydration 31/31 绿、tsc 0。
- [x] 6.2 剩余卡点归因（2026-08-29 00:21 窗口，dev debug 构建 + shared 内容就位后）：evict 0 次（F3 生效）、无 soft re-sync 强跑（F1 生效）；残留严重掉帧 hotspot 为 **react-commit（单次 530ms nested-update x19，deltaMs 899）**——属切会话渲染扇出，归 fix-session-switch-jank-red-lines 管辖（本 change Non-Goal）。另注意 debug 构建 vs 昨晚 release 基线不可直接对照。
- [x] 6.3 已知残留（不阻塞收口，后续小 change）：① F4 熔断 open 期间 turn 发送失败会以原始  JSON 串透出到聊天错误 UI（classifyDshHostError 未识别，P3 cosmetic）；② F1 持续点击场景 sidebar 收敛延迟到首个 quiet 窗口（by-design，importer 90s + 显式 reload 兜底）；③ F4 熔断恢复依赖半开探测（≤60s 自愈），无手动 reset 入口。
- [x] 6.4 Mac 影响边界：五个改动文件零平台条件代码（grep target_os/process.platform = 0）；F4 为 reqwest 纯逻辑（Mac 同语义，connect_timeout 800ms 对本机/局域网 dsh 无感，远程慢网宿主从「无上限挂 30s」变「800ms 快速失败」是改善）；F3/F1 为纯 JS 调度与选择，跨平台语义一致；未触碰 WebView/hit-test/native API（Windows 特有放大器未被修改，是靠减少主线程工作间接受益 Mac）。Mac 真机回归：**未测**（本机为 Windows），发版前按 guide 要求补测或写明未测。
