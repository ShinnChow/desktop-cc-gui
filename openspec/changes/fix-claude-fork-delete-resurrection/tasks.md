# Tasks: fix-claude-fork-delete-resurrection

## 1. RED：失败测试先行

- [x] 1.1 `src/services/tauri/sessionIndex.test.ts`：
  - 合成 fork ID（`claude-fork:P:ts-rand`）调用 `writeClientCreatedSessionIndex` MUST NOT 触发 `upsert_session_index_rows`
  - `scheduleTombstoneClaudeForkIndexRow` 对 fork ID 调用 `tombstone_session_index_rows(["P:ts-rand"])`（冒号后 payload 原样）；非 fork ID no-op；空 payload no-op
- [x] 1.2 新增 `src/features/threads/utils/sidebarSnapshot.removeQueued.test.ts`：
  - 跨 workspace 排队多个 threadId → flush 后写入快照不含已删行、其余行与其他字段原样保留
  - 排队不存在于快照的 id → 不产生写
  - 多次排队合并为一次写（coalesced）
- [x] 1.3 运行目标测试确认全红

## 2. GREEN：实现

- [x] 2.1 `sessionIndex.ts`：`claude-fork:` 前缀 skip upsert（F1）
- [x] 2.2 `sessionIndex.ts`：`scheduleTombstoneClaudeForkIndexRow` / `claudeForkIndexTwinSessionId`（F2）
- [x] 2.3 `sidebarSnapshot.ts`：`queueRemoveThreadsFromSidebarSnapshot` coalesced 清理 + test reset helper（F3）
- [x] 2.4 `useThreadActions.lastGoodSnapshots.ts` 的 `removeThreadFromCachedSummaries` 接 F3 队列
- [x] 2.5 `useThreadActions.ts` 的 `deleteThreadForWorkspaceV2` 成功结算循环接 F2
- [x] 2.6 目标测试全绿

## 3. 回归与验证

- [x] 3.1 相关既有套件回归：`sessionDeleteV2` / `useWorkspaceSessionCatalog` / `useThreadActions.start-fork` / `stale-list-abandon`。后两者存在 4 个与本 change 无关的存量失败（工作区在途 pi provider 改动所致，stash 对照基线一致）
- [x] 3.2 TypeScript 类型检查通过

## 4. 收口

- [x] 4.1 spec delta（`claude-fork-session-support`）落盘
- [x] 4.2 ADR 校准回写检查：本 change 未命中基石文档更新触发器（engine registry / Shared 集合 / provider binding / canonical fact schema / context compiler / terminal ACK / recovery exit），无需回写
