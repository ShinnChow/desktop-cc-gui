# Change: fix-claude-fork-delete-resurrection

## Why

2026-08-27 用户实测反馈（0.9.3 / win11）：fork 出来的对话删不掉——删除后行消失，过几分钟又出现在侧栏；且**不只是 fork 会话**，普通会话删除后也会复活（点进去内容是空的，重启 cc-gui 后不再出现）。

根因（代码链路全程走查确认），三条洞叠加：

1. **synthetic fork bootstrap 行被写成僵尸 Index 行**。`claude-fork:<parent>:<ts>-<rand>` 合成 ID 在 `writeClientCreatedSessionIndex` 里经 `bareSessionId()` 从第一个冒号截断，落库成 `(claude, "<parent>:<ts>-<rand>")`——一个任何后续链路都还原不出来的乱码键（`src/services/tauri/sessionIndex.ts:188`）。
2. **删除链路对该键完全失明**：v2 点查 `lookup_rows_for_delete` 把全 ID 剥成 `"fork:<parent>:<ts>-<rand>"` 匹配不到；`parse_engine_hint` 不识别 `claude-fork:` 前缀 → 判 ghost → `GHOST_CLEANED`「成功」返回：不物理删、不落 tombstone 占位、ghost 兜底 tombstone 走未知前缀分支一个占位行都不插（`src-tauri/src/session_delete_v2.rs:130,976-993`、`session_index/store.rs:1045-1075`）。僵尸行永远 active，每次 hydrate 都被投影回侧栏。
3. **删除不清客户端持久快照**。侧栏每帧全量持久化 sidebarSnapshot 到 client-store（`useThreads.ts:694`），删除只清内存 refs 与 per-engine 快照（`useThreadActions.lastGoodSnapshots.ts:429`），快照磁盘副本不动；后续任一次 list partial/degraded 触发 last-good floor 回退 `loadSidebarSnapshot()` 时已删行被重新 union 进 state 并再次持久化——自续循环直到重启后 first-paint 权威列表整体替换。这解释「所有会话删了又回来、点进去空的、重启就好」。

既有 spec 本就声明 provisional fork 是 runtime-only（"系统 MUST NOT 将该行为解释为跨应用重启 persistence"，`claude-fork-session-support/spec.md`），僵尸 Index 行写入本身即违背该契约。

## What Changes

- **F1 synthetic fork bootstrap 行禁止入 Index**：`writeClientCreatedSessionIndex` 对 `claude-fork:` 前缀 ID 直接跳过 upsert（与 `-pending-` 草稿同语义）。行内可见性继续由 reducer 的 `provisionalThreadsToPreserve` 保证；首次发送 rename 成 `claude:<childSessionId>` 后由既有 `writeRemappedClientSessionIndex` 写入 canonical 行。
- **F2 删除时清除历史僵尸孪生键**：新增 `scheduleTombstoneClaudeForkIndexRow(threadId)`——对 `claude-fork:X` 形态的删除目标，按冒号后 payload `X` 精确 tombstone 已存在的 mangled 行（存量用户 DB 里的旧僵尸可被本次删除顺带清掉）。接入 v2 删除结算成功路径（`deleteThreadForWorkspaceV2`）。
- **F3 删除同步清理持久快照**：新增 coalesced 的 `queueRemoveThreadsFromSidebarSnapshot(workspaceId, threadId)`，在 `removeThreadFromCachedSummaries` 单一收口点排队、微任务合并后一次读-改-写 sidebarSnapshot，杜绝 last-good floor 从磁盘副本回灌已删会话。
- Rust 侧本轮不动：SQL 更新臂 `session_id = full OR session_id = bare OR engine||':'||session_id = full` 已能精确命中 F2 传入的 mangled 键与 `claude:<mangled>` 形态；`parse_engine_hint` 的 Rust 硬化留作可选 follow-up。

## Capabilities

### Modified Capabilities

- `claude-fork-session-support`：
  - ADDED「Synthetic Fork Bootstrap MUST NOT Persist Into Session Index」：`claude-fork:*` 合成 ID MUST NOT 产生 Session Index 行；canonical child 身份迁移后 MUST 由 remap 链路写入真实键。
  - ADDED「Fork Deletion MUST Purge Companion Persistence Copies」：删除 `claude-fork:*` 行 MUST tombstone 其 mangled 孪生键并从持久化 sidebar 快照中移除该行。

## Impact

- Affected code：
  - `src/services/tauri/sessionIndex.ts`（F1 skip + F2 helper）
  - `src/features/threads/utils/sidebarSnapshot.ts`（F3 queue + flush）
  - `src/features/threads/hooks/useThreadActions.lastGoodSnapshots.ts`（F3 收口接线）
  - `src/features/threads/hooks/useThreadActions.ts`（F2 接线）
- 行为变更声明：
  1. 未发送过消息的 fork bootstrap 会话重启后不再出现（本来就无任何数据支撑）；发送首条消息后恢复既有跨重启可见性。runtime 内可见性不变。
  2. 已存在的僵尸 Index 行在用户下一次删除对应 fork 行时被顺带清掉；不清也不影响新数据。
- 明确不做：Rust `parse_engine_hint` 硬化（follow-up）、GHOST_CLEANED 占位语义改造（F1+F2 后无残留实体可复活）、归档路径语义变化（快照清理对 archive 同样安全，archived map 过滤独立生效）。
